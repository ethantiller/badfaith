from time import perf_counter
from typing import Annotated
from uuid import UUID

from ddgs.exceptions import DDGSException
from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.ext.search import search
from backend.app.ext.search import build_article_summary_prompt
from backend.app.types import CoverageRequest, CoverageResponse, RelatedSource, CoverageMeta
from backend.app.middleware.rate_limit import check_rate_limit, increment_rate_limit
from backend.app.deps import get_db_session
from backend.app.ext.supabase import get_current_user

router = APIRouter()


@router.post(
    "/coverage",
    response_model=CoverageResponse,
    responses={
        404: {"description": "No related news articles were found."},
        429: {"description": "Rate limit exceeded."},
        500: {"description": "Internal server error."},
    },
)
async def get_coverage(
    request: CoverageRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user_payload: Annotated[dict, Depends(get_current_user)],
    http_request: Request = None,
):
    """
    Endpoint to retrieve coverage information for a claim.
    """
    # Extract user ID from JWT payload
    user_id = UUID(user_payload["sub"])

    # Check rate limit
    allowed, limit_info = await check_rate_limit(session, user_id)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. User: {limit_info['user_count']}/{limit_info['user_limit']}, "
            f"Global: {limit_info['global_count']}/{limit_info['global_limit']}",
        )

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

    if http_request is None:
        summary_text = " ".join(article.snippet for article in articles)
    else:
        from backend.app.ext.nemotron import MODEL_SMALL, NemotronClient
        from backend.app.schemas.models import RawArticleSummary

        try:
            summary = await NemotronClient(http_request.app.state.http_client).complete_json(
                build_article_summary_prompt(request.title, articles),
                MODEL_SMALL,
                RawArticleSummary,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
        summary_text = summary.summary

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

    response = CoverageResponse(
        doc_hash=request.doc_hash,
        summary=summary_text,
        related=related,
        meta=CoverageMeta(
            sources_queried=len(related),
            latency_ms=round((perf_counter() - started_at) * 1000),
        ),
    )

    # Increment rate limit after successful response
    await increment_rate_limit(session, user_id)

    return response