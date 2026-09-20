import hashlib
from typing import AsyncGenerator
from uuid import UUID

from fastapi import Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db import Database

import json
import logging

logging.basicConfig(level=logging.INFO)

db: Database | None = None


def set_db(database: Database | None) -> None:
    global db
    db = database


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    if db is None:
        raise RuntimeError("Database not initialized")
    async for session in db.get_session():
        yield session


def extract_user_id(token: str) -> UUID:
    """
    Extract user ID from token. Currently generates a deterministic UUID from the token.
    TODO: Replace with real Supabase JWT verification.
    """
    hash_digest = hashlib.sha256(token.encode()).digest()
    return UUID(bytes=hash_digest[:16])


def ensure_quote_in_text(response: str, actual_paragraphs: str) -> bool:
    try:
        response_data = json.loads(response)
    except json.JSONDecodeError:
        logging.error("Failed to decode JSON")
        return False

    try:
        actual_data = json.loads(actual_paragraphs)
    except json.JSONDecodeError:
        actual_data = None

    nemotron_quotes = []
    for item_type in ("claims", "flags"):
        for item in response_data.get(item_type, []):
            nemotron_quotes.append(item["quote"])

    if isinstance(actual_data, dict):
        actual_quotes = [
            paragraph["text"]
            for paragraph in actual_data.get("paragraphs", [])
        ]
    else:
        actual_quotes = [actual_paragraphs]

    for quote in nemotron_quotes:
        if not any(quote in paragraph for paragraph in actual_quotes):
            return False

    return True

