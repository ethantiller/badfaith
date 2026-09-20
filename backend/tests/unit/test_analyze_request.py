"""Size caps on AnalyzeRequest are part of the contract, not a handler concern."""

import pytest
from pydantic import ValidationError

from backend.app.types import (
    MAX_PARAGRAPHS,
    MAX_PARAGRAPH_CHARS,
    MAX_TITLE_CHARS,
    MAX_URL_CHARS,
    AnalyzeRequest,
)


def _paragraphs(n: int) -> list[dict]:
    return [{"id": i, "text": f"Paragraph {i} body text."} for i in range(n)]


def test_accepts_a_minimal_request():
    request = AnalyzeRequest(
        url="https://example.com/politics/article",
        title="Senate passes funding bill",
        section_hint="opinion",
        paragraphs=_paragraphs(2),
    )

    assert request.section_hint == "opinion"
    assert [p.id for p in request.paragraphs] == [0, 1]


def test_title_and_section_hint_are_optional():
    request = AnalyzeRequest(url="https://example.com/a", paragraphs=_paragraphs(1))

    assert request.title == ""
    assert request.section_hint is None


def test_rejects_an_empty_paragraph_list():
    with pytest.raises(ValidationError):
        AnalyzeRequest(url="https://example.com/a", paragraphs=[])


def test_rejects_too_many_paragraphs():
    with pytest.raises(ValidationError):
        AnalyzeRequest(
            url="https://example.com/a",
            paragraphs=_paragraphs(MAX_PARAGRAPHS + 1),
        )


def test_accepts_exactly_the_paragraph_ceiling():
    request = AnalyzeRequest(
        url="https://example.com/a",
        paragraphs=_paragraphs(MAX_PARAGRAPHS),
    )

    assert len(request.paragraphs) == MAX_PARAGRAPHS


def test_rejects_an_oversized_paragraph():
    with pytest.raises(ValidationError):
        AnalyzeRequest(
            url="https://example.com/a",
            paragraphs=[{"id": 0, "text": "x" * (MAX_PARAGRAPH_CHARS + 1)}],
        )


def test_rejects_an_empty_paragraph_body():
    with pytest.raises(ValidationError):
        AnalyzeRequest(url="https://example.com/a", paragraphs=[{"id": 0, "text": ""}])


def test_rejects_a_negative_paragraph_id():
    with pytest.raises(ValidationError):
        AnalyzeRequest(
            url="https://example.com/a",
            paragraphs=[{"id": -1, "text": "Body."}],
        )


def test_rejects_an_oversized_url_or_title():
    with pytest.raises(ValidationError):
        AnalyzeRequest(url="h" * (MAX_URL_CHARS + 1), paragraphs=_paragraphs(1))

    with pytest.raises(ValidationError):
        AnalyzeRequest(
            url="https://example.com/a",
            title="t" * (MAX_TITLE_CHARS + 1),
            paragraphs=_paragraphs(1),
        )


def test_rejects_an_unknown_section_hint():
    with pytest.raises(ValidationError):
        AnalyzeRequest(
            url="https://example.com/a",
            section_hint="sports",
            paragraphs=_paragraphs(1),
        )
