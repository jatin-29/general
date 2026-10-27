import logging

import feedparser
import httpx

from ..config import get_settings
from ..models import Source
from ..utils import retry
from .base import Collector, RawItemData, register

log = logging.getLogger("openingshub.youtube")
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
API_URL = "https://www.googleapis.com/youtube/v3/videos"


@retry(attempts=3, exceptions=(httpx.HTTPError,))
def _get(url: str, **kw) -> httpx.Response:
    r = httpx.get(url, timeout=20, follow_redirects=True, **kw)
    r.raise_for_status()
    return r


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


@register
class YouTubeCollector(Collector):
    source_type = "youtube"

    def collect(self, source: Source, last_external_id: str | None) -> list[RawItemData]:
        items = parse_feed(_get(FEED_URL.format(source.identifier)).content)
        key = get_settings().youtube_api_key
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
