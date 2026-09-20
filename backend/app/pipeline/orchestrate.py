import asyncio
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Literal

from backend.app.ext.nemotron import NemotronClient
from backend.app.pipeline.classify import resolve_doc_type
from backend.app.pipeline.ground import verify_quotes
from backend.app.pipeline.label import label_batch
from backend.app.pipeline.speakers import extract_citations, resolve_roles
from backend.app.types import AnalyzeMeta, AnalyzeRequest, AnalyzeResponse, DocType
from backend.app.utils.hashing import doc_hash
from backend.app.utils.text import batch_paragraphs, sample_for_classification

logger = logging.getLogger(__name__)

MIN_FLAG_CONFIDENCE = 0.85  # flags the model is less sure of are not shown or counted


class AnalysisError(Exception):
    """No batch produced a usable result, so there is nothing honest to return."""


@dataclass
class PipelineContext:
    nemotron: NemotronClient
    model_small: str
    model_large: str
    label_route: Literal["small", "large"] = "large"  # which model labels; the routing eval flips it
    batch_size: int = 5
    max_concurrency: int = 8  # simultaneous model calls, to stay inside API rate limits
    budget_s: float = 60.0  # whole-request budget; batches unfinished by then are given up


async def run_analysis(req: AnalyzeRequest, ctx: PipelineContext) -> AnalyzeResponse:
    """
    Combines all the modules to turn the given text into the expected response.
    """

    # Start timer
    started = perf_counter()

    # Determine News or Opinion
    doc_type, source = await resolve_doc_type(
        req.section_hint, req.title, sample_for_classification(req.paragraphs), ctx
    )

    model = ctx.model_large if ctx.label_route == "large" else ctx.model_small
    batches = batch_paragraphs(req.paragraphs, ctx.batch_size)
    slots = asyncio.Semaphore(ctx.max_concurrency)

    async def cite(batch):
        # Citations are best-effort: a failed extraction loses this batch's citations only.
        try:
            async with slots:
                return await extract_citations(batch, model, ctx)
        except Exception as error:
            logger.warning("citation extraction failed: %s: %s", type(error).__name__, error)
            return []

    # Wrapper that runs the label call and the citation call side by side for one batch.
    # Only the label call decides whether the batch failed.
    async def run(batch):
        async def label():
            async with slots:
                return await label_batch(batch, doc_type, model, ctx)

        (flags, claims), citations = await asyncio.gather(label(), cite(batch))
        return flags, claims, citations

    # Schedule all batch tasks immediately (they queue for semaphore slots as needed)
    tasks = [asyncio.create_task(run(batch)) for batch in batches]

    # Calculate remaining time budget for this request
    remaining = max(ctx.budget_s - (perf_counter() - started), 0.0)

    # Wait for all tasks to complete or timeout, whichever comes first
    _, pending = await asyncio.wait(tasks, timeout=remaining)

    # Cancel any tasks that didn't finish before the timeout
    for task in pending:
        task.cancel()

    # Gracefully wait for cancelled tasks to shut down
    await asyncio.gather(*pending, return_exceptions=True)

    flags, claims, citations, failed = [], [], [], len(pending)

    # Loop through all tasks to collect results
    for task in tasks:
        # Skip tasks that were cancelled due to timeout
        if task in pending:
            continue
        # Check if the task raised an exception
        error = task.exception()
        if error is not None:
            failed += 1
            logger.warning("batch failed: %s: %s", type(error).__name__, error)
            continue
        # Extract and accumulate flags and claims from successful tasks
        batch_flags, batch_claims, batch_citations = task.result()
        flags += batch_flags
        claims += batch_claims
        citations += batch_citations

    if failed:
        logger.warning("analysis degraded: %d of %d batches failed", failed, len(batches))
    if failed == len(batches):
        raise AnalysisError(f"all {len(batches)} batches failed")

    paragraphs = {p.id: p.text for p in req.paragraphs}

    # Use deps function to confirm flags and claims are in the original request
    grounded_flags = [
        flag
        for flag in _keep_grounded(flags, "flags", paragraphs, article_json)
        if flag.confidence >= MIN_FLAG_CONFIDENCE
    ]
    grounded_claims = _keep_grounded(claims, "claims", paragraphs, article_json)
    grounded_citations = _keep_grounded(citations, "citations", paragraphs, article_json)

    def in_article_order(item):
        return item.paragraph_id, paragraphs[item.paragraph_id].find(item.quote)

    kept_flags = [
        flag.model_copy(update={"flags_dropped": result.flags_dropped})
        for flag in sorted(result.flags, key=in_article_order)
    ]
    kept_claims = [
        claim.model_copy(update={"id": f"c{n}"})
        for n, claim in enumerate(sorted(grounded_claims, key=in_article_order))
    ]
    
    # Look up each distinct speaker once; whatever is not resolved in time stays unknown.
    remaining = max(ctx.budget_s - (perf_counter() - started), 0.0)
    try:
        roles = await asyncio.wait_for(
            resolve_roles([c.speaker for c in grounded_citations], req.title, ctx), timeout=remaining
        )
    except asyncio.TimeoutError:
        logger.warning("speaker lookup ran out of time budget")
        roles = {}
    kept_citations = [
        citation.model_copy(
            update={
                "id": f"s{n}",
                "speaker_role": roles.get(citation.speaker, citation.speaker_role),
            }
        )
        for n, citation in enumerate(sorted(grounded_citations, key=in_article_order))
    ]

    # Bias tier comes only from the confident flagged phrases; claims and citations never count.
    if len(kept_flags) > 10 and doc_type == DocType.NEWS:
        doc_type = DocType.NEWS_WITH_HEAVY_BIAS
    elif 0 < len(kept_flags) <= 10 and doc_type == DocType.NEWS:
        doc_type = DocType.NEWS_WITH_SLIGHT_BIAS

    return AnalyzeResponse(
        doc_type=doc_type,
        doc_type_source=source,
        flags=kept_flags,
        claims=kept_claims,
        citations=kept_citations,
        meta=AnalyzeMeta(
            doc_hash=doc_hash(req.url, req.paragraphs),
            model_route=ctx.label_route,
            latency_ms=round((perf_counter() - started) * 1000),
        ),
    )
