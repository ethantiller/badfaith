from fastapi import APIRouter, HTTPException, Request

from backend.app.pipeline.orchestrate import AnalysisError, run_analysis
from backend.app.types import AnalyzeRequest, AnalyzeResponse

router = APIRouter()

@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    responses={
        502: {"description": "The model service returned nothing usable."},
        503: {"description": "Analysis is not configured on this server."},
    },
)
async def analyze(
    payload: AnalyzeRequest,
    request: Request,
):
    # Pipeline contains nemotron client info and request limits
    pipeline = getattr(request.app.state, "pipeline", None)
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Analysis is not configured on this server.")

    try:
        return await run_analysis(payload, pipeline)
    except AnalysisError as exc:
        raise HTTPException(status_code=502, detail=f"Analysis failed: {exc}") from exc
