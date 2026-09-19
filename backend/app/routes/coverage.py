from time import perf_counter

from ddgs.exceptions import DDGSException
from fastapi import APIRouter, HTTPException

from backend.app.lib.helpers.web_search import search
from backend.app.lib import types

router = APIRouter()

CoverageRequest = types.CoverageRequest
CoverageResponse = types.CoverageResponse
RelatedSource = types.RelatedSource
Omission = types.Omission
CoverageMeta = types.CoverageMeta


@router.post(
    "/coverage",
    response_model=CoverageResponse,
    responses={
        404: {"description": "No related news articles were found."},
        500: {"description": "Internal server error."},
    },
)
async def get_coverage(request: CoverageRequest):
    """
    Endpoint to retrieve coverage information for a claim.
    """
    started_at = perf_counter()
    try:
        articles = await search(
            title=request.title,
            entities=request.entities,
            max_records=50,
            timelimit="m",
        )
    except DDGSException as exc:
        if "no results found" in str(exc).lower():
            raise HTTPException(
                status_code=404,
                detail="No related news articles were found.",
            ) from exc
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

    if not articles:
        raise HTTPException(
            status_code=404,
            detail="No related news articles were found.",
        )

    related = [
        RelatedSource(
            outlet=article.outlet,
            url=article.url,
            headline=article.headline,
            snippet=article.snippet,
            seendate=article.seendate,
        )
        for article in articles
    ]

    return CoverageResponse(
        claim_id=request.claim_id,
        status="unverified",
        related=related,
        omissions=[],
        meta=CoverageMeta(
            sources_queried=len(related),
            latency_ms=round((perf_counter() - started_at) * 1000),
        ),
    )