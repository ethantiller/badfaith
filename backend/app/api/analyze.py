from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.deps import get_current_user, get_db_session
from backend.app.middleware.rate_limit import check_rate_limit, increment_rate_limit
from backend.app.pipeline.orchestrate import AnalysisError, run_analysis
from backend.app.types import AnalyzeRequest, AnalyzeResponse

router = APIRouter()


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    responses={
        429: {"description": "Rate limit exceeded."},
        502: {"description": "The model service returned nothing usable."},
        503: {"description": "Analysis is not configured on this server."},
    },
)
async def analyze(
    payload: AnalyzeRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user_id: Annotated[UUID, Depends(get_current_user)],
):
    """Auth, rate limit and delegation. The pipeline does the work."""

    # Pipeline contains nemotron client info and request limits
    pipeline = getattr(request.app.state, "pipeline", None)

    if pipeline is None:
        raise HTTPException(status_code=503, detail="Analysis is not configured on this server.")

    allowed, limit_info = await check_rate_limit(session, user_id)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. User: {limit_info['user_count']}/{limit_info['user_limit']}, "
            f"Global: {limit_info['global_count']}/{limit_info['global_limit']}",
        )

    # TODO(cache): once doc_hash is frozen, look up CachedAnalysis here (meta.cached=True on a
    # hit) and write the result back after a miss.
    
    try:
        response = await run_analysis(payload, pipeline)
    except AnalysisError as exc:
        raise HTTPException(status_code=502, detail=f"Analysis failed: {exc}") from exc

    # Only successful analyses count against the limit, as in /coverage.
    await increment_rate_limit(session, user_id)

    return response
