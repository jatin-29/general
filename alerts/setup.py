"""One-time helper, run on your own computer:  python alerts/setup.py

1. Logs in to Telegram and prints TELEGRAM_SESSION_STRING (a secret; it acts as your account).
2. Lists your groups/channels with the ids to paste into config.toml.
3. Optionally finds your chat id for the alert bot.
"""
import getpass

import httpx
from telethon.sessions import StringSession
from telethon.sync import TelegramClient


def main() -> None:
    print("Get API ID / hash at https://my.telegram.org -> API development tools\n")
    api_id = int(input("API ID: ").strip())
    api_hash = input("API hash: ").strip()
    with TelegramClient(StringSession(), api_id, api_hash) as client:  # asks phone, code, 2-step password
        session = client.session.save()
        print("\n=== Your groups and channels (put @username or the id in config.toml) ===")
        for d in client.iter_dialogs():
            if d.is_channel or d.is_group:
                user = getattr(d.entity, "username", None)
                print(f"{d.id:>16}  {'group' if d.is_group else 'channel':8} {d.name}" + (f"  @{user}" if user else ""))

    print("\n=== Secrets to add in GitHub (repo Settings > Secrets and variables > Actions) ===")
    print(f"TELEGRAM_API_ID={api_id}\nTELEGRAM_API_HASH={api_hash}\nTELEGRAM_SESSION_STRING={session}")

    token = getpass.getpass("\nBot token from @BotFather (Enter to skip): ").strip()
    if token:
        input("Now open your bot in Telegram, press Start / send it any message, then press Enter here...")
        r = httpx.get(f"https://api.telegram.org/bot{token}/getUpdates", timeout=20).json()
        chats = {u["message"]["chat"]["id"] for u in r.get("result", []) if "message" in u}
        if chats:
            print(f"TELEGRAM_BOT_TOKEN={token}\nTELEGRAM_CHAT_ID={next(iter(chats))}")
        else:
            print("No message found. Send your bot a message and run this again.")


if __name__ == "__main__":
    main()
