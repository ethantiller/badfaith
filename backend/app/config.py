from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database — can provide full URL or components
    database_url: str = ""  # Full: postgresql+asyncpg://user:pass@host/db
    database_instance_string: str = ""  # e.g., "user:pass@host:5432/db"
    database_pass: str = ""

    # Supabase
    supabase_url: str
    supabase_key: str  # Maps to supabase_anon_key

    # CORS — set to specific extension ID in production
    extension_origin: str = "chrome-extension://*"

    # Nemotron (served through build.nvidia.com)
    nvidia_api_key: str = ""
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_model_large: str = "nvidia/nemotron-3-super-120b-a12b"
    nvidia_model_small: str = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
    nemotron_timeout_s: float = 30.0

    # API
    api_base: str = ""  # Extension API base URL

    # Cache
    cache_ttl_hours: int = 24

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def get_database_url(self) -> str:
        """Get the full async PostgreSQL URL. Convert postgresql:// to postgresql+asyncpg://."""
        url = self.database_url or self.database_instance_string

        if not url:
            raise RuntimeError("DATABASE_URL or DATABASE_INSTANCE_STRING must be set")

        # Convert postgresql:// to postgresql+asyncpg:// for async support
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[13:]

        return url

    @property
    def supabase_anon_key(self) -> str:
        """Alias for supabase_key."""
        return self.supabase_key


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def require_setting(value: str | None, name: str) -> str:
    if not value:
        raise RuntimeError(f"{name} is not set in the environment")
    return value