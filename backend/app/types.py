"""Public API contracts. Hand-mirror in extension/lib/types.ts."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


# --- Request size caps ---
# Enforced at the schema layer so an oversized payload is rejected before any
# handler runs. See docs/architecture.md section 6, "Security posture".

MAX_PARAGRAPHS = 400
MAX_PARAGRAPH_CHARS = 5_000
MAX_URL_CHARS = 2_048
MAX_TITLE_CHARS = 512


# --- Enums ---

class Technique(StrEnum):
    """Locked list. Free-text names would break the eval mapping."""

    LOADED_LANGUAGE = "loaded_language"
    NAME_CALLING = "name_calling"
    REPETITION = "repetition"
    EXAGGERATION_MINIMIZATION = "exaggeration_minimization"
    DOUBT = "doubt"
    APPEAL_TO_FEAR = "appeal_to_fear"
    FLAG_WAVING = "flag_waving"
    CAUSAL_OVERSIMPLIFICATION = "causal_oversimplification"
    SLOGANS = "slogans"
    APPEAL_TO_AUTHORITY = "appeal_to_authority"
    FALSE_DILEMMA = "false_dilemma"
    THOUGHT_TERMINATING_CLICHE = "thought_terminating_cliche"
    WHATABOUTISM = "whataboutism"
    STRAW_MAN = "straw_man"
    RED_HERRING = "red_herring"
    BANDWAGON = "bandwagon"


class Severity(StrEnum):
    """Flag severity level."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class VerificationStatus(StrEnum):
    """Claim verification status from /coverage."""
    SUPPORTED = "supported"
    CONTRADICTED = "contradicted"
    UNVERIFIED = "unverified"


class DocType(StrEnum):
    NEWS = "news"
    OPINION = "opinion"
    OTHER = "other"


class DocTypeSource(StrEnum):
    METADATA = "metadata"
    MODEL = "model"


class ClaimType(StrEnum):
    STATISTIC = "statistic"
    ATTRIBUTED_QUOTE = "attributed_quote"
    DATE_OR_COUNT = "date_or_count"


# --- Search / Coverage ---

class Article(BaseModel):
    outlet: str
    url: str
    headline: str
    snippet: str
    seendate: str


class CoverageRequest(BaseModel):
    doc_hash: str
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
    doc_hash: str
    summary: str
    related: list[RelatedSource]
    meta: CoverageMeta


# --- Analysis ---

class Paragraph(BaseModel):
    """One numbered paragraph as the content script extracted it."""

    id: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=MAX_PARAGRAPH_CHARS)


class AnalyzeRequest(BaseModel):
    url: str = Field(min_length=1, max_length=MAX_URL_CHARS)
    title: str = Field(default="", max_length=MAX_TITLE_CHARS)
    section_hint: Literal["opinion", "news"] | None = None
    paragraphs: list[Paragraph] = Field(min_length=1, max_length=MAX_PARAGRAPHS)


class Flag(BaseModel):
    paragraph_id: int
    quote: str
    technique: Technique
    severity: Severity
    confidence: float
    explanation: str


class Claim(BaseModel):
    id: str = ""  # numbered c0..cN in paragraph order, post-grounding
    paragraph_id: int
    quote: str
    claim_type: ClaimType
    entities: list[str] = Field(default_factory=list)


class AnalyzeMeta(BaseModel):
    cached: bool = False
    doc_hash: str = ""  # filled by the route once hashing exists
    model_route: str  # which model tier labeled; values pending
    latency_ms: int
    flags_dropped: int = 0  # grounding gate reject count


class AnalyzeResponse(BaseModel):
    doc_type: DocType
    doc_type_source: DocTypeSource
    flags: list[Flag] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    meta: AnalyzeMeta


__all__ = [
    "Technique",
    "Severity",
    "VerificationStatus",
    "DocType",
    "DocTypeSource",
    "ClaimType",
    "Article",
    "CoverageRequest",
    "RelatedSource",
    "Omission",
    "CoverageMeta",
    "CoverageResponse",
    "MAX_PARAGRAPHS",
    "MAX_PARAGRAPH_CHARS",
    "MAX_URL_CHARS",
    "MAX_TITLE_CHARS",
    "Paragraph",
    "AnalyzeRequest",
    "Flag",
    "Claim",
    "AnalyzeMeta",
    "AnalyzeResponse",
]
