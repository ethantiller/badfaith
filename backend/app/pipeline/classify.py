from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from backend.app.ext.nemotron import NemotronError
from backend.app.schemas.models import RawClassification
from backend.app.types import DocType, DocTypeSource, Paragraph, Severity, Technique

if TYPE_CHECKING:
    from backend.app.pipeline.orchestrate import PipelineContext

logger = logging.getLogger(__name__)

_PROMPT = (Path(__file__).parent.parent / "prompts" / "classify.txt").read_text(encoding="utf-8")

# Wording that is expected in opinion writing and a red flag in straight reporting. This is a
# starting point for editorial review. The policy changes a flag's severity only; it never
# removes one.
_STYLISTIC = (
    Technique.LOADED_LANGUAGE,
    Technique.NAME_CALLING,
    Technique.EXAGGERATION_MINIMIZATION,
    Technique.REPETITION,
    Technique.SLOGANS,
    Technique.FLAG_WAVING,
)

# Techniques not listed keep the severity the model gave them.
SEVERITY_POLICY: dict[DocType, dict[Technique, Severity]] = {
    DocType.NEWS: {t: Severity.HIGH for t in _STYLISTIC},
    DocType.OPINION: {t: Severity.LOW for t in _STYLISTIC},
    DocType.OTHER: {},
}


async def resolve_doc_type(
    section_hint: str | None, title: str, sample: list[Paragraph], ctx: PipelineContext
) -> tuple[DocType, DocTypeSource]:
    """Return the doc type and where it came from.

    A page-supplied hint wins with no model call. Otherwise one small-model call; if it fails
    or returns something unknown, fall back to OTHER, whose severity policy changes nothing.
    """
    if section_hint:
        return DocType(section_hint), DocTypeSource.METADATA

    prompt = _PROMPT.format(
        title=" ".join(title.split()),
        sample="\n\n".join(" ".join(p.text.split()) for p in sample),
    )
    try:
        raw = await ctx.nemotron.complete_json(prompt, ctx.model_small, RawClassification)
    except NemotronError as exc:
        logger.warning("doc type classification failed, using 'other': %s", exc)
        return DocType.OTHER, DocTypeSource.MODEL

    try:
        return DocType(raw.doc_type.strip().lower()), DocTypeSource.MODEL
    except ValueError:
        logger.warning("model returned unknown doc type %r, using 'other'", raw.doc_type)
        return DocType.OTHER, DocTypeSource.MODEL
