import pytest
from ddgs.exceptions import DDGSException
from fastapi import HTTPException

from backend.app.schemas import Article
from backend.app.api import coverage


@pytest.mark.asyncio
async def test_coverage_calls_web_search(monkeypatch):
    calls = {}

    async def fake_search(**kwargs):
        calls.update(kwargs)
        return [
            Article(
                outlet="Reuters",
                url="https://reuters.com/story",
                headline="Example headline",
                snippet="Example context",
                seendate="2026-09-19",
            )
        ]

    monkeypatch.setattr(coverage, "search", fake_search)

    request = coverage.CoverageRequest(
        doc_hash="sha256:test",
        claim_id="c0",
        quote="unemployment fell",
        entities=["unemployment"],
        title="Employment report",
    )

    response = await coverage.get_coverage(request)

    assert calls == {
        "title": "Employment report",
        "entities": ["unemployment"],
        "max_records": 50,
        "timelimit": "m",
    }
    assert response.claim_id == "c0"
    assert response.status == "unverified"
    assert response.meta.sources_queried == 1
    assert response.related[0].outlet == "Reuters"


@pytest.mark.asyncio
async def test_coverage_returns_not_found_when_search_has_no_articles(monkeypatch):
    async def fake_search(**kwargs):
        return []

    monkeypatch.setattr(coverage, "search", fake_search)

    request = coverage.CoverageRequest(
        doc_hash="sha256:test",
        claim_id="c0",
        quote="claim",
        entities=["claim"],
        title="Story",
    )

    with pytest.raises(HTTPException) as error:
        await coverage.get_coverage(request)

    assert error.value.status_code == 404
    assert error.value.detail == "No related news articles were found."


@pytest.mark.asyncio
async def test_coverage_returns_service_error_for_search_failure(monkeypatch):
    async def fake_search(**kwargs):
        raise DDGSException("provider unavailable")

    monkeypatch.setattr(coverage, "search", fake_search)

    request = coverage.CoverageRequest(
        doc_hash="sha256:test",
        claim_id="c0",
        quote="claim",
        entities=["claim"],
        title="Story",
    )

    with pytest.raises(HTTPException) as error:
        await coverage.get_coverage(request)

    assert error.value.status_code == 500
    assert error.value.detail == "DDGSException: provider unavailable"
