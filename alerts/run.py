"""Check your Telegram groups and YouTube channels and send matching job posts to your Telegram.

    python alerts/run.py              # one check (what the GitHub Action runs)
    python alerts/run.py --test       # just send a test message, to verify delivery
    python alerts/run.py --dry-run    # print alerts instead of sending, don't save state
    python alerts/run.py --loop 15    # keep running locally, checking every 15 minutes
"""
import argparse
import asyncio
import html
import logging
import os
import re
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from core import Config, State, fingerprint, format_alert, is_match, load_config, parse_feed  # noqa: E402

log = logging.getLogger("alerts")
HERE = Path(__file__).resolve().parent
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
UC = re.compile(r"UC[\w-]{22}")


class AuthError(Exception):
    pass


VALID_SESSION_LENGTHS = (353, 369)  # Telethon login strings: IPv4 / IPv6 datacenter


def clean_session(raw: str) -> str:
    """Remove spaces, line breaks and quotes that sneak in when copy-pasting the string."""
    return "".join(raw.split()).strip("'\"")


# ---------------------------------------------------------------- http with retry
def http_get(url: str, **kw) -> httpx.Response:
    last = None
    for attempt in range(3):
        try:
            r = httpx.get(url, timeout=20, follow_redirects=True, **kw)
            if r.status_code >= 500 or r.status_code == 429:
                r.raise_for_status()
            return r
        except httpx.HTTPError as e:
            last = e
            time.sleep(2**attempt)
    raise last  # type: ignore[misc]


def bot_notifier(token: str, chat_id: str):
    async def notify(text: str) -> None:
        for attempt in range(3):
            try:
                r = httpx.post(
                    f"https://api.telegram.org/bot{token}/sendMessage",
                    json={"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True},
                    timeout=20,
                )
                if r.status_code == 429:
                    await asyncio.sleep(int(r.json().get("parameters", {}).get("retry_after", 3)))
                    continue
                r.raise_for_status()
                return
            except httpx.HTTPError as e:
                if attempt == 2:
                    raise
                await asyncio.sleep(2**attempt)

    return notify


# ---------------------------------------------------------------- Telegram
def clean_ref(ref: str):
    ref = ref.strip().removeprefix("https://t.me/").removeprefix("http://t.me/").removeprefix("@")
    return int(ref) if ref.lstrip("-").isdigit() else ref


def post_url(entity, msg_id: int) -> str | None:
    if getattr(entity, "username", None):
        return f"https://t.me/{entity.username}/{msg_id}"
    if getattr(entity, "broadcast", None) is not None or getattr(entity, "megagroup", None) is not None:
        return f"https://t.me/c/{entity.id}/{msg_id}"
    return None


async def check_telegram(client, ref: str, state: State, cfg: Config, notify) -> int:
    """Send alerts for new matching messages. Returns how many were sent.

    The saved position only moves past a message after it was handled, so a failed send is retried next run.
    """
    target = clean_ref(ref)
    entity = await client.get_entity(target)
    title = getattr(entity, "title", None) or getattr(entity, "first_name", None) or str(ref)
    key = str(ref)
    last = state.telegram.get(key)

    baseline_only = last is None and cfg.first_run_backfill == 0
    if last is None:  # first time we see this chat: look at the newest few only
        msgs = [m async for m in client.iter_messages(entity, limit=max(cfg.first_run_backfill, 1))]
    else:
        msgs = [m async for m in client.iter_messages(entity, min_id=last, limit=200)]
    msgs.sort(key=lambda m: m.id)

    sent = 0
    for m in msgs:
        text = (getattr(m, "message", None) or "").strip()
        if text and not baseline_only and is_match(text, cfg.include, cfg.exclude):
            fp = fingerprint(text)
            if not state.was_seen(fp):
                await notify(format_alert(title, text, post_url(entity, m.id), cfg.max_chars))
                state.mark_seen(fp)
                sent += 1
        state.telegram[key] = m.id
    if last is None and key not in state.telegram:
        state.telegram[key] = 0  # empty chat: remember we looked
    return sent


# ---------------------------------------------------------------- YouTube
def resolve_channel(ref: str, state: State) -> str:
    ref = ref.strip()
    if UC.fullmatch(ref):
        return ref
    if m := re.search(r"youtube\.com/channel/(UC[\w-]{22})", ref):
        return m.group(1)
    if ref in state.channels:
        return state.channels[ref]
    url = ref if ref.startswith("http") else f"https://www.youtube.com/{ref if ref.startswith('@') else '@' + ref}"
    page = http_get(url, headers={"Cookie": "CONSENT=YES+1; SOCS=CAI"}).text
    m = (
        re.search(r'"(?:channelId|externalId)":"(UC[\w-]{22})"', page)
        or re.search(r'<meta itemprop="(?:identifier|channelId)" content="(UC[\w-]{22})"', page)
    )
    if not m:
        raise RuntimeError(f"Could not find YouTube channel {ref!r}")
    state.channels[ref] = m.group(1)
    return m.group(1)


def fetch_videos(channel_id: str, api_key: str = "") -> list[dict]:
    """Newest first. RSS first; the Data API if RSS is blocked (it often is for datacenter IPs)."""
    r = http_get(FEED_URL.format(channel_id))
    if r.status_code == 200:
        return parse_feed(r.text)
    if not api_key:
        raise RuntimeError(
            f"YouTube RSS returned {r.status_code} for {channel_id}. Add a free YOUTUBE_API_KEY secret to use the API instead."
        )
    pl = http_get(
        "https://www.googleapis.com/youtube/v3/playlistItems",
        params={"part": "snippet", "playlistId": "UU" + channel_id[2:], "maxResults": 15, "key": api_key},
    )
    pl.raise_for_status()
    out = []
    for it in pl.json().get("items", []):
        sn = it["snippet"]
        vid = sn["resourceId"]["videoId"]
        out.append({"id": vid, "title": sn.get("title", ""), "description": sn.get("description", ""),
                    "url": f"https://www.youtube.com/watch?v={vid}"})
    return out


async def check_youtube(ref: str, state: State, cfg: Config, notify, api_key: str = "", videos=None) -> int:
    cid = resolve_channel(ref, state)
    vids = videos if videos is not None else fetch_videos(cid, api_key)
    seen_ids = state.youtube.get(cid)
    first = seen_ids is None
    seen_ids = list(seen_ids or [])
    sent = 0
    # oldest -> newest; on the first run only the newest `first_run_backfill` can be sent
    ordered = list(reversed(vids))
    eligible = {v["id"] for v in vids[: cfg.first_run_backfill]} if first else None
    for v in ordered:
        if v["id"] in seen_ids:
            continue
        text = f"{v['title']}\n\n{v['description']}".strip()
        if (eligible is None or v["id"] in eligible) and is_match(text, cfg.include, cfg.exclude):
            fp = fingerprint(text)
            if not state.was_seen(fp):
                await notify(format_alert(f"YouTube: {ref}", f"{v['title']}\n{html.unescape(v['description'])[:400]}", v["url"], cfg.max_chars))
                state.mark_seen(fp)
                sent += 1
        seen_ids.append(v["id"])
        state.youtube[cid] = seen_ids  # saved only after the video was handled
    state.youtube.setdefault(cid, seen_ids)
    return sent


# ---------------------------------------------------------------- main
async def run_once(cfg: Config, state: State, env: dict, dry_run: bool = False, test: bool = False) -> int:
    client = None
    session = clean_session(env.get("TELEGRAM_SESSION_STRING", ""))
    api_id, api_hash = env.get("TELEGRAM_API_ID", ""), env.get("TELEGRAM_API_HASH", "")
    errors = 0

    if session and api_id and api_hash:
        if len(session) not in VALID_SESSION_LENGTHS:
            raise AuthError(
                f"The TELEGRAM_SESSION_STRING secret has {len(session)} characters but a valid one has "
                f"{VALID_SESSION_LENGTHS[0]}. It was probably cut off or is the wrong text. Make a new one and "
                "update the secret, copying the WHOLE output."
            )
        from telethon import TelegramClient
        from telethon.sessions import StringSession

        client = TelegramClient(StringSession(session), int(api_id), api_hash)
        await client.connect()
        if not await client.is_user_authorized():
            raise AuthError("The Telegram session is no longer valid. Run alerts/setup.py again and update the secret.")

    try:
        if dry_run:
            async def notify(text: str) -> None:
                print("-" * 60 + "\n" + text)
        elif env.get("TELEGRAM_BOT_TOKEN") and env.get("TELEGRAM_CHAT_ID"):
            notify = bot_notifier(env["TELEGRAM_BOT_TOKEN"], env["TELEGRAM_CHAT_ID"])
        elif client:
            async def notify(text: str) -> None:  # fallback: your own "Saved Messages" (no push notification)
                await client.send_message("me", text, link_preview=False)
        else:
            raise SystemExit("No way to send alerts: set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (or a Telegram session).")

        if test:
            await notify("✅ Job alerts are connected. New matching posts will show up here.")
            return 0

        if cfg.telegram_chats and not client:
            raise SystemExit("telegram_chats is set but TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION_STRING are missing.")
        if client and any(isinstance(clean_ref(c), int) for c in cfg.telegram_chats):
            await client.get_dialogs()  # lets numeric ids of joined private chats resolve

        if not (cfg.telegram_chats or cfg.youtube_channels):
            log.warning("Nothing to watch yet: add chats/channels to alerts/config.toml")
        total = 0
        for ref in cfg.telegram_chats:
            try:
                n = await check_telegram(client, ref, state, cfg, notify)
                log.info("telegram %s: %d alert(s)", ref, n)
                total += n
            except Exception as e:
                errors += 1
                log.error("telegram %s failed: %s", ref, e)
        for ref in cfg.youtube_channels:
            try:
                n = await check_youtube(ref, state, cfg, notify, env.get("YOUTUBE_API_KEY", ""))
                log.info("youtube %s: %d alert(s)", ref, n)
                total += n
            except Exception as e:
                errors += 1
                log.error("youtube %s failed: %s", ref, e)
        log.info("done: %d alert(s) sent, %d source(s) failed", total, errors)
        return errors
    finally:
        if client:
            await client.disconnect()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(HERE / "config.toml"))
    ap.add_argument("--state", default=str(HERE / "state.json"))
    ap.add_argument("--test", action="store_true", help="send a test message and exit")
    ap.add_argument("--dry-run", action="store_true", help="print alerts instead of sending; don't save state")
    ap.add_argument("--fresh", action="store_true", help="forget what was already sent and resend the latest posts")
    ap.add_argument("--loop", type=int, metavar="MINUTES", help="repeat forever")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    while True:
        cfg, state = load_config(args.config), (State() if args.fresh else State.load(args.state))
        try:
            errors = asyncio.run(run_once(cfg, state, dict(os.environ), args.dry_run, args.test))
        except AuthError as e:
            log.error("%s", e)
            return 2
        finally:
            if not (args.dry_run or args.test):
                state.save(args.state)  # always keep progress, even if some sources failed
        if not args.loop:
            return 1 if errors and not args.dry_run and errors >= len(cfg.telegram_chats) + len(cfg.youtube_channels) else 0
        time.sleep(args.loop * 60)


if __name__ == "__main__":
    sys.exit(main())
