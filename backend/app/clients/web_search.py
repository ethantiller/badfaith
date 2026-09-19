import asyncio
from collections.abc import Sequence
from datetime import datetime, timezone
import re
from typing import Any
from urllib.parse import urlparse

from ddgs import DDGS
from ddgs.exceptions import DDGSException

from .web_search_types import Article

WEB_SEARCH_TIMEOUT_SECONDS = 15
URL_DATE_PATTERN = re.compile(r"(?<!\d)(20\d{2})[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])(?!\d)")
BLOCKED_DOMAINS = frozenset({
	"facebook.com",
	"quora.com",
	"reddit.com",
	"stackexchange.com",
	"wikipedia.org",
	"youtube.com",
})


def build_query(title: str, entities: Sequence[str]) -> str:
	terms: list[str] = []
	for value in (title, *entities):
		normalized = " ".join(value.split()).replace('"', "")
		if normalized and normalized not in terms:
			terms.append(normalized)

	if not terms:
		raise ValueError("Web searches require a title or at least one entity")

	return " OR ".join(f'"{term}"' for term in terms)


def _outlet_from_url(url: str) -> str:
	hostname = _canonical_domain(url)
	name = hostname.split(".")[0]
	return name.replace("-", " ").title() or "Unknown"


def _canonical_domain(url: str) -> str:
	hostname = (urlparse(url).hostname or "").lower().rstrip(".")
	for prefix in ("www.", "en."):
		if hostname.startswith(prefix):
			hostname = hostname[len(prefix):]
	return hostname


def _is_blocked_domain(domain: str) -> bool:
	return any(domain == blocked or domain.endswith(f".{blocked}") for blocked in BLOCKED_DOMAINS)


def _date_from_url(url: str) -> str | None:
	match = URL_DATE_PATTERN.search(url)
	if not match:
		return None
	return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"


def _article_from_result(result: dict[str, Any]) -> Article | None:
	url = str(result.get("href") or result.get("url") or "").strip()
	domain = _canonical_domain(url)
	if not url or not urlparse(url).scheme or not urlparse(url).netloc or _is_blocked_domain(domain):
		return None

	seendate = str(result.get("date") or _date_from_url(url) or datetime.now(timezone.utc).isoformat())

	return Article(
		outlet=str(result.get("source") or _outlet_from_url(url)).strip(),
		url=url,
		headline=str(result.get("title") or ""),
		snippet=str(result.get("body") or result.get("snippet") or ""),
		seendate=seendate,
	)


async def search(
	*,
	title: str,
	entities: Sequence[str],
	max_records: int = 50,
	timelimit: str | None = "m",
	searcher: Any | None = None,
) -> list[Article]:
	"""Search DuckDuckGo for articles related to a claim.

	The ddgs package exposes synchronous DDGS. Run it in a worker thread so it does
	not block FastAPI's event loop.
	"""
	if not 1 <= max_records <= 50:
		raise ValueError("max_records must be between 1 and 50")
	if timelimit not in {None, "d", "w", "m", "y"}:
		raise ValueError("timelimit must be None, 'd', 'w', 'm', or 'y'")

	query = build_query(title, entities)
	request_searcher = searcher or DDGS(timeout=WEB_SEARCH_TIMEOUT_SECONDS)
	candidate_limit = min(max_records * 3, 50)
	results = await asyncio.to_thread(
		request_searcher.news,
		query,
		max_results=candidate_limit,
		timelimit=timelimit,
	)
	articles: list[Article] = []
	seen_domains: set[str] = set()
	for result in results:
		article = _article_from_result(result)
		if article is None:
			continue
		domain = _canonical_domain(article.url)
		if domain in seen_domains:
			continue
		seen_domains.add(domain)
		articles.append(article)
		if len(articles) >= max_records:
			break
	return articles


async def main() -> None:
	try:
		results = await search(
		title="climate change",
		entities=[],
		max_records=50,
			timelimit="y",
)
	except DDGSException as exc:
		print(f"DuckDuckGo returned no results or rejected the request: {exc}")
		return

	if not results:
		print("No usable news results found.")
		return

	for article in results:
		print(f"- {article.headline} ({article.url})")


if __name__ == "__main__":
	import asyncio

	asyncio.run(main())