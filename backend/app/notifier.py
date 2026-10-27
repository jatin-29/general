import logging

import httpx

from .runtime import effective_settings
from .models import Opening
from .utils import retry

log = logging.getLogger("openingshub.notifier")


@retry(attempts=3, exceptions=(httpx.HTTPError,))
def _send(token: str, chat_id: str, text: str) -> None:
    r = httpx.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
        timeout=15,
    )
    r.raise_for_status()


def notify_opening(o: Opening) -> None:
    s = effective_settings()
    if not (s.telegram_bot_token and s.telegram_notify_chat_id):
        return
    lines = [f"New opening: {o.role} @ {o.company}"]
    if o.location:
        lines.append(f"Location: {o.location}")
    if o.employment_type:
        lines.append(f"Type: {o.employment_type}")
    if o.deadline:
        lines.append(f"Deadline: {o.deadline.isoformat()}")
    lines.append(f"Source: {o.source_type}/{o.source_name}")
    if o.apply_link:
        lines.append(o.apply_link)
    try:
        _send(s.telegram_bot_token, s.telegram_notify_chat_id, "\n".join(lines))
    except Exception:
        log.exception("notification failed")
