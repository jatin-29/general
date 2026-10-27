"""Pure logic: matching, formatting, state, feed parsing. No network, so it is easy to test."""
import hashlib
import json
import re
import tomllib
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")
_TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|ref$|igshid$)", re.I)
MAX_SEEN = 1000
MAX_YT_IDS = 100


@dataclass
class Config:
    telegram_chats: list[str] = field(default_factory=list)
    youtube_channels: list[str] = field(default_factory=list)
    include: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    first_run_backfill: int = 3
    max_chars: int = 700


def load_config(path: str | Path) -> Config:
    data = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    known = Config.__dataclass_fields__
    return Config(**{k: v for k, v in data.items() if k in known})


# ---------------------------------------------------------------- matching
def _has(text: str, kw: str) -> bool:
    kw = kw.strip().lower()
    if not kw:
        return False
    prefix = kw.endswith("*")
    pattern = r"(?<!\w)" + re.escape(kw.rstrip("*")) + ("" if prefix else r"(?!\w)")
    return re.search(pattern, text) is not None


def is_match(text: str, include: list[str], exclude: list[str]) -> bool:
    t = text.lower()
    if any(_has(t, w) for w in exclude):
        return False
    return any(_has(t, w) for w in include)


# ---------------------------------------------------------------- links / dedupe
def extract_links(text: str) -> list[str]:
    return [u.rstrip(".,;:!?") for u in URL_RE.findall(text)]


def normalize_link(url: str) -> str:
    u = urlsplit(url.strip())
    q = sorted((k, v) for k, v in parse_qsl(u.query) if not _TRACKING.match(k))
    return f"{u.netloc.lower().removeprefix('www.')}{u.path.rstrip('/')}" + (f"?{urlencode(q)}" if q else "")


def fingerprint(text: str) -> str:
    """Same apply link (or same text) in two groups => same fingerprint, so you get one alert."""
    links = [u for u in extract_links(text) if "t.me/" not in u]
    if links:
        return "link:" + normalize_link(links[0])
    norm = " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())
    return "txt:" + hashlib.sha1(norm.encode()).hexdigest()[:16]


def format_alert(source: str, text: str, post_url: str | None, max_chars: int) -> str:
    body = text.strip()
    if len(body) > max_chars:
        body = body[:max_chars].rstrip() + "…"
    parts = [f"📌 {source}", "", body]
    links = extract_links(text)
    if links:
        parts += ["", f"Apply: {links[0]}"]
    if post_url:
        parts += ["", f"Post: {post_url}"]
    return "\n".join(parts)


# ---------------------------------------------------------------- state
class State:
    """Remembers what was already seen. Stored as JSON between runs."""

    def __init__(self, data: dict | None = None):
        d = data or {}
        self.telegram: dict[str, int] = d.get("telegram", {})
        self.youtube: dict[str, list[str]] = d.get("youtube", {})
        self.seen: list[str] = d.get("seen", [])
        self.channels: dict[str, str] = d.get("channels", {})  # youtube handle -> channel id

    @classmethod
    def load(cls, path: str | Path) -> "State":
        try:
            return cls(json.loads(Path(path).read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return cls()

    def save(self, path: str | Path) -> None:
        self.seen = self.seen[-MAX_SEEN:]
        self.youtube = {k: v[-MAX_YT_IDS:] for k, v in self.youtube.items()}
        Path(path).write_text(json.dumps(self.__dict__, indent=1), encoding="utf-8")

    def was_seen(self, fp: str) -> bool:
        return fp in self.seen

    def mark_seen(self, fp: str) -> None:
        if fp not in self.seen:
            self.seen.append(fp)


# ---------------------------------------------------------------- YouTube feed
_NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "m": "http://search.yahoo.com/mrss/"}


def parse_feed(xml_text: str) -> list[dict]:
    """Newest first, as YouTube returns them."""
    root = ET.fromstring(xml_text)
    out = []
    for e in root.findall("a:entry", _NS):
        vid = e.findtext("yt:videoId", default="", namespaces=_NS)
        if not vid:
            continue
        link = e.find("a:link", _NS)
        out.append({
            "id": vid,
            "title": e.findtext("a:title", default="", namespaces=_NS),
            "description": e.findtext("m:group/m:description", default="", namespaces=_NS) or "",
            "url": link.get("href") if link is not None else f"https://www.youtube.com/watch?v={vid}",
        })
    return out
