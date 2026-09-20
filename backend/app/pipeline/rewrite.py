"""Neutral rewrite: replace flagged, opinionated passages with plain wording.

One model call over all the items. The model returns only a `rewrite` keyed by item index;
`original` is echoed from the request, so every result stays grounded to a paragraph ID and a
verbatim quote by construction.
"""

from __future__ import annotations

from pathlib import Path
from time import perf_counter
from typing import TYPE_CHECKING

from backend.app.schemas.models import RawRewriteBatch
from backend.app.types import Rewrite, RewriteMeta, RewriteRequest, RewriteResponse

if TYPE_CHECKING:
    from backend.app.pipeline.orchestrate import PipelineContext

# NVIDIA's model card for Nemotron 3 Super: always sample at 1.0 / 0.95. Detection stays at the
# client default of 0.0; rewriting is generative and copies its input when decoded greedily.
REWRITE_TEMPERATURE = 1.0
REWRITE_TOP_P = 0.95

_PROMPT = (Path(__file__).parent.parent / "prompts" / "rewrite.txt").read_text(encoding="utf-8")


def _format_items(req: RewriteRequest) -> str:
    blocks = []
    for index, item in enumerate(req.items):
        lines = [
            f"[{index}] Paragraph {item.paragraph_id}: {' '.join(item.text.split())}",
            f"Flagged passage: {item.quote}",
        ]
        if item.technique is not None:
            lines.append(f"Technique: {item.technique.value}")
        if item.explanation:
            lines.append(f"Why it was flagged: {' '.join(item.explanation.split())}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _same(a: str, b: str) -> bool:
    return " ".join(a.split()).casefold() == " ".join(b.split()).casefold()


async def run_rewrite(req: RewriteRequest, ctx: PipelineContext) -> RewriteResponse:
    """
    One model call over every item, reasoning off. Raises NemotronError if the reply is
    unparseable. A rewrite that only echoes its original is omitted, not shown as a no-op.
    """
    started = perf_counter()
    prompt = _PROMPT.format(title=req.title, items=_format_items(req))
    raw = await ctx.nemotron.complete_json(
        prompt,
        ctx.model_large,
        RawRewriteBatch,
        temperature=REWRITE_TEMPERATURE,
        top_p=REWRITE_TOP_P,
    )

    by_index: dict[int, str] = {}
    for item in raw.rewrites:
        if not 0 <= item.index < len(req.items):
            continue
        text = " ".join(item.rewrite.split())
        if text and not _same(text, req.items[item.index].quote):
            by_index.setdefault(item.index, text)

    rewrites = [
        Rewrite(paragraph_id=item.paragraph_id, original=item.quote, rewrite=by_index[i])
        for i, item in enumerate(req.items)
        if i in by_index
    ]
    return RewriteResponse(
        doc_hash=req.doc_hash,
        rewrites=rewrites,
        meta=RewriteMeta(model_route="large", latency_ms=round((perf_counter() - started) * 1000)),
    )
