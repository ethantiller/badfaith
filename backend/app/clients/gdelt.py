import asyncio
from json import JSONDecodeError
import time
from typing import Any, Sequence

import httpx

from .web_search_types import Article

GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_MIN_INTERVAL_SECONDS = 5.0
GDELT_TIMEOUT_SECONDS = 30.0
_request_lock = asyncio.Lock()
_last_request_at = 0.0


async def _get_with_rate_limit(
	client: httpx.AsyncClient,
	params: dict[str, str],
) -> httpx.Response:
	global _last_request_at

	async with _request_lock:
		wait_seconds = GDELT_MIN_INTERVAL_SECONDS - (
			time.monotonic() - _last_request_at
		)
		if wait_seconds > 0:
			await asyncio.sleep(wait_seconds)

		_last_request_at = time.monotonic()
		response = await client.get(GDELT_DOC_URL, params=params)
		if response.status_code != httpx.codes.TOO_MANY_REQUESTS:
			return response

		retry_after = response.headers.get("Retry-After")
		try:
			retry_delay = max(float(retry_after or 0), GDELT_MIN_INTERVAL_SECONDS)
		except ValueError:
			retry_delay = GDELT_MIN_INTERVAL_SECONDS
		await response.aclose()
		await asyncio.sleep(retry_delay)

		_last_request_at = time.monotonic()
		return await client.get(GDELT_DOC_URL, params=params)


def build_query(title: str, entities: Sequence[str]) -> str:
	terms: list[str] = []
	for value in (title, *entities):
		normalized = " ".join(value.split()).replace('"', "")
		if normalized and normalized not in terms:
			terms.append(normalized)

	if not terms:
		raise ValueError("GDELT searches require a title or at least one entity")

	return " OR ".join(f'"{term}"' for term in terms)

def _article_from_payload(payload: dict[str, Any]) -> Article:
	return Article(
		outlet=str(payload.get("domain") or payload.get("sourcecountry") or "Unknown"),
		url=str(payload.get("url") or ""),
		headline=str(payload.get("title") or ""),
		# The DOC Article List JSON response does not provide article body snippets.
		snippet="",
		seendate=str(payload.get("seendate") or ""),
	)

async def search(
	*,
	title: str,
	entities: Sequence[str],
	max_records: int = 50,
	timespan: str = "3months",
	client: httpx.AsyncClient | None = None,
) -> list[Article]:
	"""Search GDELT DOC 2.0 for related articles.

	Pass an existing AsyncClient from the application lifespan in production. The
	optional client also keeps this function straightforward to unit test.
	"""
	if not 1 <= max_records <= 250:
		raise ValueError("max_records must be between 1 and 250")

	params = {
		"query": build_query(title, entities),
		"mode": "artlist",
		"format": "json",
		"maxrecords": str(max_records),
		"timespan": timespan,
		"sort": "datedesc",
	}

	owns_client = client is None
	request_client = client or httpx.AsyncClient(timeout=GDELT_TIMEOUT_SECONDS)
	try:
		response = await _get_with_rate_limit(request_client, params)
		response.raise_for_status()
		try:
			payload = response.json()
		except JSONDecodeError as exc:
			content_type = response.headers.get("content-type", "unknown")
			body_preview = " ".join(response.text.split())[:500]
			raise RuntimeError(
				"GDELT returned a non-JSON response "
				f"(status={response.status_code}, content_type={content_type}): "
				f"{body_preview}"
			) from exc
	finally:
		if owns_client:
			await request_client.aclose()

	if not isinstance(payload, dict) or not isinstance(payload.get("articles"), list):
		raise ValueError("GDELT returned an unexpected Article List response")

	return [
		_article_from_payload(article)
		for article in payload["articles"]
		if isinstance(article, dict)
	]

if __name__ == "__main__":
	test_result = asyncio.run(search(
		title="climate change",
		entities=[],
		max_records=50,
		timespan="3months",
	))
	print("Test search results:")
	for article in test_result:
		print(f"- {article.headline} ({article.url})")