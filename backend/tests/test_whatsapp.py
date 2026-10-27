from datetime import datetime

from fastapi.testclient import TestClient

from app.collectors.whatsapp import group_name_from_filename, parse_chat, to_raw_items
from app.main import app, get_llm
from app.models import Opening, Source

ANDROID = """12/01/24, 10:30 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.
12/01/24, 10:31 - Ravi: Acme is hiring SDE interns!
Location: Remote
Apply: https://acme.com/jobs/1
12/01/24, 10:32 - Priya: ok thanks
12/01/24, 10:33 - Ravi: <Media omitted>
13/01/24, 09:05 - Priya joined using this group's invite link
13/01/24, 09:06 - Priya: This message was deleted
"""

IOS = "[12/01/2024, 10:30:15 PM] Ravi: Foo Corp hiring freshers https://foo.com/apply\n"
TWELVE_H = "1/31/24, 9:05 pm - Ravi: Bar hiring backend engineers, apply https://bar.io\n"


def test_android_multiline_and_system_messages():
    msgs = parse_chat(ANDROID)
    assert [m.sender for m in msgs] == ["Ravi", "Priya"]
    assert msgs[0].timestamp == datetime(2024, 1, 12, 10, 31)
    assert msgs[0].text.splitlines() == [
        "Acme is hiring SDE interns!", "Location: Remote", "Apply: https://acme.com/jobs/1",
    ]


def test_ios_format():
    (m,) = parse_chat(IOS)
    assert m.timestamp == datetime(2024, 1, 12, 22, 30, 15) and m.sender == "Ravi"


def test_12h_clock_and_mmdd_swap():
    (m,) = parse_chat(TWELVE_H)
    assert m.timestamp == datetime(2024, 1, 31, 21, 5)


def test_invisible_chars_and_garbage():
    assert parse_chat("‎12/01/24, 10:30 - A: hello there friend\nnot a chat at all")[0].text.startswith("hello there friend")
    assert parse_chat("random text\nmore text") == []


def test_raw_items_filter_short_and_stable_ids():
    msgs = parse_chat(ANDROID + "12/01/24, 10:40 - Z: hi\n12/01/24, 10:41 - Z: https://x.co\n")
    items = to_raw_items("G", msgs)
    assert len(items) == 2 and items[0].text.startswith("Ravi: Acme")
    assert [i.external_id for i in items] == [i.external_id for i in to_raw_items("G", msgs)]
    assert items[0].external_id != to_raw_items("Other", msgs)[0].external_id


def test_group_name_from_filename():
    assert group_name_from_filename("WhatsApp Chat with Off Campus Jobs.txt") == "Off Campus Jobs"
    assert group_name_from_filename(None) == "WhatsApp group"


def test_upload_endpoint(db, llm):
    app.dependency_overrides[get_llm] = lambda: llm
    try:
        c = TestClient(app, headers={"X-API-Key": "test-key"})
        files = {"file": ("WhatsApp Chat with Jobs Group.txt", ANDROID.encode(), "text/plain")}
        r = c.post("/api/upload/whatsapp", files=files)
        assert r.status_code == 200, r.text
        assert r.json() == {"source_name": "Jobs Group", "parsed_messages": 2, "new_items": 1, "openings_found": 1}
        assert db.query(Opening).one().source_name == "Jobs Group"
        assert db.query(Source).filter_by(type="whatsapp", identifier="Jobs Group").count() == 1
        # re-upload is idempotent
        again = c.post("/api/upload/whatsapp", files=files).json()
        assert again["new_items"] == 0 and again["openings_found"] == 0
        assert c.post("/api/upload/whatsapp", files={"file": ("x.csv", b"a", "text/csv")}).status_code == 422
        assert c.post("/api/upload/whatsapp", files={"file": ("x.txt", b"nothing", "text/plain")}).status_code == 422
    finally:
        app.dependency_overrides.clear()
