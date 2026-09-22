"""Loader for the SemEval-2020 Task 11 PTC corpus (v2), train split.

Reads the already-extracted corpus from ``eval/datasets/semeval/`` using only the
standard library. Gold labels are the Task 2 (technique classification) spans:
``train-task2-TC.labels``, tab-separated ``article_id, technique, start, end`` with
``start`` inclusive, ``end`` exclusive, and offsets counted in characters of the raw
``.txt`` file. Technique names keep SemEval's raw spelling; mapping onto our own
enum belongs to the runner.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parent / "datasets" / "semeval"
TRAIN_ARTICLES_DIR = "train-articles"
TRAIN_LABELS_FILE = "train-task2-TC.labels"

_DOWNLOAD_HINT = (
    "Download datasets-v2.tgz from the SemEval-2020 Task 11 Zenodo record "
    "(https://zenodo.org/records/3952415) and extract it into {root}."
)


# --- Corpus types ---

@dataclass(frozen=True)
class GoldSpan:
    """One human-labeled propaganda span, in SemEval's own vocabulary."""

    technique: str  # raw SemEval spelling
    start: int  # inclusive character offset into Article.text
    end: int  # exclusive character offset into Article.text


@dataclass(frozen=True)
class Article:
    """One article file and every gold span annotated on it."""

    id: str
    title: str  # line 1
    text: str  # the full raw file contents, unmodified
    spans: list[GoldSpan]


@dataclass(frozen=True)
class Para:
    """A contiguous slice of Article.text, as handed to the pipeline."""

    id: int
    start: int  # character offset of this paragraph in Article.text
    text: str


# --- Loading ---

def _read_raw(path: Path) -> str:
    """
    Read a file with newline translation off, so the label offsets stay valid.
    """

    with path.open(encoding="utf-8", newline="") as f:
        return f.read()


def _load_spans(labels_path: Path) -> dict[str, list[GoldSpan]]:
    """
    Parse the aggregate labels file into gold spans keyed by article id.
    """

    spans: dict[str, list[GoldSpan]] = {}

    with labels_path.open(encoding="utf-8", newline="") as f:
        for lineno, line in enumerate(f, start=1):
            # Skip the blank lines the distributed files end with
            line = line.rstrip("\r\n")
            if not line:
                continue

            # Refuse a malformed row rather than score against offsets we guessed at
            parts = line.split("\t")
            if len(parts) != 4:
                raise ValueError(
                    f"{labels_path}:{lineno}: expected 4 tab-separated fields, got {line!r}"
                )

            # Offsets are the whole point of this file, so a non-integer is fatal too
            article_id, technique, start, end = parts
            try:
                span = GoldSpan(technique, int(start), int(end))
            except ValueError:
                raise ValueError(
                    f"{labels_path}:{lineno}: non-integer offset in {line!r}"
                ) from None

            spans.setdefault(article_id, []).append(span)

    return spans


def load_train(root: Path | None = None) -> list[Article]:
    """
    Load every train article with its gold spans, sorted by article id.
    """

    # Point at the download rather than fail deep inside a glob that quietly finds nothing
    root = DEFAULT_ROOT if root is None else Path(root)
    articles_dir = root / TRAIN_ARTICLES_DIR
    labels_path = root / TRAIN_LABELS_FILE
    for path in (articles_dir, labels_path):
        if not path.exists():
            raise FileNotFoundError(
                f"SemEval train data not found: {path}. " + _DOWNLOAD_HINT.format(root=root)
            )

    spans_by_id = _load_spans(labels_path)

    # Pop each article's spans as it is read, so anything left over is a mismatch
    articles: list[Article] = []
    for path in articles_dir.glob("article*.txt"):
        article_id = path.stem.removeprefix("article")
        text = _read_raw(path)
        spans = sorted(spans_by_id.pop(article_id, []), key=lambda s: (s.start, s.end, s.technique))

        # An offset past the end of the text means the corpus and the labels disagree
        for s in spans:
            if not 0 <= s.start < s.end <= len(text):
                raise ValueError(
                    f"article {article_id}: span {s} is outside the text (length {len(text)})"
                )

        title = text.split("\n", 1)[0]
        articles.append(Article(id=article_id, title=title, text=text, spans=spans))

    # Labels with no article would silently deflate recall, so say so instead
    if spans_by_id:
        raise ValueError(
            f"{labels_path} has labels for articles missing from {articles_dir}: "
            f"{sorted(spans_by_id)[:5]}"
        )

    # Sorting by id is what keeps a fixed-seed sample reproducible across machines
    articles.sort(key=lambda a: a.id)
    return articles


# --- Paragraphs ---

def build_paragraphs(article: Article, lines_per_para: int = 3) -> list[Para]:
    """
    Split an article into paragraphs while keeping character offsets linear.

    Paragraph 0 is the title line alone (start 0). The blank line after the title is
    skipped; the remaining body lines are grouped into consecutive chunks of
    ``lines_per_para`` and joined with ``"\\n"``, so each paragraph is a contiguous slice
    of ``article.text``:

        article.text[p.start : p.start + len(p.text)] == p.text

    Groups that are entirely whitespace are dropped and ids are renumbered from 0 with no
    gaps. If line 2 is not blank (a handful of articles carry a subtitle there), it is body
    text and is grouped like any other line rather than lost.
    """

    if lines_per_para < 1:
        raise ValueError(f"lines_per_para must be >= 1, got {lines_per_para}")

    lines = article.text.split("\n")
    if article.text.endswith("\n"):
        lines.pop()  # the final newline terminates the last line; it does not start another

    # Walk the lines once to record where each one starts in the raw text
    starts: list[int] = []
    offset = 0
    for line in lines:
        starts.append(offset)
        offset += len(line) + 1

    # The title stands alone; the body is grouped from line 2, or line 1 if there is no blank
    groups: list[tuple[int, str]] = [(0, lines[0])]
    first_body = 2 if len(lines) > 1 and not lines[1].strip() else 1
    for i in range(first_body, len(lines), lines_per_para):
        groups.append((starts[i], "\n".join(lines[i : i + lines_per_para])))

    # Drop whitespace-only groups, then renumber so the ids the pipeline sees have no gaps
    kept = [(start, text) for start, text in groups if text.strip()]
    return [Para(id=i, start=start, text=text) for i, (start, text) in enumerate(kept)]
