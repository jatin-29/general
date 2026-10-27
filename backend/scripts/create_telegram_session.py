"""Create a Telegram StringSession for TELEGRAM_SESSION_STRING.

    python scripts/create_telegram_session.py             # log in, print session string
    python scripts/create_telegram_session.py --list-chats  # also list chat ids (for private groups)

Needs TELEGRAM_API_ID / TELEGRAM_API_HASH (env, backend/.env, or prompted).
Treat the printed string like a password: it grants full access to your account.
"""
import os
import sys
from pathlib import Path

from telethon.sessions import StringSession
from telethon.sync import TelegramClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings  # noqa: E402


def main() -> None:
    s = get_settings()
    api_id = os.environ.get("TELEGRAM_API_ID") or s.telegram_api_id or input("API ID: ").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH") or s.telegram_api_hash or input("API hash: ").strip()
    session = s.telegram_session_string if "--list-chats" in sys.argv else ""

    with TelegramClient(StringSession(session), int(api_id), api_hash) as client:  # prompts phone/code/2FA
        if "--list-chats" in sys.argv:
            print(f"{'ID':>16}  {'TYPE':8}  NAME / @username")
            for d in client.iter_dialogs():
                kind = "channel" if d.is_channel and not d.is_group else "group" if d.is_group else "user"
                if kind == "user":
                    continue
                user = f"  @{d.entity.username}" if getattr(d.entity, "username", None) else ""
                print(f"{d.id:>16}  {kind:8}  {d.name}{user}")
        else:
            print("\nTELEGRAM_SESSION_STRING=" + client.session.save())


if __name__ == "__main__":
    main()
