"""LinkedIn jobs from your own daily job-alert emails (Gmail, read over IMAP with an app password).

Nothing logs into LinkedIn: LinkedIn emails you the jobs, the collector reads those emails.
"""
from __future__ import annotations

import email
import imaplib
import logging
import re
from datetime import datetime, timedelta, timezone
from email.message import Message
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

log = logging.getLogger("alerts")

SENDERS = ("jobalerts-noreply@linkedin.com", "jobs-noreply@linkedin.com", "jobs-listings@linkedin.com")
JOB_URL = re.compile(r"https?://(?:[a-z]+\.)?linkedin\.com/(?:comm/)?jobs/view/(\d+)", re.I)
# lines in an alert that are not title / company / location
NOISE = re.compile(
    r"^(view job|apply|easy apply|actively recruiting|promoted|be an early applicant|\d+ (?:connection|alumni|applicant)s?|"
    r"see all jobs|new jobs? (?:match|for)|your job alert|unsubscribe|manage alerts?|this company|.*school alumni|-{3,}|={3,}|·)",
    re.I,
)
SENIOR = re.compile(r"\b(senior|sr\.?|lead|principal|staff|manager|director|head|architect|vp)\b", re.I)


def job_link(job_id: str) -> str:
    return f"https://www.linkedin.com/jobs/view/{job_id}/"


class _Anchors(HTMLParser):
    """Text of each job link in an HTML alert, plus the text right after it (company · location)."""

    def __init__(self):
        super().__init__()
        self.jobs: list[dict] = []
        self._href = None
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href = dict(attrs).get("href", "")
            self._buf = []

    def handle_data(self, data):
        if data.strip():
            if self._href is not None:
                self._buf.append(data.strip())
            elif self.jobs and len(self.jobs[-1]["after"]) < 3:
                self.jobs[-1]["after"].append(data.strip())

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            m = JOB_URL.search(self._href or "")
            text = " ".join(self._buf).strip()
            if m and text and not NOISE.match(text):
                if self.jobs and self.jobs[-1]["id"] == m.group(1):  # the logo / title / company links of one card
                    self.jobs[-1]["lines"].append(text)
                else:
                    self.jobs.append({"id": m.group(1), "lines": [text], "after": []})
            self._href = None


def _part(msg: Message, kind: str) -> str:
    for p in msg.walk() if msg.is_multipart() else [msg]:
        if p.get_content_type() == kind:
            raw = p.get_payload(decode=True) or b""
            return raw.decode(p.get_content_charset() or "utf-8", "replace")
    return ""


def parse_alert(msg: Message) -> list[dict]:
    """Jobs in one LinkedIn alert email: [{id, title, company, location, url}]."""
    jobs: dict[str, dict] = {}
    text = _part(msg, "text/plain")
    if text:
        block: list[str] = []
        for line in text.splitlines():
            line = line.strip()
            m = JOB_URL.search(line)
            if m:
                lines = [l for l in block if not NOISE.match(l)][-3:]
                if lines:
                    jobs.setdefault(m.group(1), {"id": m.group(1), "title": lines[0], "company": lines[1] if len(lines) > 1 else "",
                                                 "location": lines[2] if len(lines) > 2 else ""})
                block = []
            elif line:
                block.append(line)
            elif block and len(block) > 4:
                block = block[-4:]
    if not jobs:
        h = _part(msg, "text/html")
        if h:
            p = _Anchors()
            p.feed(h)
            for j in p.jobs:
                rest = [x for x in j["lines"][1:] + j["after"] if not NOISE.match(x)]
                company, location = (rest + ["", ""])[:2]
                if "·" in company and not location:
                    company, _, location = (s.strip() for s in company.partition("·"))
                jobs.setdefault(j["id"], {"id": j["id"], "title": j["lines"][0], "company": company, "location": location})
    for j in jobs.values():
        j["url"] = job_link(j["id"])
    return [j for j in jobs.values() if j["title"]]


def job_text(j: dict) -> str:
    """How a LinkedIn job is stored: like a group post, so the website and the job group read it the same way."""
    lines = [f"{j['title']} at {j['company']}" if j["company"] else j["title"]]
    if j.get("location"):
        lines.append(f"Location: {j['location']}")
    if not SENIOR.search(j["title"]):
        # your alerts are set to Internship / Entry level, so say so (this lets the 2027-batch check count it)
        lines.append("Level: entry level / internship (from your LinkedIn job alert)")
    lines.append(f"Apply: {j['url']}")
    return "\n".join(lines)


def fetch_alerts(address: str, password: str, since_uid: int, days: int = 3, imap_factory=imaplib.IMAP4_SSL) -> tuple[list[tuple[datetime | None, Message]], int]:
    """New LinkedIn alert emails after `since_uid` (or from the last `days` days on the first run)."""
    imap = imap_factory("imap.gmail.com")
    try:
        imap.login(address, password)
        imap.select("INBOX", readonly=True)  # read-only: emails stay unread and untouched
        uids: set[int] = set()
        for sender in SENDERS:
            crit = f'(FROM "{sender}" UID {since_uid + 1}:*)' if since_uid else f'(FROM "{sender}" SINCE {(datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")})'
            typ, data = imap.uid("search", None, crit)
            if typ == "OK" and data and data[0]:
                uids.update(int(u) for u in data[0].split() if int(u) > since_uid)
        out = []
        for uid in sorted(uids):
            typ, data = imap.uid("fetch", str(uid), "(BODY.PEEK[])")
            raw = next((d[1] for d in data or [] if isinstance(d, tuple)), None)
            if typ != "OK" or not raw:
                continue
            msg = email.message_from_bytes(raw)
            try:
                when = parsedate_to_datetime(msg.get("Date"))
            except (TypeError, ValueError):
                when = None
            out.append((when, msg))
        return out, max(uids, default=since_uid)
    finally:
        try:
            imap.logout()
        except Exception:
            pass
