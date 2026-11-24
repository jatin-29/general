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
from core import (  # noqa: E402
    Config, JobStore, State, StoreLocked, fingerprint, format_alert, is_excluded, is_match, is_wa_job, load_config, make_job, parse_feed,
    batch_match, job_category, parse_wa, repost_text, wa_ignored, wa_signals,
)

log = logging.getLogger("alerts")
HERE = Path(__file__).resolve().parent
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
UC = re.compile(r"UC[\w-]{22}")


OWN_ALERT_PREFIXES = ("📌", "✅ Job alerts", "📢")


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


class Outbox:
    """Collects alerts during a run and sends them at the end, several per Telegram message.

    Sending one message per job hit Telegram's flood limit ("A wait of N seconds is required"), which used to
    abort the whole chat. The website is updated before anything is sent, so a failed send only loses alerts.
    """

    def __init__(self, send, limit: int = 3800, pause: float = 2.0):
        self.send, self.limit, self.pause = send, limit, pause
        self.items: list[str] = []

    async def add(self, text: str) -> None:
        self.items.append(text[: self.limit])

    def batches(self) -> list[str]:
        out, cur = [], ""
        for t in self.items:
            joined = f"{cur}\n\n· · ·\n\n{t}" if cur else t
            if cur and len(joined) > self.limit:
                out.append(cur)
                cur = t
            else:
                cur = joined
        return out + ([cur] if cur else [])

    async def flush(self) -> int:
        """Returns how many Telegram messages went out."""
        batches, sent = self.batches(), 0
        for i, text in enumerate(batches):
            for attempt in (1, 2):
                try:
                    await self.send(text)
                    sent += 1
                    break
                except Exception as e:
                    wait = getattr(e, "seconds", None)  # Telethon FloodWaitError
                    if wait is not None and wait <= 60 and attempt == 1:
                        await asyncio.sleep(wait + 1)
                        continue
                    log.warning("Telegram refused more alerts (%s); %d batch(es) not sent. The website is up to date.", e, len(batches) - i)
                    return sent
            await asyncio.sleep(self.pause)
        return sent


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


async def check_telegram(client, ref: str, state: State, cfg: Config, notify, store: JobStore | None = None, rescan: int = 0) -> int:
    """Send alerts for new matching messages. Returns how many were sent.

    The saved position only moves past a message after it was handled, so a failed send is retried next run.
    """
    saved = str(ref).strip().lower() in ("me", "saved", "saved messages")  # your own Saved Messages
    entity = await client.get_entity("me" if saved else clean_ref(ref))
    title = "Saved Messages" if saved else (getattr(entity, "title", None) or getattr(entity, "first_name", None) or str(ref))
    public = bool(getattr(entity, "username", None)) and not saved
    key = str(ref)
    last = state.telegram.get(key)

    baseline_only = last is None and cfg.first_run_backfill == 0
    accept_all = saved or str(ref) in {str(c) for c in cfg.accept_all}
    if rescan and last is not None:  # one-off: look again at the latest N posts (already-stored ones are skipped)
        msgs = [m async for m in client.iter_messages(entity, limit=rescan)]
    elif last is None:  # first time we see this chat: look at the newest few only
        msgs = [m async for m in client.iter_messages(entity, limit=max(cfg.first_run_backfill, 1))]
    else:
        msgs = [m async for m in client.iter_messages(entity, min_id=last, limit=200)]
    msgs.sort(key=lambda m: m.id)

    sent = 0
    seen = {"no_text": 0, "own": 0, "no_match": 0, "dup": 0, "web": 0}
    for m in msgs:
        text = (getattr(m, "message", None) or "").strip()
        if not text:
            seen["no_text"] += 1  # photo, file, sticker...: nothing to read
        if saved and text.startswith(OWN_ALERT_PREFIXES):
            text = ""  # the collector's own alerts live in Saved Messages too; never re-import them
            seen["own"] += 1
        # In Saved Messages you chose what to forward, so everything counts (no keyword filter).
        wanted = (saved or not is_excluded(text, cfg.exclude)) if accept_all else is_match(text, cfg.include, cfg.exclude)
        if text and not baseline_only and wanted:
            fp = fingerprint(text, by_link=not saved)  # your own forwards: only the exact same text is a duplicate
            deleted = store is not None and fp in store.deleted  # you deleted it on the website: never again
            if saved and store is not None and last is not None and m.id <= last:  # older forwards were stored by link
                deleted = deleted or fingerprint(text) in store.deleted
            if not state.was_seen(fp) and not deleted:
                url = None if saved else post_url(entity, m.id)
                if store is not None and (public or store.allow_private):  # private chats only when encrypted
                    if store.add(make_job(title, text, url, getattr(m, "date", None), fp=fp)):
                        seen["web"] += 1
                if not saved:  # no point alerting you about a message already in your Saved Messages
                    await notify(format_alert(title, text, url, cfg.max_chars))
                state.mark_seen(fp)
                sent += 1
            else:
                seen["dup"] += 1
        elif text and not baseline_only:
            seen["no_match"] += 1
        state.telegram[key] = max(m.id, state.telegram.get(key) or 0)  # a rescan must never move backwards
    log.info(
        "%s: looked at %d new message(s): %d collected (%d added to website), %d without text, %d own alerts, %d not matching keywords, %d duplicates",
        ref, len(msgs), sent, seen["web"], seen["no_text"], seen["own"], seen["no_match"], seen["dup"],
    )
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


async def check_youtube(ref: str, state: State, cfg: Config, notify, api_key: str = "", videos=None, store: JobStore | None = None) -> int:
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
                body = f"{v['title']}\n{html.unescape(v['description'])}"
                if store is not None:
                    store.add(make_job(f"YouTube: {ref}", body, v["url"]))
                await notify(format_alert(f"YouTube: {ref}", body[:400], v["url"], cfg.max_chars))
                state.mark_seen(fp)
                sent += 1
        seen_ids.append(v["id"])
        state.youtube[cid] = seen_ids  # saved only after the video was handled
    state.youtube.setdefault(cid, seen_ids)
    return sent


# ---------------------------------------------------------------- WhatsApp inbox
async def find_whatsapp_inbox(client, cfg: Config):
    """The bot chat MacroDroid sends WhatsApp notifications to (found by its "WA:" messages)."""
    ref = (cfg.whatsapp_inbox or "").strip()
    if not ref:
        return None
    if ref.lower() != "auto":
        return await client.get_entity(clean_ref(ref))
    async for d in client.iter_dialogs(limit=200):
        if getattr(d.entity, "bot", False) and (getattr(d.message, "message", None) or "").lstrip().startswith("WA:"):
            return d.entity
    return None


async def check_whatsapp(client, state: State, cfg: Config, store: JobStore | None = None, rescan: int = 0) -> int:
    """Job posts from WhatsApp groups, forwarded by MacroDroid on your phone. Returns how many were new."""
    inbox = await find_whatsapp_inbox(client, cfg)
    if inbox is None:
        log.info("whatsapp: no inbox chat yet (set up MacroDroid to send 'WA: …' messages to your bot)")
        return 0
    if rescan:  # one-off: look again at the latest N (stored ones are skipped as duplicates)
        msgs = [m async for m in client.iter_messages(inbox, limit=rescan)]
    elif state.whatsapp:
        msgs = [m async for m in client.iter_messages(inbox, min_id=state.whatsapp, limit=500)]
    else:  # first time: the recent ones
        msgs = [m async for m in client.iter_messages(inbox, limit=50)]
    msgs.sort(key=lambda m: m.id)
    seen = {"added": 0, "noise": 0, "not_job": 0, "dup": 0}
    skipped = []  # length/score only: the repo's logs are public, so never the text
    new = 0
    for m in msgs:
        raw = getattr(m, "message", None) or ""
        parsed = None if wa_ignored(raw, cfg.whatsapp_ignore) else parse_wa(raw)
        if not parsed:
            seen["noise"] += 1
        elif not is_wa_job(parsed[1], cfg, job_group=parsed[0] in state.wa_groups):
            seen["not_job"] += 1
            words, contact = wa_signals(parsed[1], cfg)
            skipped.append(f"{len(parsed[1])}c/{words}w{'+link' if contact else ''}")
        else:
            group, text = parsed
            if group not in state.wa_groups:
                state.wa_groups = (state.wa_groups + [group])[-100:]
            fp = fingerprint(text)
            if state.was_seen(fp) or (store is not None and fp in store.deleted):
                seen["dup"] += 1
            else:
                if store is not None and store.allow_private and store.add(make_job(f"WhatsApp · {group}", text, None, getattr(m, "date", None), fp=fp)):
                    seen["added"] += 1
                state.mark_seen(fp)
                new += 1
        state.whatsapp = max(m.id, state.whatsapp)
    log.info(
        "whatsapp: looked at %d message(s): %d new job(s) (%d added to website), %d not jobs, %d notifications skipped, %d duplicates",
        len(msgs), new, seen["added"], seen["not_job"], seen["noise"], seen["dup"],
    )
    if skipped:
        log.info("whatsapp: skipped as not jobs (length/job words): %s", ", ".join(skipped))
    return new


# ---------------------------------------------------------------- LinkedIn (your job-alert emails)
def check_linkedin(env: dict, state: State, cfg: Config, store: JobStore | None = None, imap_factory=None) -> int:
    """Jobs from new LinkedIn alert emails in your Gmail. Returns how many were new."""
    import linkedin

    address, password = env.get("GMAIL_ADDRESS", "").strip(), env.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
    if not (address and password):
        log.info("linkedin: add the GMAIL_ADDRESS and GMAIL_APP_PASSWORD secrets to read your LinkedIn job alerts")
        return 0
    kw = {"imap_factory": imap_factory} if imap_factory else {}
    mails, last = linkedin.fetch_alerts(address, password, state.linkedin_uid, **kw)
    new = dup = 0
    for when, msg in mails:
        for j in linkedin.parse_alert(msg):
            text = linkedin.job_text(j)
            fp = fingerprint(text)
            if state.was_seen(fp) or (store is not None and fp in store.deleted):
                dup += 1
                continue
            if store is not None:
                store.add(make_job("LinkedIn", text, j["url"], when, fp=fp))
            state.mark_seen(fp)
            new += 1
    state.linkedin_uid = last
    log.info("linkedin: %d alert email(s), %d new job(s), %d duplicates", len(mails), new, dup)
    return new


# ---------------------------------------------------------------- your job group (one topic per role type)
async def create_group(client, title: str, about: str):
    """A private supergroup with Topics, read-only for members; returns (group, invite link)."""
    from telethon.tl.functions.channels import CreateChannelRequest
    from telethon.tl.functions.messages import EditChatDefaultBannedRightsRequest, ExportChatInviteRequest
    from telethon.tl.types import ChatBannedRights

    res = await client(CreateChannelRequest(title=title, about=about, megagroup=True, forum=True))
    group = res.chats[0]
    # members read; only you (the owner) post and make topics
    await client(EditChatDefaultBannedRightsRequest(peer=group, banned_rights=ChatBannedRights(until_date=None, send_messages=True, manage_topics=True)))
    link = (await client(ExportChatInviteRequest(peer=group))).link
    return group, link


async def create_topic(client, group, title: str) -> int:
    """Add a topic and return its id (the id of the "topic created" message)."""
    import random

    from telethon.tl.functions.messages import CreateForumTopicRequest

    res = await client(CreateForumTopicRequest(peer=group, title=title, random_id=random.randrange(1, 2**62)))
    for u in getattr(res, "updates", []):
        m = getattr(u, "message", None)
        if m is not None and type(getattr(m, "action", None)).__name__ == "MessageActionTopicCreate":
            return m.id
    return next(u.id for u in getattr(res, "updates", []) if type(u).__name__ == "UpdateMessageID")


async def existing_topics(client, group) -> dict[str, int]:
    from telethon.tl.functions.messages import GetForumTopicsRequest

    res = await client(GetForumTopicsRequest(peer=group, offset_date=None, offset_id=0, offset_topic=0, limit=100))
    return {t.title: t.id for t in getattr(res, "topics", []) if getattr(t, "title", None)}


async def rename_channel(client, channel, title: str):
    from telethon.tl.functions.channels import EditTitleRequest

    await client(EditTitleRequest(channel=channel, title=title))


async def find_repost_group(client, state: State, cfg: Config):
    """Your job group, made on the first run (and renamed if repost_title changes)."""
    ref = (cfg.repost_channel or "").strip()
    if ref.lower() != "auto":
        return await client.get_entity(clean_ref(ref))
    async for d in client.iter_dialogs(limit=300):
        e = d.entity
        if getattr(e, "megagroup", False) and getattr(e, "forum", False) and (e.id == state.repost_gid or (getattr(e, "creator", False) and getattr(e, "title", "") == cfg.repost_title)):
            state.repost_gid = e.id
            if getattr(e, "title", "") != cfg.repost_title:
                await rename_channel(client, e, cfg.repost_title)
                log.info("repost: renamed the group to %r", cfg.repost_title)
            state.repost_title = cfg.repost_title
            return e
    about = f"{', '.join(cfg.repost_categories)} openings" + (f" for the {cfg.repost_batch} batch" if cfg.repost_batch else "") + ", collected automatically."
    group, link = await create_group(client, cfg.repost_title, about)
    state.repost_gid, state.repost_title, state.repost_topics = group.id, cfg.repost_title, {}
    await client.send_message("me", f"📢 Your job group \"{cfg.repost_title}\" is ready, with a topic for each role type. Members can read; only you post.\nInvite link: {link}", link_preview=False)
    log.info("repost: created the group %r", cfg.repost_title)
    return group


async def topic_for(client, group, state: State, category: str) -> int:
    if category not in state.repost_topics:
        known = await existing_topics(client, group)
        state.repost_topics[category] = known.get(category) or await create_topic(client, group, category)
    return state.repost_topics[category]


async def remove_member(client, state: State, cfg: Config, who: str) -> int:
    """Remove someone from your job group: "latest" (who joined last) or part of their name. You get a note in
    Saved Messages with the name (the public run log only says how many). Returns how many were removed."""
    group = await find_repost_group(client, state, cfg)
    people = []
    async for u in client.iter_participants(group):
        p = getattr(u, "participant", None)
        if getattr(u, "is_self", False) or getattr(u, "bot", False) or type(p).__name__ in ("ChannelParticipantCreator", "ChannelParticipantAdmin"):
            continue
        name = " ".join(x for x in (getattr(u, "first_name", None), getattr(u, "last_name", None)) if x) or getattr(u, "username", None) or str(u.id)
        people.append((getattr(p, "date", None), name, u))
    everyone = people
    want = who.strip().lower()
    if want == "latest":
        people = [max(people, key=lambda x: x[0].timestamp() if x[0] else 0)] if people else []
    else:
        # every word must appear in the name or username ("chirag khanna" finds "Chirag K." only if both match)
        words = want.split()
        def hit(x):
            hay = f"{x[1]} {getattr(x[2], 'username', None) or ''}".lower()
            return all(w in hay for w in words) or want.replace(" ", "") in hay.replace(" ", "")
        people = [x for x in people if hit(x)]
        if not people:
            names = ", ".join(n for _, n, _ in everyone) or "nobody besides admins"
            await client.send_message("me", f"📢 No one in \"{cfg.repost_title}\" matches \"{who.strip()}\". Members now: {names}.", link_preview=False)
    for joined, name, u in people:
        await client.kick_participant(group, u)
        when = f" (joined {joined.strftime('%d %b %Y, %H:%M UTC')})" if joined else ""
        await client.send_message("me", f"📢 Removed {name}{when} from your group \"{cfg.repost_title}\".", link_preview=False)
    log.info("group: removed %d member(s)", len(people))
    return len(people)


def _role_stats(jobs: list[dict], cfg: Config) -> None:
    """Once a day: how many saved jobs for your batch fit each role type (counts only), to pick topics."""
    from core import ROLE_TYPES

    every = ["SDE", *ROLE_TYPES]
    mine = [j for j in jobs if batch_match(j["text"], cfg.repost_batch)]
    counts = {name: 0 for name in every}
    none = 0
    for j in mine:
        c = job_category(j["text"], every)
        if c:
            counts[c] += 1
        else:
            none += 1
    log.info("roles: %d saved job(s) for the %s batch: %s, %d no role", len(mine), cfg.repost_batch or "any",
             ", ".join(f"{n} {k}{'' if k in cfg.repost_categories else ' (no topic)'}" for k, n in sorted(counts.items(), key=lambda x: -x[1])), none)


def _batch_reason(text: str) -> str:
    """Why a post is not for your batch, in a few words (for the counts in the run log)."""
    from core import _FINAL_YEAR, _FOR_FRESHERS, _NEEDS_EXPERIENCE, _PRE_FINAL, batch_years

    named = batch_years(text)
    if named:
        return "names batch " + "/".join(str(y) for y in sorted(named))
    if _PRE_FINAL.search(text):
        return "pre-final year"
    if _NEEDS_EXPERIENCE.search(re.sub(r"\b0\s*(?:-|–|to)\s*\d+", " ", text)):
        return "asks for experience"
    return "no batch or fresher word"


async def repost(client, state: State, cfg: Config, new_jobs: list[dict], store: JobStore | None = None) -> int:
    """Post new jobs (oldest first) into their topic in your job group, a few per run. Returns how many were posted."""
    skip = {s.strip().lower() for s in cfg.repost_skip}
    only = [s.strip().lower() for s in cfg.repost_sources if s.strip()]
    # once a day (from the first run of the day): today's jobs already on the site, not only brand-new ones
    from datetime import datetime, timedelta, timezone

    ist = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(ist).date()
    mark = f"{today.isoformat()}/{cfg.repost_recent_days}/5"  # bump the last part to sweep again today
    if store is not None and state.repost_today != mark:
        state.repost_today = mark
        since = today - timedelta(days=max(1, cfg.repost_recent_days) - 1)
        on_site = [j for j in reversed(store.jobs) if (j.get("posted_at") or j.get("added_at")) and
                   datetime.fromisoformat((j.get("posted_at") or j["added_at"]).replace("Z", "+00:00")).astimezone(ist).date() >= since]
        new_jobs = on_site + [j for j in new_jobs if j not in on_site]
        _role_stats(store.jobs, cfg)
    queued = {q["id"] for q in state.repost_queue} | set(state.repost_done)
    why_batch: dict[str, int] = {}
    why = {"other source": 0, "skipped group": 0, f"not {cfg.repost_batch or 'any'} batch": 0, "other role": 0, "queued": 0}
    for j in new_jobs:
        if j["id"] in queued:
            continue
        queued.add(j["id"])
        src = j["source"].strip().lower()
        group = src.split("·", 1)[-1].strip()
        if only and not any(src.startswith(o) for o in only):
            why["other source"] += 1
        elif src in skip or any(group.startswith(k) for k in skip):
            why["skipped group"] += 1
        elif not batch_match(j["text"], cfg.repost_batch):
            why[f"not {cfg.repost_batch or 'any'} batch"] += 1
            why_batch[_batch_reason(j["text"])] = why_batch.get(_batch_reason(j["text"]), 0) + 1
        elif not (category := job_category(j["text"], cfg.repost_categories)):
            why["other role"] += 1
        else:
            why["queued"] += 1
            state.repost_queue.append({"id": j["id"], "fingerprint": j["fingerprint"], "text": j["text"], "apply_link": j.get("apply_link"), "source": j["source"], "category": category})
    if sum(why.values()):  # counts only: never the job text in the public log
        log.info("repost: looked at %d job(s): %s", sum(why.values()), ", ".join(f"{n} {k}" for k, n in why.items() if n))
        if why_batch:
            log.info("repost: not the batch because: %s", ", ".join(f"{n} {k}" for k, n in sorted(why_batch.items(), key=lambda x: -x[1])))
    missing = [c for c in cfg.repost_categories if c not in state.repost_topics]
    if not state.repost_queue and state.repost_gid and not missing and not state.repost_title_pending(cfg.repost_title):
        return 0
    group = await find_repost_group(client, state, cfg)  # the first run makes the group right away
    for c in missing:  # every topic up front, in your order (new ones from config.toml too)
        await topic_for(client, group, state, c)
    sent = 0
    while state.repost_queue and sent < cfg.repost_per_run:
        job = state.repost_queue[0]
        if store is None or job["fingerprint"] not in store.deleted:  # deleted on the website: don't post
            try:
                topic = await topic_for(client, group, state, job.get("category") or cfg.repost_categories[0])
                await client.send_message(group, repost_text(job), link_preview=False, reply_to=topic)
            except Exception as e:
                if type(e).__name__ == "FloodWaitError":
                    log.warning("repost: Telegram asked to slow down; %d job(s) wait for the next run", len(state.repost_queue))
                    break
                raise
            sent += 1
            state.repost_done.append(job["id"])
            await asyncio.sleep(3 if sent < cfg.repost_per_run else 0)
        state.repost_queue.pop(0)
    log.info("repost: posted %d job(s) to your group, %d waiting", sent, len(state.repost_queue))
    return sent


# ---------------------------------------------------------------- main
async def run_once(cfg: Config, state: State, env: dict, dry_run: bool = False, test: bool = False, store: JobStore | None = None, rescan: int = 0) -> int:
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
        outbox = Outbox(notify, pause=0 if dry_run else 2.0)
        total = 0
        if store is not None and cfg.whatsapp_ignore:  # chats you chose to ignore: off the website too
            drop = [j["id"] for j in store.jobs if j["source"].startswith("WhatsApp") and any(k.strip().lower() in j["source"].lower() for k in cfg.whatsapp_ignore if k.strip())]
            if drop:
                log.info("whatsapp: removed %d job(s) from ignored chats", store.delete(drop))
        before = {j["id"] for j in store.jobs} if store is not None else set()
        for ref in cfg.telegram_chats:
            try:
                scope = {c.strip() for c in env.get("RESCAN_CHATS", "").split(",") if c.strip()}
                n = await check_telegram(client, ref, state, cfg, outbox.add, store, rescan if not scope or str(ref) in scope else 0)
                log.info("telegram %s: %d alert(s)", ref, n)
                total += n
            except Exception as e:
                errors += 1
                log.error("telegram %s failed: %s", ref, e)
        if client and cfg.whatsapp_inbox:
            try:
                wa_scope = {c.strip().lower() for c in env.get("RESCAN_CHATS", "").split(",") if c.strip()}
                total += await check_whatsapp(client, state, cfg, store, rescan if not wa_scope or "whatsapp" in wa_scope else 0)
            except Exception as e:
                errors += 1
                log.error("whatsapp inbox failed: %s", e)
        if cfg.linkedin_alerts:
            try:
                total += check_linkedin(env, state, cfg, store)
            except Exception as e:
                errors += 1
                log.error("linkedin alerts failed: %s", e)
        for ref in cfg.youtube_channels:
            try:
                n = await check_youtube(ref, state, cfg, outbox.add, env.get("YOUTUBE_API_KEY", ""), store=store)
                log.info("youtube %s: %d alert(s)", ref, n)
                total += n
            except Exception as e:
                errors += 1
                log.error("youtube %s failed: %s", ref, e)
        if client and cfg.repost_channel and env.get("REMOVE_MEMBER", "").strip() and not dry_run:
            try:
                await remove_member(client, state, cfg, env["REMOVE_MEMBER"])
            except Exception as e:
                errors += 1
                log.error("removing a group member failed: %s", e)
        if client and cfg.repost_channel and store is not None and not dry_run:
            new_jobs = [j for j in reversed(store.jobs) if j["id"] not in before]
            try:
                await repost(client, state, cfg, new_jobs, store)
            except Exception as e:
                errors += 1
                log.error("repost to your channel failed: %s", e)
        messages = await outbox.flush()
        log.info("done: %d new job(s), sent as %d Telegram message(s); %d source(s) failed", total, messages, errors)
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
    ap.add_argument("--jobs", default=str(HERE.parent / "data" / "jobs.json"), help="where the website's job list is stored")
    ap.add_argument("--fresh", action="store_true", help="forget what was already sent and resend the latest posts")
    ap.add_argument("--rescan", type=int, default=0, metavar="N", help="look again at the latest N posts of each chat")
    ap.add_argument("--loop", type=int, metavar="MINUTES", help="repeat forever")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    while True:
        cfg, state = load_config(args.config), (State() if args.fresh else State.load(args.state))
        password = os.environ.get("SITE_PASSWORD", "").strip() or None
        try:
            store = JobStore.load(args.jobs, password)
            ids = [i.strip() for i in os.environ.get("DELETE_IDS", "").split(",") if i.strip()]
            if ids:  # from the website's delete button (passed via env, never through the shell)
                log.info("deleted %d of %d requested job(s) from the website", store.delete(ids), len(ids))
            # if the run memory (cache) is ever lost, don't alert about stored or deleted jobs again
            for fp in [j["fingerprint"] for j in store.jobs] + store.deleted:
                state.mark_seen(fp)
        except StoreLocked as e:
            log.error("%s Jobs are still sent to Telegram, but the website list is not updated.", e)
            store = None
        try:
            errors = asyncio.run(run_once(cfg, state, dict(os.environ), args.dry_run, args.test, store, args.rescan))
        except AuthError as e:
            log.error("%s", e)
            return 2
        finally:
            if not (args.dry_run or args.test):
                state.save(args.state)  # always keep progress, even if some sources failed
                if store is not None:
                    store.save(args.jobs)
        if not args.loop:
            return 1 if errors and not args.dry_run and errors >= len(cfg.telegram_chats) + len(cfg.youtube_channels) else 0
        time.sleep(args.loop * 60)


if __name__ == "__main__":
    sys.exit(main())
