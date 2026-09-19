from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database
    database_url: str  # Supabase async PostgreSQL: postgresql+asyncpg://user:pass@host/db

    # Supabase
    supabase_url: str
    supabase_anon_key: str

    # CORS — set to specific extension ID in production
    extension_origin: str = "chrome-extension://*"

    # Nemotron
    nvidia_api_key: str | None = None
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_model_large: str = "nvidia/nemotron-3-super-120b-a12b"
    nvidia_model_small: str = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
    nemotron_timeout_s: float = 30.0

    # Cache
    cache_ttl_hours: int = 24

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def require_setting(value: str | None, name: str) -> str:
    if not value:
        raise RuntimeError(f"{name} is not set in the environment")
    return value