"""Settings editable from the website (stored in the DB) layered over environment variables."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import SessionLocal
from .models import AppSetting

# key -> is_secret (secrets are never returned by the API)
EDITABLE: dict[str, bool] = {
    "anthropic_api_key": True,
    "anthropic_model": False,
    "telegram_api_id": False,
    "telegram_api_hash": True,
    "telegram_session_string": True,
    "telegram_bot_token": True,
    "telegram_notify_chat_id": False,
    "youtube_api_key": True,
}


def effective_settings() -> Settings:
    base = get_settings()
    try:
        with SessionLocal() as db:
            rows = db.execute(select(AppSetting.key, AppSetting.value)).all()
    except Exception:  # table not created yet
        return base
    upd = {}
    for key, value in rows:
        if key in EDITABLE and value:
            upd[key] = int(value) if key == "telegram_api_id" and value.isdigit() else value
    return base.model_copy(update=upd)


def describe(db: Session) -> list[dict]:
    stored = dict(db.execute(select(AppSetting.key, AppSetting.value)).all())
    base = get_settings()
    out = []
    for key, secret in EDITABLE.items():
        from_site = bool(stored.get(key))
        from_env = bool(getattr(base, key)) and key != "anthropic_model"  # model always has a built-in default
        value = stored.get(key) if from_site else (str(getattr(base, key) or "") if from_env or key == "anthropic_model" else "")
        out.append({
            "key": key,
            "secret": secret,
            "is_set": from_site or from_env,
            "origin": "website" if from_site else "environment" if from_env else None,
            "value": None if secret else value,
        })
    return out


def update(db: Session, values: dict[str, str]) -> None:
    for key, value in values.items():
        if key not in EDITABLE:
            raise KeyError(key)
        row = db.get(AppSetting, key)
        value = (value or "").strip()
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=key, value=value))
    db.commit()
