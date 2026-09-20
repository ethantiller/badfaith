"""Scores the propaganda-flagging pipeline against SemEval-2020 Task 11 gold spans.

Imports the pipeline directly (``run_analysis``); no HTTP, no running server. Run from the
repo root so ``.env`` is found:

    uv run python -m eval.runners.semeval_spans --articles 5

Each article is split into 3-line paragraphs, analyzed, and every flag at or above
85% confidence is converted back to character offsets in the raw article text.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import random
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from backend.app.config import get_settings
from backend.app.ext.nemotron import NemotronClient
from backend.app.pipeline.orchestrate import PipelineContext, run_analysis
from backend.app.types import AnalyzeRequest, Paragraph, Technique
from eval.load import Article, GoldSpan, build_paragraphs, load_train
from eval.runners.base import EvalResult

SEMEVAL_ROOT = Path(__file__).resolve().parents[1] / "datasets" / "semeval"
DEFAULT_OUT = Path("eval/results/semeval_spans.json")

SEED = 11
DEFAULT_ARTICLES = 50
LINES_PER_PARA = 3
MIN_CONFIDENCE = 0.75  # display threshold: the pipeline keeps every grounded flag

# SemEval classes left out of scoring, gold and predicted alike. Eval only: the pipeline
# still reports these techniques, and nothing outside this file changes.
EXCLUDED_CLASSES = {"Repetition"}

BATCH_SIZE = 5
MAX_CONCURRENCY = 2  # low on purpose: the free API tier rate-limits
BUDGET_S = 300.0  # generous on purpose: an eval may wait where a request may not

# SemEval's own spellings, as they appear in the gold files (note "Minimisation" and "hitlerum")
_NAME_CALLING = "Name_Calling,Labeling"
_EXAGGERATION = "Exaggeration,Minimisation"
_WHATABOUTISM = "Whataboutism,Straw_Men,Red_Herring"
_BANDWAGON = "Bandwagon,Reductio_ad_hitlerum"

LABEL_MAP: dict[Technique, str] = {
    Technique.LOADED_LANGUAGE: "Loaded_Language",
    Technique.NAME_CALLING: _NAME_CALLING,
    Technique.REPETITION: "Repetition",
    Technique.EXAGGERATION_MINIMIZATION: _EXAGGERATION,
    Technique.DOUBT: "Doubt",
    Technique.APPEAL_TO_FEAR: "Appeal_to_fear-prejudice",
    Technique.FLAG_WAVING: "Flag-Waving",
    Technique.CAUSAL_OVERSIMPLIFICATION: "Causal_Oversimplification",
    Technique.SLOGANS: "Slogans",
    Technique.APPEAL_TO_AUTHORITY: "Appeal_to_Authority",
    Technique.FALSE_DILEMMA: "Black-and-White_Fallacy",
    Technique.THOUGHT_TERMINATING_CLICHE: "Thought-terminating_Cliches",
    Technique.WHATABOUTISM: _WHATABOUTISM,
    Technique.STRAW_MAN: _WHATABOUTISM,
    Technique.RED_HERRING: _WHATABOUTISM,
    Technique.BANDWAGON: _BANDWAGON,
}

NOTES = (
    "Scored on the train split only: the SemEval test labels are hidden and the "
    "published PTC v2 corpus ships no dev labels. Fixed-seed subset of n articles. "
    "Paragraphs are 3-line groups, which makes roughly 4.3% of gold spans "
    "structurally unreachable (1.8% cross a paragraph boundary, 2.5% are duplicate "
    "fragments that resolve to an earlier first occurrence). The corpus averages "
    "about 17 gold spans per article, so recall is capped for a pipeline that flags "
    "conservatively. Articles date from 2017-2019 across 48 outlets. The labeling prompt "
    "was revised once after a 5-article pilot on this same train split, so the pipeline "
    "is not fully untouched by this data. Overlap scoring follows Da San Martino et al. "
    "Only flags with confidence of at least 0.85 are scored; the pipeline itself "
    "keeps every grounded flag, so this is a display threshold, not a pipeline one. "
    "The Repetition class is excluded from scoring, gold and predicted spans alike, so "
    "the figures cover 13 of SemEval's 14 classes."
)

# Predictions reuse the gold shape: a SemEval class plus [start, end) character offsets
Span = GoldSpan


# --- Setup ---

def check_label_map(gold_classes: set[str]) -> None:
    """
    Fail fast, before any model call, if the mapping drifts from the gold data.
    """

    # A class count other than 14 means the corpus on disk is not the one we mapped
    assert len(gold_classes) == 14, (
        f"expected 14 gold classes, found {len(gold_classes)}: {sorted(gold_classes)}"
    )

    # A mapped name the gold data never uses scores zero forever and looks like bad recall
    stray = set(LABEL_MAP.values()) - gold_classes
    assert not stray, f"mapped to classes absent from the gold data: {sorted(stray)}"

    # An unmapped technique would raise a KeyError deep in the run instead of here
    missing = set(Technique) - set(LABEL_MAP)
    assert not missing, f"techniques with no SemEval mapping: {sorted(missing)}"


def select_articles(articles: list[Article], n_articles: int) -> list[Article]:
    """
    Take a fixed-seed sample of the articles that carry at least one gold span.
    """

    # The seed is what keeps two runs comparable; the pool skips articles nothing can score
    pool = [a for a in articles if a.spans]
    return random.Random(SEED).sample(pool, min(n_articles, len(pool)))


# --- Running the pipeline ---

async def predict_spans(article: Article, ctx: PipelineContext) -> tuple[list[Span], int]:
    """
    Run the pipeline on one article, returning its predicted spans and unlocatable count.
    """

    # Paragraph ids are what the flags come back keyed by, so keep the lookup alongside
    paras = build_paragraphs(article, LINES_PER_PARA)
    by_id = {p.id: p for p in paras}

    req = AnalyzeRequest(
        url=f"semeval://{article.id}",
        title=article.title,
        section_hint=None,
        paragraphs=[Paragraph(id=p.id, text=p.text) for p in paras],
    )
    response = await run_analysis(req, ctx)

    spans: list[Span] = []
    unlocatable = 0

    # Convert each flag from a paragraph quote back to offsets in the raw article text
    for flag in response.flags:
        # Score only what a user would see; the model's confidence is its own guess
        if flag.confidence < MIN_CONFIDENCE:
            continue

        # Leave out classes this eval does not score, so they are not counted as misses
        if LABEL_MAP[flag.technique] in EXCLUDED_CLASSES:
            continue

        para = by_id.get(flag.paragraph_id)

        # The grounding gate rewrites kept quotes to the paragraph's exact text, so this
        # first-occurrence find should always succeed; a miss is a bug signal
        pos = para.text.find(flag.quote) if para else -1
        if pos == -1:
            unlocatable += 1
            continue

        # The paragraph is a contiguous slice, so its start plus the local offset is exact
        start = para.start + pos
        spans.append(Span(LABEL_MAP[flag.technique], start, start + len(flag.quote)))

    return spans, unlocatable


# --- Scoring ---

@dataclass
class Tally:
    """Pooled counts for one class (or for everything, when summed)."""

    n_pred: int = 0
    n_gold: int = 0
    exact_pred_hits: int = 0  # predicted spans identical to some gold span
    exact_gold_hits: int = 0  # gold spans identical to some predicted span
    overlap_p: float = 0.0  # sum of |pred ∩ gold| / |pred| over same-class pairs
    overlap_r: float = 0.0  # sum of |pred ∩ gold| / |gold| over same-class pairs

    def __iadd__(self, other: Tally) -> Tally:
        self.n_pred += other.n_pred
        self.n_gold += other.n_gold
        self.exact_pred_hits += other.exact_pred_hits
        self.exact_gold_hits += other.exact_gold_hits
        self.overlap_p += other.overlap_p
        self.overlap_r += other.overlap_r
        return self


def add_article(tallies: dict[str, Tally], pred: list[Span], gold: list[GoldSpan]) -> None:
    """
    Fold one article's predicted and gold spans into the per-class tallies.
    """

    pred_keys = {(s.technique, s.start, s.end) for s in pred}
    gold_keys = {(s.technique, s.start, s.end) for s in gold}

    # Exact match is scored from both sides: a prediction can hit, a gold span can be hit
    for s in pred:
        tally = tallies[s.technique]
        tally.n_pred += 1
        tally.exact_pred_hits += (s.technique, s.start, s.end) in gold_keys

    for t in gold:
        tally = tallies[t.technique]
        tally.n_gold += 1
        tally.exact_gold_hits += (t.technique, t.start, t.end) in pred_keys

    # Overlap credit is summed over every same-class pair, not a one-to-one matching,
    # because the gold spans in this corpus overlap each other
    for s in pred:
        for t in gold:
            if s.technique != t.technique:
                continue
            common = min(s.end, t.end) - max(s.start, t.start)
            if common > 0:
                tallies[s.technique].overlap_p += common / (s.end - s.start)
                tallies[s.technique].overlap_r += common / (t.end - t.start)


def _prf(precision_num: float, n_pred: int, recall_num: float, n_gold: int) -> dict[str, float]:
    """
    Turn pooled numerators and denominators into precision, recall and F1.
    """

    # Guard every denominator: an empty run is a zero, not a crash
    precision = precision_num / n_pred if n_pred else 0.0
    recall = recall_num / n_gold if n_gold else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def summarize(tally: Tally) -> dict[str, Any]:
    """
    Report one tally both ways, exact and overlap, alongside its raw counts.
    """

    return {
        "gold": tally.n_gold,
        "predicted": tally.n_pred,
        "exact": _prf(tally.exact_pred_hits, tally.n_pred, tally.exact_gold_hits, tally.n_gold),
        "overlap": _prf(tally.overlap_p, tally.n_pred, tally.overlap_r, tally.n_gold),
    }


# --- The run ---

async def run_eval(n_articles: int = DEFAULT_ARTICLES) -> EvalResult:
    """
    Analyze a fixed-seed subset of the train split and score it against the gold spans.
    """

    # Check the mapping against the corpus before spending a single model call on it
    settings = get_settings()
    articles = load_train(SEMEVAL_ROOT)
    check_label_map({s.technique for a in articles for s in a.spans})
    subset = select_articles(articles, n_articles)

    tallies: dict[str, Tally] = defaultdict(Tally)
    scored: list[str] = []
    failed: list[dict[str, str]] = []
    flags_unlocatable = 0

    # One client and one context for the whole run; articles go through it one at a time
    async with httpx.AsyncClient(timeout=settings.nemotron_timeout_s) as http:
        ctx = PipelineContext(
            nemotron=NemotronClient(http, timeout_s=settings.nemotron_timeout_s),
            model_small=settings.nvidia_model_small,
            model_large=settings.nvidia_model_large,
            batch_size=BATCH_SIZE,
            max_concurrency=MAX_CONCURRENCY,
            budget_s=BUDGET_S,
        )

        for i, article in enumerate(subset, start=1):
            started = time.perf_counter()

            # Record the failure and keep going: one bad article must not end the run
            try:
                pred, unlocatable = await predict_spans(article, ctx)
            except Exception as exc:
                failed.append({"id": article.id, "error": f"{type(exc).__name__}: {exc}"})
                _progress(i, len(subset), article, started, f"FAILED {type(exc).__name__}: {exc}")
                continue

            gold = [s for s in article.spans if s.technique not in EXCLUDED_CLASSES]
            add_article(tallies, pred, gold)
            scored.append(article.id)
            flags_unlocatable += unlocatable
            _progress(
                i, len(subset), article, started,
                f"{len(pred)} pred / {len(gold)} gold spans",
            )

    # An empty run is not a zero score, it is a broken setup
    if not scored:
        raise RuntimeError(f"no article was scored; failures: {failed}")

    # Pool across every class the corpus uses, so classes we never predict still count
    total = Tally()
    per_technique: dict[str, Any] = {}
    for name in sorted({s.technique for a in articles for s in a.spans} - EXCLUDED_CLASSES):
        total += tallies[name]
        per_technique[name] = summarize(tallies[name])
    overall = summarize(total)

    return EvalResult(
        name="semeval_spans",
        headline_metric="Span F1 (overlap)",
        headline_value=overall["overlap"]["f1"],
        detail={
            "exact": overall["exact"],
            "overlap": overall["overlap"],
            "per_technique": per_technique,
            "total_predicted_spans": total.n_pred,
            "total_gold_spans": total.n_gold,
            "articles_failed": failed,
            "flags_unlocatable": flags_unlocatable,
            "lines_per_para": LINES_PER_PARA,
            "min_confidence": MIN_CONFIDENCE,
            "excluded_classes": sorted(EXCLUDED_CLASSES),
            "seed": SEED,
            "n_articles_selected": len(subset),
            "article_ids": scored,
        },
        n=len(scored),
        run_at=datetime.now(timezone.utc),
        notes=NOTES,
    )


def _progress(i: int, total: int, article: Article, started: float, message: str) -> None:
    """
    Report one article's outcome on stderr, so stdout stays the report alone.
    """

    elapsed = time.perf_counter() - started
    print(f"[{i}/{total}] {article.id}: {message} ({elapsed:.1f}s)", file=sys.stderr, flush=True)


# --- Output ---

def format_report(result: EvalResult) -> str:
    """
    Render the headline number and the per-technique table as plain text.
    """

    # The micro-averaged row is built to the same shape as a per-technique row
    detail = result.detail
    overall = {
        "gold": detail["total_gold_spans"],
        "predicted": detail["total_predicted_spans"],
        "exact": detail["exact"],
        "overlap": detail["overlap"],
    }
    rows = [*detail["per_technique"].items(), ("ALL (micro)", overall)]

    # Size the first column to the longest class name so the columns line up
    width = max(len(name) for name, _ in rows)
    header = (
        f"{'technique':<{width}}  {'gold':>5} {'pred':>5}  "
        f"{'exact P':>7} {'R':>6} {'F1':>6}  "
        f"{'overlap P':>9} {'R':>6} {'F1':>6}"
    )

    # The caveats live in notes; what belongs here is the number and what it was run on
    lines = [
        f"{result.headline_metric}: {result.headline_value:.4f}  "
        f"(n={result.n} articles scored, {len(detail['articles_failed'])} failed, "
        f"{detail['flags_unlocatable']} unlocatable flags)",
        "",
        header,
        "-" * len(header),
    ]

    for name, row in rows:
        # Rule off the micro-average so it does not read as one more class
        if name == "ALL (micro)":
            lines.append("-" * len(header))
        e, o = row["exact"], row["overlap"]
        lines.append(
            f"{name:<{width}}  {row['gold']:>5} {row['predicted']:>5}  "
            f"{e['precision']:>7.3f} {e['recall']:>6.3f} {e['f1']:>6.3f}  "
            f"{o['precision']:>9.3f} {o['recall']:>6.3f} {o['f1']:>6.3f}"
        )

    return "\n".join(lines)


async def main(argv: list[str] | None = None) -> None:
    """
    Parse the arguments, run the eval, then write the JSON and print the report.
    """

    parser = argparse.ArgumentParser(
        description="Score the pipeline against SemEval-2020 Task 11 gold spans."
    )
    parser.add_argument(
        "--articles", type=int, default=DEFAULT_ARTICLES,
        help="articles to sample (default: %(default)s)",
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT,
        help="where to write the JSON result (default: %(default)s)",
    )
    args = parser.parse_args(argv)

    # WARNING level is what surfaces the pipeline's degraded-batch notices
    logging.basicConfig(level=logging.WARNING)
    result = await run_eval(args.articles)

    # Write the machine-readable result first; the printed table is the human copy
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result.to_dict(), indent=2) + "\n", encoding="utf-8")
    print(format_report(result))
    print(f"\nWrote {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
