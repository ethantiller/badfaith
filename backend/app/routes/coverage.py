from fastapi import APIRouter

import coverage_type

router = APIRouter()

CoverageRequest = coverage_type.CoverageRequest
CoverageResponse = coverage_type.CoverageResponse
RelatedSource = coverage_type.RelatedSource
Omission = coverage_type.Omission
CoverageMeta = coverage_type.CoverageMeta


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