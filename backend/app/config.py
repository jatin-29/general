from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    telegram_api_id: int | None = None
    telegram_api_hash: str = ""
    telegram_session_string: str = ""
    telegram_poll_enabled: bool = True
    telegram_bot_token: str = ""
    telegram_notify_chat_id: str = ""

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5"
    youtube_api_key: str = ""

    database_url: str = "sqlite:///./openingshub.db"
    poll_interval_minutes: int = 5
    scheduler_enabled: bool = True
    api_key: str = ""
    frontend_origin: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
