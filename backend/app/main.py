from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx

from backend.app.config import get_settings
from backend.app.db import Database
from backend.app.deps import set_db
from backend.app.api.coverage import router as coverage_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources on startup/shutdown."""
    settings = get_settings()

    # Initialize database
    db = Database(settings.database_url)
    db.init()
    set_db(db)

    # Initialize shared HTTP client for external calls
    app.state.http_client = httpx.AsyncClient(timeout=settings.nemotron_timeout_s)

    yield

    # Cleanup
    await app.state.http_client.aclose()
    await db.close()


def create_app() -> FastAPI:
    """Construct and configure the FastAPI application."""
    settings = get_settings()
    app = FastAPI(title="badfaith", version="0.1.0", lifespan=lifespan, docs_url=None)

    # CORS middleware — allow only the Chrome extension origin
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.extension_origin],
        allow_credentials=True,
        allow_methods=["POST", "GET"],
        allow_headers=["authorization", "content-type"],
    )

    # Mount routers
    app.include_router(coverage_router)

    # Health check endpoint (no auth required)
    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)