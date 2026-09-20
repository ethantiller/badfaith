from __future__ import annotations

import logging
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, TypeVar

from backend.app.pipeline.classify import SEVERITY_POLICY
from backend.app.schemas.models import RawLabelBatch
from backend.app.types import Claim, ClaimType, DocType, Flag, Paragraph, Severity, Technique

if TYPE_CHECKING:
    from backend.app.pipeline.orchestrate import PipelineContext

logger = logging.getLogger(__name__)

_PROMPT = (Path(__file__).parent.parent / "prompts" / "label.txt").read_text(encoding="utf-8")

E = TypeVar("E", bound=StrEnum)


def _to_enum(enum_cls: type[E], value: str) -> E | None:
    """
    Strip white space, convert to lowercase, hiphens and spaces convert to underscores
    """
    try:
        return enum_cls(value.strip().lower().replace("-", "_").replace(" ", "_"))
    except ValueError:
        return None


def _format_paragraphs(paragraphs: list[Paragraph]) -> str:
    # One line per paragraph, so article text can't forget a "[id]" line of its own.
    return "\n".join(f"[{p.id}] {' '.join(p.text.split())}" for p in paragraphs)


async def label_batch(
    paragraphs: list[Paragraph], 
    doc_type: DocType, 
    model: str, 
    ctx: PipelineContext
    ) -> tuple[list[Flag], list[Claim]]:
    """
    One model call per batch, returning both flags and claims.

    Raises NemotronError if the call fails after its retries and reprompt. The orchestrator
    owns what a failed batch means for the request; nothing is swallowed here.
    """

    prompt = _PROMPT.format(doc_type=doc_type.value, paragraphs=_format_paragraphs(paragraphs))
    raw = await ctx.nemotron.complete_json(prompt, model, RawLabelBatch)

    policy = SEVERITY_POLICY.get(doc_type, {})
    flags: list[Flag] = []
    for item in raw.flags:
        technique = _to_enum(Technique, item.technique)
        if technique is None:
            logger.info("skipping flag with unknown technique %r", item.technique)
            continue
        # A grounded flag is never dropped over its severity: fall back to medium.
        severity = _to_enum(Severity, item.severity) or Severity.MEDIUM
        flags.append(
            Flag(
                paragraph_id=item.paragraph_id,
                quote=item.quote,
                technique=technique,
                severity=policy.get(technique, severity),
                confidence=max(0.0, min(1.0, item.confidence)),
                explanation=item.explanation,
            )
        )

    claims: list[Claim] = []
    for item in raw.claims:
        claim_type = _to_enum(ClaimType, item.claim_type)
        if claim_type is None:
            logger.info("skipping claim with unknown type %r", item.claim_type)
            continue
        claims.append(
            Claim(
                paragraph_id=item.paragraph_id,
                quote=item.quote,
                claim_type=claim_type,
                entities=item.entities,
            )
        )
    return flags, claims
