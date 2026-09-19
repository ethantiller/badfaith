from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db import RateLimit, GlobalRateLimit


# Configurable limits
PER_USER_LIMIT = 100  # requests per hour
GLOBAL_LIMIT = 10000  # requests per hour


def get_hour_bucket() -> str:
    """Get current hour bucket in format YYYY-MM-DD-HH."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d-%H")


async def check_rate_limit(session: AsyncSession, user_id: UUID) -> tuple[bool, dict]:
    """
    Check if user is within rate limits.

    Returns:
        (allowed: bool, info: dict with current counts and limits)
    """
    hour_bucket = get_hour_bucket()

    # Get user's rate limit for current hour
    user_result = await session.execute(
        select(RateLimit).where(
            RateLimit.uid == user_id,
            RateLimit.hour_bucket == hour_bucket,
        )
    )
    user_limit = user_result.scalar_one_or_none()
    user_count = user_limit.request_count if user_limit else 0

    # Get global rate limit for current hour
    global_result = await session.execute(
        select(GlobalRateLimit).where(GlobalRateLimit.hour_bucket == hour_bucket)
    )
    global_limit = global_result.scalar_one_or_none()
    global_count = global_limit.request_count if global_limit else 0

    # Check limits
    user_allowed = user_count < PER_USER_LIMIT
    global_allowed = global_count < GLOBAL_LIMIT
    allowed = user_allowed and global_allowed

    info = {
        "user_count": user_count,
        "user_limit": PER_USER_LIMIT,
        "global_count": global_count,
        "global_limit": GLOBAL_LIMIT,
        "hour_bucket": hour_bucket,
    }

    return allowed, info


async def increment_rate_limit(session: AsyncSession, user_id: UUID) -> None:
    """Increment rate limit counters for user and global."""
    hour_bucket = get_hour_bucket()

    # Upsert user rate limit
    user_result = await session.execute(
        select(RateLimit).where(
            RateLimit.uid == user_id,
            RateLimit.hour_bucket == hour_bucket,
        )
    )
    user_limit = user_result.scalar_one_or_none()

    if user_limit:
        user_limit.request_count = (user_limit.request_count or 0) + 1
    else:
        user_limit = RateLimit(
            uid=user_id,
            hour_bucket=hour_bucket,
            request_count=1,
        )
        session.add(user_limit)

    # Upsert global rate limit
    global_result = await session.execute(
        select(GlobalRateLimit).where(GlobalRateLimit.hour_bucket == hour_bucket)
    )
    global_limit = global_result.scalar_one_or_none()

    if global_limit:
        global_limit.request_count = (global_limit.request_count or 0) + 1
    else:
        global_limit = GlobalRateLimit(
            hour_bucket=hour_bucket,
            request_count=1,
        )
        session.add(global_limit)

    await session.commit()
