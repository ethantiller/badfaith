from contextlib import asynccontextmanager

from fastapi import FastAPI

import uvicorn

from backend.app.api.coverage import router as coverage_router
from backend.app.db import create_database_from_env
from backend.app.deps import set_db
from backend.app.middleware.cors import add_cors_middleware
from backend.app.middleware.static import add_static_files


@asynccontextmanager
async def lifespan(app: FastAPI):
    database = create_database_from_env()
    if database is not None:
        await database.connect()
        set_db(database)

    try:
        yield
    finally:
        if database is not None:
            await database.close()
            set_db(None)


fast_api_app = FastAPI(title="Bad Faith API", version="0.1.0", lifespan=lifespan, docs_url=None)

add_static_files(fast_api_app)
add_cors_middleware(fast_api_app)

fast_api_app.include_router(coverage_router)

@fast_api_app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(fast_api_app, host="0.0.0.0", port=8000)