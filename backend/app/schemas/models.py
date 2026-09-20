"""Shapes Nemotron is asked to return, kept separate from the public response schema.

Deliberately lenient (plain str, defaults) so one bad label degrades one item instead of
failing a batch. The pipeline coerces these into the strict types in types.py.
"""

from pydantic import BaseModel, Field


class RawClassification(BaseModel):
    doc_type: str


class RawFlag(BaseModel):
    paragraph_id: int
    quote: str
    technique: str
    severity: str = "medium"
    confidence: float = 0.5
    explanation: str = ""


class RawClaim(BaseModel):
    paragraph_id: int
    quote: str
    claim_type: str
    entities: list[str] = Field(default_factory=list)


class RawLabelBatch(BaseModel):
    flags: list[RawFlag] = Field(default_factory=list)
    claims: list[RawClaim] = Field(default_factory=list)


class RawOmission(BaseModel):
    summary: str
    corroborating_urls: list[str] = Field(default_factory=list)


class RawVerification(BaseModel):
    status: str
    omissions: list[RawOmission] = Field(default_factory=list)


class RawArticleSummary(BaseModel):
    summary: str


class RawCitation(BaseModel):
    paragraph_id: int
    quote: str
    speaker: str = ""


class RawCitationBatch(BaseModel):
    citations: list[RawCitation] = Field(default_factory=list)


class RawSpeakerRole(BaseModel):
    speaker: str
    role: str = "unknown"


class RawSpeakerRoleBatch(BaseModel):
    roles: list[RawSpeakerRole] = Field(default_factory=list)
