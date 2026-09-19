from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter()


class CoverageRequest(BaseModel):
    doc_hash: str
    claim_id: str
    quote: str
    entities: list[str]
    title: str


class RelatedSource(BaseModel):
    outlet: str
    url: str
    headline: str
    snippet: str
    seendate: str


class Omission(BaseModel):
    summary: str
    corroborating_urls: list[str]


class CoverageMeta(BaseModel):
    sources_queried: int
    latency_ms: int


class CoverageResponse(BaseModel):
    claim_id: str
    status: Literal["supported", "contradicted", "unverified"]
    related: list[RelatedSource]
    omissions: list[Omission]
    meta: CoverageMeta


@router.post("/coverage", response_model=CoverageResponse)
async def get_coverage(request: CoverageRequest) -> CoverageResponse:
    """
    Endpoint to retrieve coverage information for a claim.
    """
    return CoverageResponse(
        claim_id=request.claim_id,
        status="unverified",
        related=[],
        omissions=[],
        meta=CoverageMeta(sources_queried=0, latency_ms=0),
    )