"""Log in to Telegram from the website (phone -> code -> optional 2FA password) and list joined chats.

Telethon clients are bound to an event loop, and a login spans two HTTP requests, so all Telegram
work runs on one dedicated background loop thread.
"""
import asyncio
import threading

_loop: asyncio.AbstractEventLoop | None = None
_lock = threading.Lock()
_pending: dict = {}  # {"client", "phone", "hash"} for the login in progress


class LoginError(Exception):
    """Message is safe to show to the user."""


def _make_client(api_id: int, api_hash: str, session: str = ""):
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    return TelegramClient(StringSession(session), api_id, api_hash)


def _run(coro, timeout: float = 60):
    global _loop
    with _lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            threading.Thread(target=_loop.run_forever, name="telegram-login", daemon=True).start()
    try:
        return asyncio.run_coroutine_threadsafe(coro, _loop).result(timeout)
    except LoginError:
        raise
    except TimeoutError as e:
        raise LoginError("Telegram did not respond in time. Try again.") from e
    except Exception as e:
        msg = str(e).strip() or e.__class__.__name__
        raise LoginError(msg[:300]) from e


async def _send_code(phone: str, api_id: int, api_hash: str) -> None:
    if _pending.get("client"):
        await _pending["client"].disconnect()
        _pending.clear()
    client = _make_client(api_id, api_hash)
    await client.connect()
    try:
        sent = await client.send_code_request(phone)
    except Exception:
        await client.disconnect()
        raise
    _pending.update(client=client, phone=phone, hash=sent.phone_code_hash)


async def _sign_in(code: str, password: str | None) -> dict:
    from telethon.errors import SessionPasswordNeededError

    client = _pending.get("client")
    if not client:
        raise LoginError("No login in progress. Request a new code first.")
    try:
        await client.sign_in(phone=_pending["phone"], code=code, phone_code_hash=_pending["hash"])
    except SessionPasswordNeededError:
        if not password:
            return {"needs_password": True}
        await client.sign_in(password=password)
    session = client.session.save()
    await client.disconnect()
    _pending.clear()
    return {"session": session}


async def _list_chats(api_id: int, api_hash: str, session: str) -> list[dict]:
    client = _make_client(api_id, api_hash, session)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise LoginError("Telegram session expired. Log in again in Settings.")
        chats = []
        async for d in client.iter_dialogs():
            if not (d.is_channel or d.is_group):
                continue
            username = getattr(d.entity, "username", None)
            chats.append({
                "id": d.id,
                "name": d.name,
                "username": username,
                "kind": "group" if d.is_group else "channel",
                "identifier": username or str(d.id),
            })
        return chats
    finally:
        await client.disconnect()


def send_code(phone: str, api_id: int, api_hash: str) -> None:
    _run(_send_code(phone, api_id, api_hash))


def sign_in(code: str, password: str | None = None) -> dict:
    return _run(_sign_in(code, password))


def list_chats(api_id: int, api_hash: str, session: str) -> list[dict]:
    return _run(_list_chats(api_id, api_hash, session), timeout=120)
