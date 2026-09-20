.PHONY: help install dev test lint format clean db-setup

help:
	@echo "Bad Faith Backend — Make targets:"
	@echo ""
	@echo "  install         Install dependencies"
	@echo "  dev             Start FastAPI server with auto-reload"
	@echo "  server          Start FastAPI server (no auto-reload)"
	@echo "  test            Run pytest"
	@echo "  test-watch      Run pytest in watch mode"
	@echo "  lint            Run ruff and mypy"
	@echo "  format          Format code with black and isort"
	@echo "  clean           Remove cache and build files"
	@echo "  db-setup        Create database tables from ORM models"
	@echo ""

install:
	@echo "Installing dependencies..."
	uv sync

dev:
	@echo "Starting FastAPI server with auto-reload..."
	uv run uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000

server:
	@echo "Starting FastAPI server..."
	uv run uvicorn backend.app.main:app --host 0.0.0.0 --port 8000

test:
	@echo "Running tests..."
	uv run pytest backend/tests/ -v

test-watch:
	@echo "Running tests in watch mode..."
	uv run pytest-watch backend/tests/ -v

lint:
	@echo "Linting code..."
	uv run ruff check backend/app/
	uv run mypy backend/app/ --ignore-missing-imports

format:
	@echo "Formatting code..."
	uv run black backend/app/
	uv run isort backend/app/

clean:
	@echo "Cleaning cache and build files..."
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true

db-setup:
	@echo "Creating database tables from ORM models..."
	uv run python -c "import asyncio; from backend.app.config import get_settings; from backend.app.db import Database; settings = get_settings(); asyncio.run(Database(settings.get_database_url()).create_all())"

env-example:
	@echo "Creating .env.example template..."
	@echo "# Backend Configuration" > .env.example
	@echo "DATABASE_URL=postgresql+asyncpg://user:password@localhost/badfaith" >> .env.example
	@echo "SUPABASE_URL=https://your-project.supabase.co" >> .env.example
	@echo "SUPABASE_ANON_KEY=your-anon-key" >> .env.example
	@echo "EXTENSION_ORIGIN=chrome-extension://*" >> .env.example
	@echo "NVIDIA_API_KEY=your-nvidia-key" >> .env.example
	@echo "" >> .env.example
	@echo ".env.example created. Copy to .env and fill in values."

.DEFAULT_GOAL := help
