from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI

ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:8000"]

def add_cors_middleware(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        max_age=600
    )