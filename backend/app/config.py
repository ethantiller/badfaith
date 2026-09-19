from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_INSTANCE_STRING: str | None = None
    nvidia_api_key: str | None = None
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_model_large: str = "nvidia/nemotron-3-super-120b-a12b"
    nvidia_model_small: str = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"

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