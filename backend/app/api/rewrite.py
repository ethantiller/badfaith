from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.deps import get_db_session
from backend.app.ext.supabase import get_current_user
from backend.app.middleware.rate_limit import check_rate_limit, increment_rate_limit
from backend.app.pipeline.rewrite import run_rewrite
from backend.app.types import RewriteRequest, RewriteResponse

router = APIRouter()


@router.post(
    "/rewrite",
    response_model=RewriteResponse,
    responses={
        429: {"description": "Rate limit exceeded."},
        502: {"description": "The model service returned nothing usable."},
        503: {"description": "Rewrite is not configured on this server."},
    },
)
async def rewrite(
    payload: RewriteRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user_payload: Annotated[dict, Depends(get_current_user)],
):
    """Rewrite flagged, opinionated passages in neutral language."""
    user_id = UUID(user_payload["sub"])

    allowed, limit_info = await check_rate_limit(session, user_id)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. User: {limit_info['user_count']}/{limit_info['user_limit']}, "
            f"Global: {limit_info['global_count']}/{limit_info['global_limit']}",
        )

    pipeline = getattr(request.app.state, "pipeline", None)
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Rewrite is not configured on this server.")

    try:
        response = await run_rewrite(payload, pipeline)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Neutral rewrite failed: {exc}") from exc

    await increment_rate_limit(session, user_id)
    return response
