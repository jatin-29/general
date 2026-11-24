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
    accept_all: list[str] = field(default_factory=list)  # chats where every text post counts (exclude still applies)
    first_run_backfill: int = 3
    max_chars: int = 700
    # Telegram bot chat that MacroDroid fills with WhatsApp notifications ("WA: <title> || <text>").
    # "auto" finds it by itself; "" turns it off; or name it, e.g. "@my_jobs_bot".
    whatsapp_inbox: str = "auto"
    # Your own job channel: new jobs are posted there. "auto" creates a private channel called repost_title
    # (and sends you its invite link); "" turns it off; or name an existing channel, e.g. "@my_jobs".
    repost_channel: str = ""
    repost_title: str = "OpeningsHub Jobs"
    repost_skip: list[str] = field(default_factory=list)  # job sources never reposted (e.g. a paid group)
    repost_sources: list[str] = field(default_factory=list)  # if set, only sources starting with one of these
    # Role types, one topic each (a job that fits none is not posted), and the batch it must mention ("" = any)
    repost_categories: list[str] = field(default_factory=lambda: ["SDE", "AI/ML", "Data Science", "Analyst", "Product"])
    repost_batch: str = ""
    # WhatsApp chats / senders to ignore completely (part of the group name, chat name or sender), e.g. ["chirag"]
    whatsapp_ignore: list[str] = field(default_factory=list)
    linkedin_alerts: bool = False  # read your LinkedIn job-alert emails from Gmail (needs GMAIL_ADDRESS + GMAIL_APP_PASSWORD)
    repost_recent_days: int = 1  # each day, also post the site's jobs from this many days (today = 1)
    repost_per_run: int = 15


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


def is_excluded(text: str, exclude: list[str]) -> bool:
    t = text.lower()
    return any(_has(t, w) for w in exclude)


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


# Links that are never the job itself: channel/group invites and social profiles in post footers.
PROMO_HOSTS = re.compile(
    r"(^|\.)(t\.me|telegram\.(me|dog)|whatsapp\.com|wa\.me|instagram\.com|youtube\.com|youtu\.be|linktr\.ee|"
    r"facebook\.com|fb\.me|twitter\.com|x\.com|discord\.(gg|com)|threads\.net)$",
    re.I,
)


def job_links(text: str) -> list[str]:
    """Links that can be an apply link (promo / invite links removed)."""
    return [u for u in extract_links(text) if not PROMO_HOSTS.search(urlsplit(u).netloc.lower().split(":")[0])]


def fingerprint(text: str, by_link: bool = True) -> str:
    """Same apply link (or same text) in two groups => same fingerprint, so you get one alert.

    by_link=False compares the text only: used for Saved Messages, where you forwarded a post on purpose.
    """
    links = job_links(text) if by_link else []
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
        self.whatsapp: int = d.get("whatsapp", 0)  # last message id read from the WhatsApp inbox chat
        self.wa_groups: list[str] = d.get("wa_groups", [])  # WhatsApp chats that have posted jobs
        self.repost_id: int = d.get("repost_id", 0)  # your job channel
        self.repost_queue: list[dict] = d.get("repost_queue", [])  # jobs waiting to be posted there
        self.repost_title: str = d.get("repost_title", "")  # the group's name as last set
        self.repost_gid: int = d.get("repost_gid", 0)  # your job group (with topics)
        self.repost_topics: dict[str, int] = d.get("repost_topics", {})  # role type -> topic id
        self.linkedin_uid: int = d.get("linkedin_uid", 0)  # last LinkedIn alert email read
        self.repost_done: list[str] = d.get("repost_done", [])  # job ids already posted (never twice)
        self.repost_today: str = d.get("repost_today", "")  # the day whose site jobs were sent in one go

    def repost_title_pending(self, wanted: str) -> bool:
        return bool(wanted) and self.repost_title != wanted

    @classmethod
    def load(cls, path: str | Path) -> "State":
        try:
            return cls(json.loads(Path(path).read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return cls()

    def save(self, path: str | Path) -> None:
        self.seen = self.seen[-MAX_SEEN:]
        self.repost_queue = self.repost_queue[-200:]
        self.repost_done = self.repost_done[-3000:]
        self.youtube = {k: v[-MAX_YT_IDS:] for k, v in self.youtube.items()}
        Path(path).write_text(json.dumps(self.__dict__, indent=1), encoding="utf-8")

    def was_seen(self, fp: str) -> bool:
        return fp in self.seen

    def mark_seen(self, fp: str) -> None:
        if fp not in self.seen:
            self.seen.append(fp)


# ---------------------------------------------------------------- WhatsApp (via phone notifications)
WA_MARK = re.compile(r"^\s*WA:\s*(?P<title>[^\n]*?)\s*\|\|\s*(?P<text>.*)$", re.S)
WA_NOISE = re.compile(
    r"^(\d+ (new )?messages?( from \d+ chats?)?|checking for new messages|whatsapp web is currently active|"
    r"this message was deleted|(missed|incoming|ongoing) (voice|video) call|.{0,3}(photo|video|voice message|audio|sticker|gif|document))$",
    re.I,
)
# "Hiring: SDE intern" or "Responsibilities and Duties: …" start like "Rahul: hi", but they are the post itself
WA_NOT_SENDER = re.compile(
    r"hiring|job|role|position|company|location|eligib|salary|ctc|stipend|apply|batch|opening|skill|experience|qualif|"
    r"responsib|dut(?:y|ies)|requirement|note|link|deadline|date|venue|time|mode|type|about|description|\bjd\b|profile|"
    r"title|designation|package|perks|benefit|process|round|interview|registration|website|email|contact|address|timing|"
    r"shift|urgent|update|alert",
    re.I,
)
WA_SENDER = re.compile(r"^(~\s?)?(\+?[^\W_][\w .'’()+\-]{0,39}?):\s+")  # a name or a phone number


def wa_ignored(message: str, ignore: list[str]) -> bool:
    """Is this WhatsApp notification from a chat or person you chose to ignore? (title, or "Name:" in front of the text)"""
    m = WA_MARK.match(message or "")
    if not m or not ignore:
        return False
    sender = WA_SENDER.match(m["text"].strip())
    who = f"{m['title']} {sender[2] if sender else ''}".lower()
    return any(k.strip().lower() in who for k in ignore if k.strip())


def parse_wa(message: str) -> tuple[str, str] | None:
    """MacroDroid's "WA: <notification title> || <notification text>" -> (group, post), or None for noise."""
    m = WA_MARK.match(message or "")
    if not m:
        return None
    title, text = m["title"].strip(), m["text"].strip()
    group = re.split(r"\s*\(\d+ (?:new )?messages?\)|:\s", title, maxsplit=1)[0].strip() or "WhatsApp"
    # group notifications put the sender in front of the text: "~ Rahul: We're hiring", "Akshat Jain: Responsibilities…"
    sender = WA_SENDER.match(text)
    if sender and len(sender[2].split()) <= 4 and not WA_NOT_SENDER.search(sender[2]):
        text = text[sender.end():]
    if not text or WA_NOISE.match(text):
        return None
    return group, text


# Words that show up in job posts (and rarely together in chat).
WA_WORDS = re.compile(
    r"\b(hiring|hire|hires|intern|interns|internships?|job|jobs|openings?|vacanc(?:y|ies)|roles?|positions?|apply|ctc|lpa|"
    r"stipend|salary|package|eligib\w*|batch(?:es)?|freshers?|experience|graduates?|b\.?\s?tech|mba|mca|bca|location|"
    r"remote|wfh|work from home|on-?site|hybrid|deadline|last date|registration|register|drive|walk-?in|recruit\w*|"
    r"referral|jd|engineer|developer|analyst|trainee|associate|executive|sde|qualifications?|skills|off ?campus|"
    r"on ?campus|full[- ]time|part[- ]time|careers?|interviews?|cv|resume)\b",
    re.I,
)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def wa_signals(text: str, cfg: "Config") -> tuple[int, bool]:
    """(how many different job words, has an apply link or email)."""
    t = text.lower()
    words = {m.group(0).lower() for m in WA_WORDS.finditer(t)} | {w for w in cfg.include if _has(t, w)}
    return len(words), bool(job_links(text)) or EMAIL.search(text) is not None


def is_wa_job(text: str, cfg: "Config", job_group: bool = False) -> bool:
    """WhatsApp also carries chat ("are you applying for this job?"). A job post has an apply link or email and a
    job word, or several job words. Groups that already posted jobs need a little less."""
    if is_excluded(text, cfg.exclude):
        return False
    words, contact = wa_signals(text, cfg)
    if contact and words >= 1 and len(text) >= 30:
        return True
    return words >= 4 or (words >= 3 and (job_group or len(text) >= 120))


# ---------------------------------------------------------------- your job channel
_FRESHER = re.compile(r"\b(freshers?|entry[- ]level|no (?:prior )?experience|new grads?|0\s*(?:-|–|to)\s*\d{1,2}\s*(?:yrs?|years?))\b", re.I)
_HINT = re.compile(r"\b(trainees?|off[- ]?campus|batch(?:es)?|pass ?outs?|graduat\w*)\b", re.I)
_INTERN = re.compile(r"\b(internships?|interns?)\b", re.I)
_SENIOR = re.compile(r"\b(senior|sr\.|lead|principal|manager|director|architect|[2-9]\s*\+?\s*(?:-\s*\d+\s*)?(?:yrs?|years?))\b", re.I)


# Software developer roles (and not "business development", HR, analyst… posts).
SDE_ROLE = re.compile(
    r"\b(sde|swe|software (?:development )?(?:engineer|developer)|(?:backend|back-end|frontend|front-end|full[- ]?stack|web|mobile|"
    r"app|android|ios|flutter|react(?:\.js)?|angular|node(?:\.js)?|java|python|golang|go|\.net|php|mern|mean|ruby|rust|c\+\+|"
    r"blockchain|game|embedded|cloud|devops)\s*(?:developer|engineer|dev)s?|developers?|programmer|coder)\b",
    re.I,
)
NOT_SDE = re.compile(r"\bbusiness development|\bbde\b|sales|marketing|\bhr\b|recruiter|real estate developer", re.I)


def is_sde_job(text: str) -> bool:
    return bool(SDE_ROLE.search(text)) and not NOT_SDE.search(text[:200])


ROLE_TYPES = {
    "Product": re.compile(r"\b(product (?:manager|management|analyst|intern|associate|owner|designer)s?|apm|associate product)\b", re.I),
    "Data Science": re.compile(r"\b(data scien\w*|data engineer\w*|big data|data mining|data (?:intern|internship|trainee)s?|statistician|research scientist)\b", re.I),
    "AI/ML": re.compile(r"\b(ai|ml|ai/ml|artificial intelligence|machine learning|deep learning|nlp|computer vision|gen ?ai|generative ai|llms?|mlops)\b", re.I),
    "Analyst": re.compile(r"\b(analysts?|analytics)\b", re.I),
}
# More role types you can add to repost_categories (each becomes its own topic in the group)
EXTRA_ROLES = {
    "QA/Testing": re.compile(r"\b(qa|quality assurance|sdet|testers?|(?:software|manual|automation) test\w*|test engineers?)\b", re.I),
    "DevOps/Cloud": re.compile(r"\b(devops|sre|site reliability|cloud (?:engineer|associate|support)\w*|platform engineer\w*)\b", re.I),
    "Cybersecurity": re.compile(r"\b(cyber ?security|security (?:engineer|analyst)s?|soc analyst|infosec|penetration test\w*|ethical hack\w*)\b", re.I),
    "UI/UX Design": re.compile(r"\b(ui ?/ ?ux|ux|ui designer|product designer|graphic designer|visual designer)\b", re.I),
    "Consulting": re.compile(r"\b(consultants?|consulting)\b", re.I),
    "Core/Hardware": re.compile(r"\b(vlsi|embedded|firmware|hardware|electronics|semiconductor|mechanical|electrical|civil engineer)\w*", re.I),
    "Finance/Quant": re.compile(r"\b(quant\w*|investment bank\w*|financial analyst|equity research|trading)\b", re.I),
}
ROLE_TYPES.update(EXTRA_ROLES)

NOT_TECH = re.compile(r"\bbusiness development|\bbde\b|\bsales\b|telesales|marketing|\bhr\b|recruiter|real estate", re.I)


def job_category(text: str, wanted: list[str]) -> str | None:
    """Which role type (topic) a post belongs to: the title line decides first, then the start of the post."""
    if NOT_TECH.search(text[:200]):
        return None
    first = next((l for l in text.splitlines() if l.strip()), "")
    rules = [(n, rx) for n, rx in ROLE_TYPES.items() if n in wanted] + ([("SDE", SDE_ROLE)] if "SDE" in wanted else [])
    for part in (first, text[:600]):
        hits = [(m.start(), i, name) for i, (name, rx) in enumerate(rules) if (m := rx.search(part))]
        if hits:
            return min(hits)[2]  # the role named first ("Software Engineer at an AI startup" is SDE)
    return None


_BATCH_WORD = r"(?:batch(?:es)?|pass(?:ing)?[ -]?outs?|graduat\w*|grads?|class of|year of passing|yop|eligib\w*|students?|freshers?)"
_YEAR = r"(?:20)?2\d|2k2\d|['’]2\d"
_YEAR_RUN = re.compile(rf"(?<![\d/.-])({_YEAR})(?:\s*(?:-|–|to|/|&|,|and|or)\s*({_YEAR}))*(?![\d/.])", re.I)
_FINAL_YEAR = re.compile(r"(?<!pre[- ])(?<!pre)\bfinal[- ]year\b", re.I)
_PRE_FINAL = re.compile(r"\bpre[- ]?final[- ]year\b", re.I)
_FOR_FRESHERS = re.compile(r"\b(freshers?|entry[- ]level|interns?|internships?|trainees?|new grads?|students?|0\s*(?:-|–|to)\s*1\s*(?:yrs?|years?)|no experience)\b", re.I)
_NEEDS_EXPERIENCE = re.compile(r"\b([1-9])\s*\+?\s*(?:-|–|to)?\s*\d*\s*\+?\s*(?:yrs?|years?)\s*(?:of\s*)?(?:relevant\s+|work\s+)?(?:exp|experience)", re.I)


def _year(tok: str) -> int:
    d = re.sub(r"\D", "", tok)[-2:]
    return 2000 + int(d)


def batch_years(text: str) -> set[int]:
    """Batch years a post names: "2027 batch", "2025-2027 passouts", "2026/27", "graduating in 2k27" (not "Last date: 30 Nov 2026")."""
    years: set[int] = set()
    for m in _YEAR_RUN.finditer(text):
        before = text[max(0, m.start() - 16): m.start()]
        if re.search(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*$|\d\s*[/.-]\s*$|\b(date|deadline|by|till|until|before|on)\b[:\s\d]*$", before, re.I):
            continue  # part of a date ("30 Nov 2026", "Last date: 2026")
        around = text[max(0, m.start() - 40): m.end() + 40]
        if not re.search(_BATCH_WORD, around, re.I):
            continue  # a number, not a batch
        found = [_year(t) for t in re.findall(_YEAR, m.group(0), re.I)]
        found = [y for y in found if 2018 <= y <= 2032]
        if len(found) >= 2 and re.search(r"\d\s*(?:-|–|to)\s*", m.group(0)):  # a range: 2025-2027 -> 2025, 2026, 2027
            years.update(range(min(found), max(found) + 1))
        else:
            years.update(found)
    return years


def batch_match(text: str, batch: str) -> bool:
    """Is this post open to `batch` (e.g. "2027")? Named batches decide; with none named, a post for freshers,
    interns or final-year students counts, unless it asks for experience or pre-final-year students."""
    if not batch:
        return True
    want = int(batch)
    named = batch_years(text)
    if named:
        return want in named
    no_zero_ranges = re.sub(r"\b0\s*(?:-|–|to)\s*\d+", " ", text)  # "0-1 years" welcomes freshers
    if _PRE_FINAL.search(text) or _NEEDS_EXPERIENCE.search(no_zero_ranges):
        return False
    return bool(_FINAL_YEAR.search(text) or _FOR_FRESHERS.search(text))


# Lines that only point back to where the post came from ("Join our WhatsApp group", "Follow @xyz", invite links…)
_SOURCE_LINE = re.compile(
    r"\b(join|follow|subscribe|share (?:this|with)|forward(?:ed)? (?:from|to)|credits?|via|our (?:channel|group|community|page))\b"
    r"|chat\.whatsapp\.com|whatsapp\.com/channel|wa\.me/|t\.me/|telegram\.(?:me|dog)/|instagram\.com|linktr\.ee|youtube\.com|youtu\.be"
    r"|^\s*@\w{4,}\s*$",
    re.I,
)


def clean_post(text: str) -> str:
    """The post without its source: the sender's name in front and lines about the group/channel it came from."""
    text = text.strip()
    sender = WA_SENDER.match(text)
    if sender and len(sender[2].split()) <= 4 and not WA_NOT_SENDER.search(sender[2]):
        text = text[sender.end():]
    kept = []
    for line in text.splitlines():
        if _SOURCE_LINE.search(line) and not job_links(line):  # keep a line that also carries the apply link
            continue
        kept.append(re.sub(r"(?<!\w)@[A-Za-z]\w{3,}", "", line).rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def repost_text(job: dict) -> str:
    """A job as posted in your group: title line, tags, the post (shortened, without its source), apply link."""
    text = clean_post(job["text"]) or job["text"].strip()
    first = next((l.strip() for l in text.splitlines() if l.strip()), "Job opening")
    title = re.sub(r"https?://\S+", "", first)
    title = re.sub(r"^[\W_]*\d{1,2}\s*[.)]\s*", "", title).strip()[:120] or "Job opening"  # "4) Company - Beroe" -> "Company - Beroe"
    tags = []
    if _INTERN.search(text):
        tags.append("#internship")
    if _FRESHER.search(text) or (_HINT.search(text) and not _SENIOR.search(text)):
        tags.append("#fresher")
    rest = text[len(first):].strip()
    if len(rest) > 3600:  # Telegram allows 4096 characters: only a really long post is shortened
        rest = rest[:3600].rsplit(" ", 1)[0] + "…"
    parts = [f"💼 {title}"]
    if tags:
        parts.append(" ".join(tags))
    if rest:
        parts.append(rest)
    if job.get("apply_link") and job["apply_link"] not in rest:
        parts.append(f"🔗 Apply: {job['apply_link']}")
    return "\n\n".join(parts)


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


# ---------------------------------------------------------------- stored jobs (data/jobs.json, shown on the website)
MAX_JOBS = 1000
MAX_DELETED = 5000
MAX_STORED_CHARS = 2500
JOB_ID = re.compile(r"^[0-9a-f]{12}$")


def make_job(source: str, text: str, post_url: str | None, posted_at=None, now=None, fp: str | None = None) -> dict:
    """One listing as stored in jobs.json."""
    from datetime import datetime, timezone

    links = job_links(text)
    fp = fp or fingerprint(text)
    return {
        "id": hashlib.sha1(fp.encode()).hexdigest()[:12],
        "fingerprint": fp,
        "source": source,
        "text": text.strip()[:MAX_STORED_CHARS],
        "apply_link": links[0] if links else None,
        "post_url": post_url,
        "posted_at": posted_at.astimezone(timezone.utc).isoformat(timespec="seconds") if posted_at else None,
        "added_at": (now or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
    }


KDF_ITERATIONS = 200_000


class StoreLocked(Exception):
    """jobs.json is encrypted and the password is missing or wrong. Never overwrite it in that case."""


def _derive_key(password: str, salt: bytes, iterations: int) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(password.encode())


def encrypt_payload(payload: dict, password: str) -> dict:
    """AES-256-GCM with a PBKDF2 key. The browser decrypts this with WebCrypto (see frontend/lib/crypto.ts)."""
    import base64
    import os

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    salt, nonce = os.urandom(16), os.urandom(12)
    key = _derive_key(password, salt, KDF_ITERATIONS)
    blob = AESGCM(key).encrypt(nonce, json.dumps(payload, ensure_ascii=False).encode(), None)  # ciphertext + tag
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return {"v": 1, "kdf": "pbkdf2-sha256", "iter": KDF_ITERATIONS, "salt": b64(salt), "nonce": b64(nonce), "data": b64(blob)}


def decrypt_payload(envelope: dict, password: str) -> dict:
    import base64

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = _derive_key(password, base64.b64decode(envelope["salt"]), int(envelope["iter"]))
    return json.loads(AESGCM(key).decrypt(base64.b64decode(envelope["nonce"]), base64.b64decode(envelope["data"]), None))


class JobStore:
    """Collected jobs, newest first. Encrypted on disk when a password is set."""

    def __init__(self, jobs: list[dict] | None = None, password: str | None = None, deleted: list[str] | None = None):
        self.jobs: list[dict] = jobs or []
        self.password = password or None
        self.deleted: list[str] = deleted or []  # fingerprints you deleted on the website; never added again
        self.new = 0
        self.changed = False

    @property
    def allow_private(self) -> bool:
        """Posts from private groups may only be stored when they will be encrypted."""
        return self.password is not None

    @classmethod
    def load(cls, path: str | Path, password: str | None = None) -> "JobStore":
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return cls(password=password)
        if raw.get("v"):  # encrypted file
            if not password:
                raise StoreLocked("data/jobs.json is encrypted but the SITE_PASSWORD secret is not set.")
            try:
                raw = decrypt_payload(raw, password)
            except Exception as e:
                raise StoreLocked("data/jobs.json could not be decrypted: SITE_PASSWORD is different from the one used before.") from e
        return cls(raw.get("jobs", []), password, raw.get("deleted", []))

    def add(self, job: dict) -> bool:
        if job["fingerprint"] in self.deleted or any(j["fingerprint"] == job["fingerprint"] or j["text"] == job["text"] for j in self.jobs):
            return False
        self.jobs.insert(0, job)
        self.new += 1
        return True

    def delete(self, ids: list[str]) -> int:
        """Remove jobs by id (the website's delete button) and remember them so they never come back."""
        wanted = {i for i in ids if JOB_ID.match(i)}
        gone = [j for j in self.jobs if j["id"] in wanted]
        if gone:
            self.jobs = [j for j in self.jobs if j["id"] not in wanted]
            self.deleted.extend(j["fingerprint"] for j in gone if j["fingerprint"] not in self.deleted)
            self.changed = True
        return len(gone)

    def save(self, path: str | Path) -> None:
        from datetime import datetime, timezone

        if not (self.new or self.changed):
            return  # nothing new: leave the file alone so no commit is made
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "jobs": self.jobs[:MAX_JOBS],
            "deleted": self.deleted[-MAX_DELETED:],
        }
        if self.password:
            out = {**encrypt_payload(payload, self.password), "updated_at": payload["updated_at"]}
        else:
            out = payload
        Path(path).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
