from backend.app.pipeline.ground import (
    EMPTY_QUOTE,
    NOT_FOUND,
    WRONG_PARAGRAPH,
    verify_quotes,
)
from backend.app.types import Claim, ClaimType, Flag, Severity, Technique


def make_flag(paragraph_id: int, quote: str) -> Flag:
    return Flag(
        paragraph_id=paragraph_id,
        quote=quote,
        technique=Technique.LOADED_LANGUAGE,
        severity=Severity.LOW,
        confidence=0.9,
        explanation="test",
    )


def make_claim(paragraph_id: int, quote: str) -> Claim:
    return Claim(paragraph_id=paragraph_id, quote=quote, claim_type=ClaimType.STATISTIC)


def test_exact_match_is_kept():
    paragraphs = {0: "The senator called the bill a disaster."}

    result = verify_quotes([make_flag(0, "a disaster")], [make_claim(0, "the bill")], paragraphs)

    assert [f.quote for f in result.flags] == ["a disaster"]
    assert [c.quote for c in result.claims] == ["the bill"]
    assert result.flags_dropped == 0
    assert result.claims_dropped == 0
    assert result.reasons == {}


def test_curly_quote_and_en_dash_variant_matches_and_is_rewritten_to_paragraph_text():
    paragraphs = {0: "She said “it’s a 2020–2024 plan” and left."}

    result = verify_quotes([make_flag(0, "\"it's a 2020-2024 plan\"")], [], paragraphs)

    assert len(result.flags) == 1
    assert result.flags[0].quote == "“it’s a 2020–2024 plan”"
    assert result.flags[0].quote in paragraphs[0]
    assert result.flags_dropped == 0


def test_quote_only_in_another_paragraph_is_dropped_as_wrong_paragraph():
    paragraphs = {0: "Nothing notable here.", 1: "Officials called the plan reckless."}

    result = verify_quotes([make_flag(0, "called the plan reckless")], [], paragraphs)

    assert result.flags == []
    assert result.flags_dropped == 1
    assert result.reasons == {WRONG_PARAGRAPH: 1}


def test_fabricated_quote_is_dropped_as_not_found():
    paragraphs = {0: "Nothing notable here.", 1: "Officials met on Tuesday."}

    result = verify_quotes([make_flag(0, "a total catastrophe")], [], paragraphs)

    assert result.flags == []
    assert result.flags_dropped == 1
    assert result.reasons == {NOT_FOUND: 1}


def test_empty_quote_is_dropped_as_empty_quote():
    paragraphs = {0: "Nothing notable here."}

    result = verify_quotes([make_flag(0, "")], [make_claim(0, "   ")], paragraphs)

    assert result.flags == []
    assert result.claims == []
    assert result.flags_dropped == 1
    assert result.claims_dropped == 1
    assert result.reasons == {EMPTY_QUOTE: 2}


def test_quote_appearing_twice_resolves_to_first_occurrence():
    paragraphs = {0: "It was bad. Then it was bad again."}

    result = verify_quotes([make_flag(0, "was bad")], [], paragraphs)

    assert len(result.flags) == 1
    assert result.flags[0].quote == "was bad"
    assert paragraphs[0].find(result.flags[0].quote) == paragraphs[0].index("was bad") == 3
