from types import SimpleNamespace

import pytest

from backend.app.pipeline import speakers
from backend.app.schemas.models import RawCitation, RawCitationBatch, RawSpeakerRole, RawSpeakerRoleBatch
from backend.app.types import Paragraph, SpeakerRole


class FakeNemotron:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []

    async def complete_json(self, prompt, model, schema, **_):
        self.prompts.append(prompt)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def make_ctx(nemotron):
    return SimpleNamespace(nemotron=nemotron, model_small="small", model_large="large", max_concurrency=4)


def test_quoted_paragraphs_keeps_only_paragraphs_with_quote_marks():
    paragraphs = [
        Paragraph(id=0, text="No quotes here."),
        Paragraph(id=1, text='He said "we will act."'),
        Paragraph(id=2, text="She said “never”."),
    ]
    assert [p.id for p in speakers.quoted_paragraphs(paragraphs)] == [1, 2]


@pytest.mark.asyncio
async def test_extract_citations_skips_call_without_quoted_paragraphs():
    nemotron = FakeNemotron()
    result = await speakers.extract_citations([Paragraph(id=0, text="Plain.")], "m", make_ctx(nemotron))
    assert result == [] and nemotron.prompts == []


@pytest.mark.asyncio
async def test_extract_citations_defaults_blank_speaker_to_anonymous():
    batch = RawCitationBatch(
        citations=[
            RawCitation(paragraph_id=1, quote="we will act", speaker="  "),
            RawCitation(paragraph_id=1, quote="soon", speaker="Jane Doe"),
        ]
    )
    result = await speakers.extract_citations(
        [Paragraph(id=1, text='"we will act" and "soon"')], "m", make_ctx(FakeNemotron(batch))
    )
    assert [(c.speaker, c.speaker_role) for c in result] == [
        ("anonymous", SpeakerRole.ANONYMOUS),
        ("Jane Doe", SpeakerRole.UNKNOWN),
    ]


class FakeSearcher:
    def __init__(self, results):
        self.results, self.queries = results, []

    def text(self, query, max_results):
        self.queries.append(query)
        return self.results


@pytest.mark.asyncio
async def test_resolve_roles_searches_each_named_speaker_once_and_skips_anonymous():
    searcher = FakeSearcher([{"title": "Jane Doe", "body": "Secretary of Health"}])
    nemotron = FakeNemotron(
        RawSpeakerRoleBatch(roles=[RawSpeakerRole(speaker="Jane Doe", role="Government Official")])
    )
    roles = await speakers.resolve_roles(
        ["Jane Doe", "anonymous", "Jane Doe"], "Title", make_ctx(nemotron), searcher=searcher
    )
    assert roles == {"Jane Doe": SpeakerRole.GOVERNMENT_OFFICIAL}
    assert len(searcher.queries) == 1


@pytest.mark.asyncio
async def test_resolve_roles_is_unknown_without_search_evidence():
    nemotron = FakeNemotron()  # must not be called
    roles = await speakers.resolve_roles(["Jane Doe"], "Title", make_ctx(nemotron), searcher=FakeSearcher([]))
    assert roles == {"Jane Doe": SpeakerRole.UNKNOWN} and nemotron.prompts == []


@pytest.mark.asyncio
async def test_resolve_roles_ignores_invalid_or_unsupported_roles_and_model_failure():
    searcher = FakeSearcher([{"title": "t", "body": "b"}])
    bad = RawSpeakerRoleBatch(
        roles=[RawSpeakerRole(speaker="Jane Doe", role="wizard"), RawSpeakerRole(speaker="Made Up", role="journalist")]
    )
    roles = await speakers.resolve_roles(["Jane Doe"], "T", make_ctx(FakeNemotron(bad)), searcher=searcher)
    assert roles == {"Jane Doe": SpeakerRole.UNKNOWN}

    roles = await speakers.resolve_roles(
        ["Jane Doe"], "T", make_ctx(FakeNemotron(RuntimeError("boom"))), searcher=searcher
    )
    assert roles == {"Jane Doe": SpeakerRole.UNKNOWN}
