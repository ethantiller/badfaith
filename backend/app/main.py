from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
import httpx

from backend.app.api.analyze import router as analyze_router
from backend.app.api.coverage import router as coverage_router
from backend.app.config import get_settings
from backend.app.db import Database
from backend.app.deps import set_db
from backend.app.ext.nemotron import NemotronClient
from backend.app.middleware.cors import add_cors_middleware
from backend.app.pipeline.orchestrate import PipelineContext

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources on startup/shutdown."""
    settings = get_settings()

    # Initialize database
    db = Database(settings.get_database_url())
    db.init()
    set_db(db)

    # Initialize shared HTTP client for external calls
    app.state.http_client = httpx.AsyncClient(timeout=settings.nemotron_timeout_s)

    # Analysis pipeline for analyze.
    try:
        app.state.pipeline = PipelineContext(
            nemotron=NemotronClient(app.state.http_client, timeout_s=settings.nemotron_timeout_s),
            model_small=settings.nvidia_model_small,
            model_large=settings.nvidia_model_large,
        )
    except RuntimeError as exc:
        logger.warning("analysis pipeline disabled: %s", exc)
        app.state.pipeline = None

    yield

    # Cleanup
    await app.state.http_client.aclose()
    await db.close()


app = FastAPI(title="badfaith", version="0.1.0", lifespan=lifespan, docs_url=None)

add_cors_middleware(app)

app.include_router(analyze_router, prefix="/api/v1")
app.include_router(coverage_router, prefix="/api/v1")

@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
