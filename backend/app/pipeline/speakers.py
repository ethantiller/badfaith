"""Who is quoted, and what kind of source they are.

Two steps: extract_citations reads quoted paragraphs (one model call per batch, run in parallel
with label_batch), then resolve_roles looks each named speaker up on the web and asks the
model to assign a role from the search snippets only. Roles are evidence-based: no snippets,
no role.
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

from backend.app.ext.search import search_speaker
from backend.app.pipeline.label import _format_paragraphs, _to_enum
from backend.app.schemas.models import RawCitationBatch, RawSpeakerRoleBatch
from backend.app.types import Citation, Paragraph, SpeakerRole

if TYPE_CHECKING:
    from backend.app.pipeline.orchestrate import PipelineContext

logger = logging.getLogger(__name__)

_PROMPTS = Path(__file__).parent.parent / "prompts"
_EXTRACT_PROMPT = (_PROMPTS / "speakers.txt").read_text(encoding="utf-8")
_ROLE_PROMPT = (_PROMPTS / "speaker_roles.txt").read_text(encoding="utf-8")

# Straight, curly, low-9 and guillemet quotation marks.
_QUOTE_MARKS = re.compile('["“”„«»]')
MAX_SPEAKERS = 15  # bounds search and prompt size per article
ANONYMOUS = "anonymous"


def quoted_paragraphs(paragraphs: list[Paragraph]) -> list[Paragraph]:
    """Paragraphs that contain a quotation mark: the only ones that can hold a citation."""
    return [p for p in paragraphs if _QUOTE_MARKS.search(p.text)]


async def extract_citations(paragraphs: list[Paragraph], model: str, ctx: PipelineContext) -> list[Citation]:
    """
    One model call over the quoted paragraphs of a batch. Roles are left `unknown` here;
    resolve_roles fills them in. Raises NemotronError on failure; the orchestrator degrades.
    """
    quoted = quoted_paragraphs(paragraphs)
    if not quoted:
        return []

    prompt = _EXTRACT_PROMPT.format(paragraphs=_format_paragraphs(quoted))
    raw = await ctx.nemotron.complete_json(prompt, model, RawCitationBatch)

    citations = []
    for item in raw.citations:
        speaker = " ".join(item.speaker.split()) or ANONYMOUS
        role = SpeakerRole.ANONYMOUS if speaker.lower() == ANONYMOUS else SpeakerRole.UNKNOWN
        citations.append(
            Citation(paragraph_id=item.paragraph_id, quote=item.quote, speaker=speaker, speaker_role=role)
        )
    return citations


async def resolve_roles(
    speakers: list[str], title: str, ctx: PipelineContext, *, searcher: Any | None = None
) -> dict[str, SpeakerRole]:
    """
    Map each distinct named speaker to a role. Never raises: any failure leaves the affected
    speakers `unknown`. Anonymous speakers are not searched.
    """
    named = list(dict.fromkeys(s for s in speakers if s.lower() != ANONYMOUS))[:MAX_SPEAKERS]
    roles = {s: SpeakerRole.UNKNOWN for s in named}
    if not named:
        return roles

    slots = asyncio.Semaphore(ctx.max_concurrency)

    async def lookup(name: str) -> list[str]:
        async with slots:
            try:
                return await search_speaker(name, title, searcher=searcher)
            except Exception as error:  # a failed lookup must not sink the analysis
                logger.warning("speaker search failed for %r: %s", name, error)
                return []

    results = await asyncio.gather(*(lookup(name) for name in named))
    evidence = {name: snippets for name, snippets in zip(named, results) if snippets}
    if not evidence:
        return roles

    block = "\n\n".join(
        f"Speaker: {name}\n" + "\n".join(f"- {snippet}" for snippet in snippets)
        for name, snippets in evidence.items()
    )
    prompt = _ROLE_PROMPT.format(title=title, speakers=block)
    try:
        raw = await ctx.nemotron.complete_json(prompt, ctx.model_small, RawSpeakerRoleBatch)
    except Exception as error:
        logger.warning("speaker role call failed: %s: %s", type(error).__name__, error)
        return roles

    for item in raw.roles:
        role = _to_enum(SpeakerRole, item.role)
        # Only roles backed by search evidence count; the model may not assign anonymous.
        if item.speaker in evidence and role is not None and role != SpeakerRole.ANONYMOUS:
            roles[item.speaker] = role
    return roles
