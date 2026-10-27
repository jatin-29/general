import html
import logging
import re

import feedparser
import httpx

from ..runtime import effective_settings
from ..models import Source
from ..utils import retry
from .base import Collector, RawItemData, register

log = logging.getLogger("openingshub.youtube")
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
API_URL = "https://www.googleapis.com/youtube/v3/videos"
PLAYLIST_URL = "https://www.googleapis.com/youtube/v3/playlistItems"


@retry(attempts=3, exceptions=(httpx.HTTPError,))
def _get(url: str, **kw) -> httpx.Response:
    r = httpx.get(url, timeout=20, follow_redirects=True, **kw)
    r.raise_for_status()
    return r


_UC = re.compile(r"UC[\w-]{22}")


class ChannelNotFound(Exception):
    pass


def resolve_channel(ref: str) -> tuple[str, str | None]:
    """Accept a channel id, /channel/UC… URL, @handle or youtube.com/@handle URL -> (channel_id, title)."""
    ref = ref.strip()
    if _UC.fullmatch(ref):
        return ref, None
    if m := re.search(r"youtube\.com/channel/(UC[\w-]{22})", ref):
        return m.group(1), None
    if ref.startswith("http"):
        url = ref
    elif ref.startswith("@"):
        url = f"https://www.youtube.com/{ref}"
    elif re.fullmatch(r"[\w.-]{3,60}", ref):
        url = f"https://www.youtube.com/@{ref}"
    else:
        raise ChannelNotFound(ref)
    try:
        page = _get(url, headers={"Cookie": "CONSENT=YES+1; SOCS=CAI"}).text
    except httpx.HTTPError as e:
        raise ChannelNotFound(ref) from e
    m = (
        re.search(r'"(?:channelId|externalId)":"(UC[\w-]{22})"', page)
        or re.search(r'<meta itemprop="(?:identifier|channelId)" content="(UC[\w-]{22})"', page)
        or re.search(r'youtube\.com/channel/(UC[\w-]{22})', page)
    )
    if not m:
        raise ChannelNotFound(ref)
    t = re.search(r'<meta property="og:title" content="([^"]+)"', page)
    return m.group(1), html.unescape(t.group(1)) if t else None


def parse_feed(content: str | bytes) -> list[RawItemData]:
    feed = feedparser.parse(content)
    items = []
    for e in feed.entries:
        vid = e.get("yt_videoid") or e.get("id", "").removeprefix("yt:video:")
        if not vid:
            continue
        desc = e.get("summary", "") or ""
        items.append(
            RawItemData(
                external_id=vid,
                text=f"{e.get('title', '')}\n\n{desc}".strip(),
                url=e.get("link") or f"https://www.youtube.com/watch?v={vid}",
            )
        )
    return items


def fetch_full_descriptions(video_ids: list[str], api_key: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i : i + 50]
        r = _get(API_URL, params={"part": "snippet", "id": ",".join(chunk), "key": api_key})
        for v in r.json().get("items", []):
            out[v["id"]] = v["snippet"].get("description", "")
    return out


def fetch_via_api(channel_id: str, api_key: str) -> list[RawItemData]:
    """Latest uploads through the Data API (1 quota unit); used when the RSS feed is unreachable."""
    uploads = "UU" + channel_id[2:]  # a channel's uploads playlist id
    r = _get(PLAYLIST_URL, params={"part": "snippet", "playlistId": uploads, "maxResults": 15, "key": api_key})
    items = []
    for it in r.json().get("items", []):
        sn = it["snippet"]
        vid = sn["resourceId"]["videoId"]
        items.append(
            RawItemData(
                external_id=vid,
                text=f"{sn.get('title', '')}\n\n{sn.get('description', '')}".strip(),
                url=f"https://www.youtube.com/watch?v={vid}",
            )
        )
    return items


@register
class YouTubeCollector(Collector):
    source_type = "youtube"

    def collect(self, source: Source, last_external_id: str | None) -> list[RawItemData]:
        key = effective_settings().youtube_api_key
        try:
            items = parse_feed(_get(FEED_URL.format(source.identifier)).content)
        except httpx.HTTPError:
            if not key:
                raise RuntimeError(
                    "YouTube RSS feed unavailable from this server. Add a YouTube Data API key in Settings to use the API instead."
                )
            log.warning("RSS failed for %s; using YouTube Data API", source.identifier)
            return fetch_via_api(source.identifier, key)
        if key and items:
            try:
                full = fetch_full_descriptions([i.external_id for i in items], key)
                for it in items:
                    if it.external_id in full:
                        title = it.text.split("\n\n", 1)[0]
                        it.text = f"{title}\n\n{full[it.external_id]}".strip()
            except Exception:
                log.exception("YouTube Data API failed; using RSS descriptions")
        return items  # pipeline skips ids already stored
