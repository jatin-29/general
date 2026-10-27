"""Telegram collector (Telethon, user-account session).

Two modes sharing the same pipeline:
  * poller   - `TelegramCollector`, run by the scheduler every N minutes
  * listener - `python -m app.collectors.telegram`, real-time NewMessage handler

Source.identifier may be a public @username (or t.me link), or the numeric id of a
joined private channel/group (run `python scripts/create_telegram_session.py --list-chats`).
Only the chats added as Sources are read.
"""
import asyncio
import logging
from ..config import get_settings
from ..runtime import effective_settings
from ..models import Source
from .base import Collector, RawItemData, register

log = logging.getLogger("openingshub.telegram")
FIRST_RUN_LIMIT = 50
MAX_PER_RUN = 200


def clean_identifier(ident: str):
    """'@foo' / 'https://t.me/foo' -> 'foo'; '-100123' -> int."""
    ident = ident.strip().removeprefix("https://t.me/").removeprefix("http://t.me/").removeprefix("@")
    return int(ident) if ident.lstrip("-").isdigit() else ident


def message_to_item(msg, username: str | None, channel_id: int | None) -> RawItemData | None:
    text = (getattr(msg, "message", None) or "").strip()
    if not text:
        return None
    if username:
        url = f"https://t.me/{username}/{msg.id}"
    elif channel_id:
        url = f"https://t.me/c/{channel_id}/{msg.id}"
    else:
        url = None
    return RawItemData(external_id=str(msg.id), text=text, url=url, published_at=getattr(msg, "date", None))


def _client():
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    s = effective_settings()
    if not (s.telegram_api_id and s.telegram_api_hash and s.telegram_session_string):
        raise RuntimeError("Telegram is not configured (TELEGRAM_API_ID/HASH/SESSION_STRING)")
    return TelegramClient(StringSession(s.telegram_session_string), s.telegram_api_id, s.telegram_api_hash)


async def _resolve(client, ref):
    if isinstance(ref, int):
        await client.get_dialogs()  # populate entity cache so numeric ids of joined chats resolve
    return await client.get_entity(ref)


async def _fetch(source: Source, last_id: int | None) -> list[RawItemData]:
    ref = clean_identifier(source.identifier)
    async with _client() as client:
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram session is not authorized; regenerate TELEGRAM_SESSION_STRING")
        entity = await _resolve(client, ref)
        username = getattr(entity, "username", None)
        kwargs = {"min_id": last_id, "limit": MAX_PER_RUN} if last_id else {"limit": FIRST_RUN_LIMIT}
        items = []
        async for msg in client.iter_messages(entity, **kwargs):
            item = message_to_item(msg, username, getattr(entity, "id", None))
            if item:
                items.append(item)
        items.reverse()  # oldest first
        return items


@register
class TelegramCollector(Collector):
    source_type = "telegram"

    def collect(self, source: Source, last_external_id: str | None) -> list[RawItemData]:
        if not get_settings().telegram_poll_enabled:
            return []
        last = int(last_external_id) if last_external_id and last_external_id.isdigit() else None
        return asyncio.run(_fetch(source, last))


# ---------------------------------------------------------------- listener mode
def handle_incoming(source_identifier: str, item: RawItemData, llm=None) -> int:
    """Store one message and run extraction on it. Returns openings created."""
    from ..db import SessionLocal
    from ..pipeline import process_unprocessed, save_raw_items

    with SessionLocal() as db:
        new = save_raw_items(db, "telegram", source_identifier, [item])
        if not new:
            return 0
        return process_unprocessed(db, llm, only_ids=[r.id for r in new])


async def run_listener() -> None:
    from sqlalchemy import select
    from telethon import events, utils

    from ..db import SessionLocal, init_db

    init_db()
    with SessionLocal() as db:
        idents = {s.identifier: s.label for s in db.scalars(select(Source).where(Source.type == "telegram", Source.enabled.is_(True)))}
    if not idents:
        raise SystemExit("No enabled telegram Sources; add some via POST /api/sources")

    async with _client() as client:
        if not await client.is_user_authorized():
            raise SystemExit("Telegram session is not authorized")
        by_peer: dict[int, tuple[str, str | None, int]] = {}
        for ident, label in idents.items():
            try:
                ent = await _resolve(client, clean_identifier(ident))
                by_peer[utils.get_peer_id(ent)] = (label, getattr(ent, "username", None), ent.id)
            except Exception:
                log.exception("cannot resolve %s; skipping", ident)

        @client.on(events.NewMessage(chats=list(by_peer)))
        async def _on_message(event):
            ident, username, cid = by_peer[event.chat_id]
            item = message_to_item(event.message, username, cid)
            if item:
                n = await asyncio.to_thread(handle_incoming, ident, item)
                log.info("%s: message %s -> %d new openings", ident, item.external_id, n)

        log.info("listening on %d chats", len(by_peer))
        await client.run_until_disconnected()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(run_listener())
