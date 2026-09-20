import asyncio
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Literal

from backend.app.ext.nemotron import NemotronClient
from backend.app.pipeline.classify import resolve_doc_type
from backend.app.pipeline.ground import verify_quotes
from backend.app.pipeline.label import label_batch
from backend.app.types import AnalyzeMeta, AnalyzeRequest, AnalyzeResponse
from backend.app.utils.text import batch_paragraphs, sample_for_classification

logger = logging.getLogger(__name__)


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
    budget_s: float = 25.0  # whole-request budget; batches unfinished by then are given up


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

    # Wrapper function that acquires a semaphore slot before calling label_batch
    async def run(batch):
        async with slots:
            return await label_batch(batch, doc_type, model, ctx)

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

    flags, claims, failed = [], [], len(pending)

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
        batch_flags, batch_claims = task.result()
        flags += batch_flags
        claims += batch_claims

    if failed:
        logger.warning("analysis degraded: %d of %d batches failed", failed, len(batches))
    if failed == len(batches):
        raise AnalysisError(f"all {len(batches)} batches failed")

    paragraphs = {p.id: p.text for p in req.paragraphs}
    grounded = verify_quotes(flags, claims, paragraphs)
    if grounded.reasons:
        logger.info("grounding dropped %s", grounded.reasons)

    def in_article_order(item):
        return item.paragraph_id, paragraphs[item.paragraph_id].find(item.quote)

    kept_flags = sorted(grounded.flags, key=in_article_order)
    kept_claims = [
        claim.model_copy(update={"id": f"c{n}"})
        for n, claim in enumerate(sorted(grounded.claims, key=in_article_order))
    ]

    return AnalyzeResponse(
        doc_type=doc_type,
        doc_type_source=source,
        flags=kept_flags,
        claims=kept_claims,
        meta=AnalyzeMeta(
            model_route=ctx.label_route,
            latency_ms=round((perf_counter() - started) * 1000),
            flags_dropped=grounded.flags_dropped,
        ),
    )
