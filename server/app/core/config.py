from functools import lru_cache

from pydantic import Field, PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    env: str = "dev"
    debug: bool = False
    log_level: str = "INFO"
    # Independent of debug — flip on to trace SQL when investigating. Off by default
    # because it doubles request log volume.
    sql_echo: bool = False

    database_url: PostgresDsn = Field(
        default="postgresql+asyncpg://lg:lg@postgres:5432/lookingglass"
    )
    redis_url: RedisDsn = Field(default="redis://redis:6379/0")

    cors_origins: list[str] = ["http://localhost:8080", "http://localhost:5173"]

    secret_key: str = "change-me-in-production-this-is-only-for-dev"
    jwt_access_ttl_minutes: int = 15
    jwt_refresh_ttl_days: int = 7

    # Seeded on startup if no admin user exists.
    admin_username: str = "admin"
    admin_password: str = "admin"


@lru_cache(maxsize=1)
def _get_settings() -> Settings:
    return Settings()


settings = _get_settings()
