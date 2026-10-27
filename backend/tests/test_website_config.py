import asyncio
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import runtime, telegram_login
from app.collectors import youtube
from app.main import app, get_llm
from app.models import Opening, Source


@pytest.fixture
def client(db):
    return TestClient(app, headers={"X-API-Key": "test-key"})


# ---------------------------------------------------------------- settings
def test_settings_mask_secrets_and_override_env(db, client):
    r = client.put("/api/settings", json={"values": {"anthropic_api_key": "sk-secret", "telegram_api_id": "123"}})
    assert r.status_code == 200
    by_key = {s["key"]: s for s in r.json()}
    assert by_key["anthropic_api_key"]["is_set"] and by_key["anthropic_api_key"]["value"] is None  # never returned
    assert by_key["telegram_api_id"]["value"] == "123" and by_key["telegram_api_id"]["origin"] == "website"
    s = runtime.effective_settings()
    assert s.anthropic_api_key == "sk-secret" and s.telegram_api_id == 123
    client.put("/api/settings", json={"values": {"anthropic_api_key": ""}})  # clear
    assert runtime.effective_settings().anthropic_api_key == ""


def test_settings_validation_and_auth(db, client):
    assert client.put("/api/settings", json={"values": {"database_url": "x"}}).status_code == 422
    assert client.put("/api/settings", json={"values": {"telegram_api_id": "abc"}}).status_code == 422
    anon = TestClient(app)
    assert anon.get("/api/settings").status_code == 401
    assert anon.get("/api/telegram/chats").status_code == 401


# ---------------------------------------------------------------- manual openings
def test_manual_opening_crud_and_dedupe(db, client):
    body = {"company": "Acme", "role": "SDE Intern", "employment_type": "internship",
            "deadline": str(date.today() - timedelta(days=1)), "apply_link": "https://acme.com/j?utm_source=wa",
            "notes": "Forwarded from WhatsApp"}
    r = client.post("/api/openings", json=body)
    assert r.status_code == 201 and r.json()["source_type"] == "manual" and r.json()["is_expired"] is True
    oid = r.json()["id"]
    assert client.get(f"/api/openings/{oid}").json()["raw_text"] == "Forwarded from WhatsApp"
    assert client.post("/api/openings", json=dict(body, apply_link="http://www.acme.com/j")).status_code == 409
    assert client.post("/api/openings", json={"company": "", "role": "x"}).status_code == 422
    assert TestClient(app).post("/api/openings", json=body).status_code == 401  # API_KEY configured
    assert client.delete(f"/api/openings/{oid}").status_code == 204
    assert db.query(Opening).count() == 0


def test_extract_preview(db, client, llm):
    app.dependency_overrides[get_llm] = lambda: llm
    try:
        r = client.post("/api/extract", json={"text": "Acme is hiring interns"})
        assert r.status_code == 200 and r.json()["company"] == "Acme Pvt Ltd" and r.json()["is_opening"] is True
        assert db.query(Opening).count() == 0  # preview only
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------- sources
def test_source_delete_and_name(db, client):
    s = client.post("/api/sources", json={"type": "telegram", "identifier": "-1001", "name": "My Group"}).json()
    assert s["name"] == "My Group"
    assert db.get(Source, s["id"]).label == "My Group"
    assert client.delete(f"/api/sources/{s['id']}").status_code == 204
    assert client.delete(f"/api/sources/{s['id']}").status_code == 404
    assert client.post("/api/sources", json={"type": "whatsapp", "identifier": "x"}).status_code == 422


def test_youtube_source_is_resolved(db, client, monkeypatch):
    monkeypatch.setattr("app.main.resolve_channel", lambda ref: ("UC" + "a" * 22, "Jobs Channel"))
    s = client.post("/api/sources", json={"type": "youtube", "identifier": "@jobs"}).json()
    assert s["identifier"] == "UC" + "a" * 22 and s["name"] == "Jobs Channel"

    def boom(ref):
        raise youtube.ChannelNotFound(ref)

    monkeypatch.setattr("app.main.resolve_channel", boom)
    assert client.post("/api/sources", json={"type": "youtube", "identifier": "@nope"}).status_code == 422


def test_resolve_channel_forms(monkeypatch):
    uc = "UC" + "b" * 22
    assert youtube.resolve_channel(uc) == (uc, None)
    assert youtube.resolve_channel(f"https://www.youtube.com/channel/{uc}")[0] == uc
    page = f'<meta property="og:title" content="Jobs &amp; Careers"><script>{{"channelId":"{uc}"}}</script>'
    seen = {}
    monkeypatch.setattr(youtube, "_get", lambda url, **kw: seen.setdefault("url", url) and SimpleNamespace(text=page))
    assert youtube.resolve_channel("@jobs") == (uc, "Jobs & Careers")
    assert seen["url"] == "https://www.youtube.com/@jobs"
    monkeypatch.setattr(youtube, "_get", lambda url, **kw: SimpleNamespace(text="<html></html>"))
    with pytest.raises(youtube.ChannelNotFound):
        youtube.resolve_channel("@ghost")


# ---------------------------------------------------------------- telegram login (fake Telethon client)
class FakeClient:
    def __init__(self, session=""):
        self.session = SimpleNamespace(save=lambda: "SESSION123")
        self.needs_2fa = False

    async def connect(self): pass
    async def disconnect(self): pass
    async def is_user_authorized(self): return True

    async def send_code_request(self, phone):
        return SimpleNamespace(phone_code_hash="hash1")

    async def sign_in(self, phone=None, code=None, phone_code_hash=None, password=None):
        from telethon.errors import SessionPasswordNeededError

        if code == "00000":
            raise RuntimeError("The confirmation code is invalid")
        if code == "2fa" and password is None:
            raise SessionPasswordNeededError(None)

    async def iter_dialogs(self):
        for d in [
            SimpleNamespace(id=-100, name="Jobs", is_channel=True, is_group=False, entity=SimpleNamespace(username="jobs")),
            SimpleNamespace(id=-200, name="Private grp", is_channel=False, is_group=True, entity=SimpleNamespace()),
            SimpleNamespace(id=5, name="A friend", is_channel=False, is_group=False, entity=SimpleNamespace()),
        ]:
            yield d


def test_telegram_login_flow_and_chat_list(db, client, monkeypatch):
    monkeypatch.setattr(telegram_login, "_make_client", lambda api_id, api_hash, session="": FakeClient(session))
    assert client.post("/api/telegram/send-code", json={"phone": "+911234567890"}).status_code == 422  # no creds yet
    client.put("/api/settings", json={"values": {"telegram_api_id": "1", "telegram_api_hash": "h"}})
    assert client.get("/api/telegram/status").json() == {"has_credentials": True, "connected": False}
    assert client.get("/api/telegram/chats").status_code == 422  # not logged in

    assert client.post("/api/telegram/send-code", json={"phone": "+911234567890"}).status_code == 200
    bad = client.post("/api/telegram/sign-in", json={"code": "00000"})
    assert bad.status_code == 400 and "invalid" in bad.json()["detail"]
    need = client.post("/api/telegram/sign-in", json={"code": "2fa"}).json()
    assert need == {"connected": False, "needs_password": True}
    ok = client.post("/api/telegram/sign-in", json={"code": "2fa", "password": "pw"}).json()
    assert ok["connected"] is True
    assert runtime.effective_settings().telegram_session_string == "SESSION123"

    chats = client.get("/api/telegram/chats").json()
    assert [(c["identifier"], c["kind"]) for c in chats] == [("jobs", "channel"), ("-200", "group")]  # users excluded
    assert client.post("/api/telegram/sign-in", json={"code": "1"}).status_code == 400  # no login in progress


def test_youtube_falls_back_to_data_api(db, monkeypatch):
    import httpx

    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        if "feeds/videos.xml" in url:
            raise httpx.HTTPStatusError("404", request=httpx.Request("GET", url), response=httpx.Response(404))
        payload = {"items": [{"snippet": {"title": "Acme hiring", "description": "apply",
                                          "resourceId": {"videoId": "v1"}}}]}
        return SimpleNamespace(json=lambda: payload)

    monkeypatch.setattr(youtube, "_get", fake_get)
    src = Source(type="youtube", identifier="UC" + "c" * 22)
    with pytest.raises(RuntimeError, match="Data API key"):
        youtube.YouTubeCollector().collect(src, None)
    runtime.update(db, {"youtube_api_key": "k"})
    items = youtube.YouTubeCollector().collect(src, None)
    assert [i.external_id for i in items] == ["v1"] and "Acme hiring" in items[0].text
