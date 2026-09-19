from pydantic import BaseModel
from typing import Literal


class Article(BaseModel):
	outlet: str
	url: str
	headline: str
	snippet: str
	seendate: str

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
