from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
ROBOTS_PATH = STATIC_DIR / "robots.txt"

def add_static_files(app: FastAPI) -> None:
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/robots.txt", include_in_schema=False)
    async def robots_txt() -> FileResponse:
        return FileResponse(ROBOTS_PATH, media_type="text/plain")