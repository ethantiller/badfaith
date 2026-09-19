"""The public contract for POST /analyze, hand-mirrored in extension/lib/types.ts.

Strict types only. What Nemotron returns is parsed leniently in models.py and coerced into
these by the pipeline, so a model output change never ripples into this contract.
"""

from enum import StrEnum

from pydantic import BaseModel, Field


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
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


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


class Flag(BaseModel):
    paragraph_id: int
    quote: str
    technique: Technique
    severity: Severity
    confidence: float
    explanation: str


class Claim(BaseModel):
    # Empty until the orchestrator numbers claims c0..cN in paragraph order, after grounding.
    id: str = ""
    paragraph_id: int
    quote: str
    claim_type: ClaimType
    entities: list[str] = Field(default_factory=list)


class AnalyzeMeta(BaseModel):
    cached: bool = False
    doc_hash: str = ""  # filled by the route once hashing exists
    model_route: str  # which model tier labeled the article; values not settled, see docs
    latency_ms: int
    flags_dropped: int = 0  # the grounding gate's reject count


class AnalyzeResponse(BaseModel):
    doc_type: DocType
    doc_type_source: DocTypeSource
    flags: list[Flag] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    meta: AnalyzeMeta
