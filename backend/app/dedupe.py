import re
from urllib.parse import parse_qsl, urlencode, urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Opening

_TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|ref$|source$|igshid$)", re.I)
_SUFFIXES = {"pvt", "private", "ltd", "limited", "inc", "llc", "llp", "corp", "co", "plc"}


def normalize_link(url: str) -> str:
    u = urlsplit(url.strip())
    host = u.netloc.lower().removeprefix("www.")
    q = sorted((k, v) for k, v in parse_qsl(u.query) if not _TRACKING.match(k))
    path = u.path.rstrip("/")
    return f"{host}{path}" + (f"?{urlencode(q)}" if q else "")


def _norm_text(s: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split())


def normalize_company(s: str) -> str:
    return " ".join(w for w in _norm_text(s).split() if w not in _SUFFIXES)


def make_dedupe_key(apply_link: str | None, company: str, role: str) -> str:
    if apply_link and apply_link.strip():
        return "link:" + normalize_link(apply_link)
    return f"cr:{normalize_company(company)}|{_norm_text(role)}"


def find_duplicate(db: Session, key: str) -> Opening | None:
    return db.scalar(select(Opening).where(Opening.dedupe_key == key))
