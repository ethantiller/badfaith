import pytest
from pydantic import ValidationError

from backend.app.pipeline.rewrite import run_rewrite
from backend.app.schemas.models import RawRewrite, RawRewriteBatch
from backend.app.types import RewriteItem, RewriteRequest

TEXT = "The senator's disastrous, reckless bill passed on Tuesday."


class FakeNemotron:
    """`batch` is one reply, or a list of replies served one per call."""

    def __init__(self, batch):
        self.replies = list(batch) if isinstance(batch, list) else [batch]
        self.calls = []

    async def complete_json(self, prompt, model, schema, **kwargs):
        self.calls.append((prompt, kwargs))
        return self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]


class Ctx:
    model_large = "large"

    def __init__(self, batch):
        self.nemotron = FakeNemotron(batch)


def _request():
    return RewriteRequest(
        doc_hash="h",
        title="t",
        items=[RewriteItem(paragraph_id=3, text=TEXT, quote="disastrous, reckless")],
    )


@pytest.mark.asyncio
async def test_unchanged_rewrite_is_dropped_without_a_second_call():
    same = RawRewriteBatch(rewrites=[RawRewrite(index=0, rewrite="Disastrous,  reckless")])
    ctx = Ctx(same)
    assert (await run_rewrite(_request(), ctx)).rewrites == []
    assert len(ctx.nemotron.calls) == 1


@pytest.mark.asyncio
async def test_rewrite_samples_at_the_model_card_settings():
    ctx = Ctx(RawRewriteBatch(rewrites=[RawRewrite(index=0, rewrite="contested")]))
    await run_rewrite(_request(), ctx)
    assert ctx.nemotron.calls[0][1] == {"temperature": 1.0, "top_p": 0.95}


def test_prompt_carries_technique_and_reason():
    from backend.app.pipeline.rewrite import _format_items

    req = RewriteRequest(
        doc_hash="h",
        title="t",
        items=[RewriteItem(paragraph_id=3, text=TEXT, quote="disastrous, reckless", technique="loaded_language", explanation="Charged words.")],
    )
    out = _format_items(req)
    assert "Technique: loaded_language" in out and "Why it was flagged: Charged words." in out


def test_quote_must_be_verbatim():
    with pytest.raises(ValidationError):
        RewriteItem(paragraph_id=0, text=TEXT, quote="not in the paragraph")


@pytest.mark.asyncio
async def test_original_is_echoed_and_bad_indexes_dropped():
    batch = RawRewriteBatch(
        rewrites=[RawRewrite(index=0, rewrite="contested"), RawRewrite(index=9, rewrite="x")]
    )
    response = await run_rewrite(_request(), Ctx(batch))
    assert [(r.paragraph_id, r.original, r.rewrite) for r in response.rewrites] == [
        (3, "disastrous, reckless", "contested")
    ]
