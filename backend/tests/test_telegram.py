from types import SimpleNamespace

import pytest

from app.collectors.telegram import TelegramCollector, clean_identifier, message_to_item
from app.models import Source


def test_clean_identifier():
    assert clean_identifier("@jobs") == "jobs"
    assert clean_identifier("https://t.me/jobs") == "jobs"
    assert clean_identifier("-1001234567890") == -1001234567890


def test_message_to_item_public_and_private():
    m = SimpleNamespace(id=7, message=" Hiring! ", date=None)
    assert message_to_item(m, "jobs", 1).url == "https://t.me/jobs/7"
    assert message_to_item(m, None, 123).url == "https://t.me/c/123/7"
    assert message_to_item(SimpleNamespace(id=8, message="", date=None), "jobs", 1) is None  # media-only


def test_collect_requires_credentials(monkeypatch):
    with pytest.raises(RuntimeError, match="not configured"):
        TelegramCollector().collect(Source(type="telegram", identifier="jobs"), None)
