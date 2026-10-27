"""WhatsApp exported-chat parser (no unofficial APIs: the user exports the chat and uploads it).

Supported header styles:
  Android: "DD/MM/YY, HH:MM - Sender: message"   (also 12h "10:30 pm", 4-digit years)
  iOS:     "[DD/MM/YY, HH:MM:SS] Sender: message"
Lines without a header continue the previous message.
"""
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime

from .base import Collector, RawItemData, register

_HEADER = re.compile(
    r"^\[?(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap]\.?[Mm]\.?)?\]?\s*(?:-\s*)?(.*)$"
)
_INVISIBLE = dict.fromkeys(map(ord, "‎‏‪‬﻿"), None)
_SKIP = re.compile(
    r"^(<media omitted>|<attached:.*>|.*\(file attached\)|image omitted|video omitted|sticker omitted|"
    r"gif omitted|audio omitted|this message was deleted|you deleted this message|null)$",
    re.I,
)


@dataclass
class WhatsAppMessage:
    timestamp: datetime
    sender: str
    text: str


def _to_datetime(d, m, y, hh, mm, ss, ampm) -> datetime | None:
    d, m, y, hh, mm = int(d), int(m), int(y), int(hh), int(mm)
    if y < 100:
        y += 2000
    if m > 12 >= d:  # MM/DD exports
        d, m = m, d
    if ampm:
        pm = ampm.lower().startswith("p")
        hh = hh % 12 + (12 if pm else 0)
    try:
        return datetime(y, m, d, hh, mm, int(ss or 0))
    except ValueError:
        return None


def parse_chat(content: str) -> list[WhatsAppMessage]:
    content = content.translate(_INVISIBLE).replace(" ", " ").replace(" ", " ")
    messages: list[WhatsAppMessage] = []
    current: WhatsAppMessage | None = None
    for line in content.splitlines():
        m = _HEADER.match(line)
        ts = _to_datetime(*m.groups()[:7]) if m else None
        if m and ts:
            sender, sep, text = m.group(8).partition(": ")
            if not sep:  # system message ("Messages are end-to-end encrypted", "X joined")
                current = None
                continue
            current = WhatsAppMessage(ts, sender.strip(), text)
            messages.append(current)
        elif current is not None:
            current.text += "\n" + line
    for msg in messages:
        msg.text = msg.text.strip()
    return [m for m in messages if m.text and not _SKIP.match(m.text)]


def message_external_id(group: str, msg: WhatsAppMessage) -> str:
    """Stable across re-uploads/overlapping exports, so duplicates are skipped."""
    raw = f"{group}|{msg.timestamp.isoformat()}|{msg.sender}|{msg.text}"
    return hashlib.sha1(raw.encode()).hexdigest()[:24]


def group_name_from_filename(filename: str | None) -> str:
    name = re.sub(r"\.txt$", "", filename or "", flags=re.I).strip()
    name = re.sub(r"^WhatsApp Chat (with|-)\s*", "", name, flags=re.I).strip()
    return name or "WhatsApp group"


def to_raw_items(group: str, messages: list[WhatsAppMessage], min_chars: int = 25) -> list[RawItemData]:
    """Drop chit-chat that can't be a posting (short, no link) to save LLM cost."""
    return [
        RawItemData(
            external_id=message_external_id(group, m),
            text=f"{m.sender}: {m.text}",
            published_at=m.timestamp,
        )
        for m in messages
        if len(m.text) >= min_chars or "http" in m.text.lower()
    ]


@register
class WhatsAppCollector(Collector):
    source_type = "whatsapp"
    polled = False  # data arrives via POST /api/upload/whatsapp
