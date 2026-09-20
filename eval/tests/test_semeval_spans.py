import asyncio
from collections import defaultdict

import pytest

from backend.app.types import AnalyzeMeta, AnalyzeResponse, DocType, DocTypeSource, Flag, Severity, Technique
from eval.load import Article, GoldSpan, load_train
from eval.runners import semeval_spans as runner
from eval.runners.semeval_spans import LABEL_MAP, Span, Tally, add_article, check_label_map, summarize


def score(pred: list[Span], gold: list[GoldSpan]) -> dict[str, Tally]:
    tallies: dict[str, Tally] = defaultdict(Tally)
    add_article(tallies, pred, gold)
    return tallies


def pooled(tallies: dict[str, Tally]) -> dict:
    total = Tally()
    for tally in tallies.values():
        total += tally
    return summarize(total)


def test_label_map_matches_the_gold_classes():
    articles = load_train(runner.SEMEVAL_ROOT)
    check_label_map({s.technique for a in articles for s in a.spans})


def test_label_map_rejects_a_misspelled_class():
    gold = set(LABEL_MAP.values())
    check_label_map(gold)
    with pytest.raises(AssertionError):
        check_label_map((gold - {"Exaggeration,Minimisation"}) | {"Exaggeration,Minimization"})


def test_select_articles_is_fixed_seed_and_skips_articles_without_spans():
    articles = [
        Article(id=str(i), title="t", text="x" * 20, spans=[GoldSpan("Doubt", 0, 5)] if i % 4 else [])
        for i in range(40)
    ]
    first = runner.select_articles(articles, 10)
    assert [a.id for a in first] == [a.id for a in runner.select_articles(articles, 10)]
    assert len(first) == 10 and all(a.spans for a in first)
    assert len(runner.select_articles(articles, 1000)) == 30  # capped at the usable pool


def test_exact_match_needs_identical_offsets_and_class():
    gold = [GoldSpan("Doubt", 0, 10), GoldSpan("Repetition", 20, 30)]
    pred = [Span("Doubt", 0, 10), Span("Repetition", 20, 31)]
    result = pooled(score(pred, gold))
    assert result["exact"]["precision"] == 0.5
    assert result["exact"]["recall"] == 0.5


def test_overlap_needs_the_same_class():
    tallies = score([Span("Doubt", 0, 10)], [GoldSpan("Loaded_Language", 0, 10)])
    result = pooled(tallies)
    assert result["overlap"]["f1"] == 0.0


def test_overlap_credit_is_normalized_by_each_span_length():
    # 5 shared characters: half of a 10-char prediction, a fifth of a 25-char gold span.
    tally = score([Span("Doubt", 20, 30)], [GoldSpan("Doubt", 0, 25)])["Doubt"]
    assert (tally.overlap_p, tally.overlap_r) == (0.5, 0.2)
    assert summarize(tally)["exact"]["f1"] == 0.0


def test_overlapping_gold_spans_are_not_matched_one_to_one():
    # One prediction covering two overlapping gold spans earns credit against both.
    gold = [GoldSpan("Doubt", 0, 10), GoldSpan("Doubt", 5, 20)]
    tally = score([Span("Doubt", 0, 20)], gold)["Doubt"]
    assert tally.overlap_p == 10 / 20 + 15 / 20
    assert tally.overlap_r == 10 / 10 + 15 / 15


def test_micro_average_pools_counts_across_articles():
    tallies: dict[str, Tally] = defaultdict(Tally)
    add_article(tallies, [Span("Doubt", 0, 10)], [GoldSpan("Doubt", 0, 10)])  # perfect
    add_article(tallies, [], [GoldSpan("Doubt", 0, 10)])  # missed entirely
    result = summarize(tallies["Doubt"])
    assert result["overlap"] == {"precision": 1.0, "recall": 0.5, "f1": pytest.approx(2 / 3)}


def test_no_predictions_scores_zero_without_dividing_by_zero():
    result = pooled(score([], [GoldSpan("Doubt", 0, 10)]))
    assert result["overlap"] == {"precision": 0.0, "recall": 0.0, "f1": 0.0}


def flag(paragraph_id: int, quote: str, technique: Technique) -> Flag:
    return Flag(
        paragraph_id=paragraph_id, quote=quote, technique=technique,
        severity=Severity.LOW, confidence=0.5, explanation="",
    )


def test_predict_spans_converts_flags_to_article_offsets(monkeypatch):
    # Paragraphs: 0 = title, 1 = "first..third", 2 = "fourth..sixth", 3 = "seventh doubt doubt".
    text = "Title line\n\nfirst\nsecond doubt here\nthird\nfourth\nfifth\nsixth\nseventh doubt doubt"
    article = Article(id="1", title="Title line", text=text, spans=[])
    flags = [
        flag(1, "doubt", Technique.DOUBT),
        flag(3, "doubt doubt", Technique.STRAW_MAN),
        flag(3, "doubt", Technique.DOUBT),  # occurs twice in its paragraph: the first one wins
        flag(1, "not in the paragraph", Technique.DOUBT),  # unlocatable
        flag(99, "doubt", Technique.DOUBT),  # unknown paragraph: unlocatable
    ]

    async def fake_run_analysis(req, ctx):
        assert req.url == "semeval://1" and req.section_hint is None
        assert [p.id for p in req.paragraphs] == [0, 1, 2, 3]
        return AnalyzeResponse(
            doc_type=DocType.NEWS, doc_type_source=DocTypeSource.MODEL, flags=flags,
            meta=AnalyzeMeta(model_route="large", latency_ms=1),
        )

    monkeypatch.setattr(runner, "run_analysis", fake_run_analysis)
    spans, unlocatable = asyncio.run(runner.predict_spans(article, ctx=None))

    second = text.index("second doubt") + len("second ")
    seventh = text.index("seventh doubt") + len("seventh ")
    assert unlocatable == 2
    assert spans == [
        Span("Doubt", second, second + 5),
        Span("Whataboutism,Straw_Men,Red_Herring", seventh, seventh + 11),
        Span("Doubt", seventh, seventh + 5),
    ]
    assert all(text[s.start : s.end] in {"doubt", "doubt doubt"} for s in spans)
