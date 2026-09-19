from datetime import datetime

from sqlalchemy import Column, String, Integer, JSON, DateTime, ForeignKey, PrimaryKeyConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class CachedAnalysis(Base):
    __tablename__ = "cached_analyses"

    doc_hash = Column(String, primary_key=True)
    url = Column(String, nullable=False)
    analysis_result = Column(JSON, nullable=False)
    cached_at = Column(DateTime, nullable=True, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    created_by = Column(PG_UUID(as_uuid=True), nullable=True)


class CachedCoverage(Base):
    __tablename__ = "cached_coverage"
    __table_args__ = (PrimaryKeyConstraint("doc_hash", "claim_id"),)

    doc_hash = Column(String, primary_key=True)
    claim_id = Column(String, primary_key=True)
    coverage_result = Column(JSON, nullable=False)
    cached_at = Column(DateTime, nullable=True, default=datetime.utcnow)


class RateLimit(Base):
    __tablename__ = "rate_limits"
    __table_args__ = (PrimaryKeyConstraint("uid", "hour_bucket"),)

    uid = Column(PG_UUID(as_uuid=True), primary_key=True)
    hour_bucket = Column(String, primary_key=True)
    request_count = Column(Integer, nullable=True, default=0)


class GlobalRateLimit(Base):
    __tablename__ = "global_rate_limit"

    hour_bucket = Column(String, primary_key=True)
    request_count = Column(Integer, nullable=True, default=0)
