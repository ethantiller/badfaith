"""Public API contracts. Hand-mirror in extension/lib/types.ts."""

from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator


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
    NEWS_WITH_HEAVY_BIAS = "news_with_heavy_bias"
    NEWS_WITH_SLIGHT_BIAS = "news_with_slight_bias"
    OPINION = "opinion"
    OTHER = "other"


class DocTypeSource(StrEnum):
    METADATA = "metadata"
    MODEL = "model"


class ClaimType(StrEnum):
    STATISTIC = "statistic"
    ATTRIBUTED_QUOTE = "attributed_quote"
    DATE_OR_COUNT = "date_or_count"


class SpeakerRole(StrEnum):
    """Locked list. What a quoted speaker is, from search evidence; drives the bias note in the UI."""

    GOVERNMENT_OFFICIAL = "government_official"
    ELECTED_POLITICIAN = "elected_politician"
    JOURNALIST = "journalist"
    ACADEMIC_EXPERT = "academic_expert"
    INDUSTRY_CORPORATE = "industry_corporate"
    FUNDER_DONOR = "funder_donor"
    ADVOCACY_ACTIVIST = "advocacy_activist"
    THINK_TANK = "think_tank"
    LEGAL_COURT = "legal_court"
    PRIVATE_INDIVIDUAL = "private_individual"
    ANONYMOUS = "anonymous"
    UNKNOWN = "unknown"


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

# Size caps live here, not in Settings: Field(max_length=...) is evaluated at import.
MAX_PARAGRAPHS = 300
MAX_CHARS_PER_PARAGRAPH = 4000
MAX_TOTAL_CHARS = 200_000


class Paragraph(BaseModel):
    id: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=MAX_CHARS_PER_PARAGRAPH)


class AnalyzeRequest(BaseModel):
    url: str = Field(max_length=2048)
    title: str = Field(max_length=500)
    section_hint: Literal["opinion", "news"] | None = None  # None: the page gave no hint
    paragraphs: list[Paragraph] = Field(min_length=1, max_length=MAX_PARAGRAPHS)

    @model_validator(mode="after")
    def _check_paragraphs(self) -> Self:
        ids = [p.id for p in self.paragraphs]
        if len(set(ids)) != len(ids):
            raise ValueError("paragraph ids must be unique")
        if sum(len(p.text) for p in self.paragraphs) > MAX_TOTAL_CHARS:
            raise ValueError(f"article text exceeds {MAX_TOTAL_CHARS} characters")
        return self


class Flag(BaseModel):
    paragraph_id: int
    quote: str
    technique: Technique
    severity: Severity
    confidence: float
    explanation: str
    flags_dropped: int = 0  # grounding gate reject count

class Claim(BaseModel):
    id: str = ""  # numbered c0..cN in paragraph order, post-grounding
    paragraph_id: int
    quote: str
    claim_type: ClaimType
    entities: list[str] = Field(default_factory=list)


class Citation(BaseModel):
    id: str = ""  # numbered s0..sN in article order, post-grounding
    paragraph_id: int
    quote: str
    speaker: str  # as the paragraph names them, or "anonymous"
    speaker_role: SpeakerRole = SpeakerRole.UNKNOWN


class AnalyzeMeta(BaseModel):
    cached: bool = False
    doc_hash: str = ""  # filled by the route once hashing exists
    model_route: str  # which model tier labeled; values pending
    latency_ms: int

class AnalyzeResponse(BaseModel):
    doc_type: DocType
    doc_type_source: DocTypeSource
    flags: list[Flag] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    meta: AnalyzeMeta


MAX_REWRITE_ITEMS = 40
MAX_QUOTE_CHARS = 1000


class RewriteItem(BaseModel):
    paragraph_id: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=MAX_CHARS_PER_PARAGRAPH)  # the paragraph, for context
    quote: str = Field(min_length=1, max_length=MAX_QUOTE_CHARS)  # the flagged passage to rewrite
    technique: Technique | None = None
    explanation: str = Field(default="", max_length=1000)  # why the labeler flagged it

    @model_validator(mode="after")
    def _quote_in_text(self) -> Self:
        if self.quote not in self.text:
            raise ValueError(f"quote is not verbatim in paragraph {self.paragraph_id}")
        return self


class RewriteRequest(BaseModel):
    doc_hash: str = Field(max_length=128)
    title: str = Field(max_length=500)
    items: list[RewriteItem] = Field(min_length=1, max_length=MAX_REWRITE_ITEMS)


class Rewrite(BaseModel):
    paragraph_id: int
    original: str  # echoed from the request, never model output, so it is always verbatim
    rewrite: str


class RewriteMeta(BaseModel):
    model_route: str
    latency_ms: int


class RewriteResponse(BaseModel):
    doc_hash: str
    rewrites: list[Rewrite] = Field(default_factory=list)
    meta: RewriteMeta


__all__ = [
    "Technique",
    "Severity",
    "VerificationStatus",
    "DocType",
    "DocTypeSource",
    "ClaimType",
    "SpeakerRole",
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
    "Citation",
    "AnalyzeMeta",
    "AnalyzeResponse",
    "RewriteItem",
    "RewriteRequest",
    "Rewrite",
    "RewriteMeta",
    "RewriteResponse",
]
