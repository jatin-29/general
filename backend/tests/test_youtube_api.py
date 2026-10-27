from fastapi.testclient import TestClient

from app.collectors.base import RawItemData
from app.collectors.youtube import parse_feed
from app.main import app
from app.models import Opening, RawItem, Source
from app.pipeline import process_unprocessed, run_collection, save_raw_items

FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry><id>yt:video:abc123</id><yt:videoId>abc123</yt:videoId>
  <title>Acme hiring interns</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
  <media:group><media:description>Apply https://acme.com/jobs/1</media:description></media:group></entry>
 <entry><id>yt:video:def456</id><yt:videoId>def456</yt:videoId>
  <title>Cooking pasta</title><link rel="alternate" href="https://www.youtube.com/watch?v=def456"/>
  <media:group><media:description>yum</media:description></media:group></entry>
</feed>"""


def test_parse_feed():
    items = parse_feed(FEED)
    assert [i.external_id for i in items] == ["abc123", "def456"]
    assert "acme.com/jobs/1" in items[0].text and items[0].url.endswith("abc123")


def test_pipeline_end_to_end_and_dedupe(db, llm):
    items = parse_feed(FEED)
    assert len(save_raw_items(db, "youtube", "UC1", items)) == 2
    assert save_raw_items(db, "youtube", "UC1", items) == []  # idempotent
    assert process_unprocessed(db, llm) == 1
    assert db.query(RawItem).filter_by(processed=True).count() == 2
    # same opening posted again elsewhere -> deduped by normalized link
    save_raw_items(db, "telegram", "chan", [RawItemData("1", "Acme hiring again")])
    assert process_unprocessed(db, llm) == 0
    assert db.query(Opening).count() == 1


def test_run_collection_uses_registered_collector(db, llm, monkeypatch):
    from app.collectors import youtube

    monkeypatch.setattr(youtube, "_get", lambda *a, **k: type("R", (), {"content": FEED})())
    db.add(Source(type="youtube", identifier="UC1"))
    db.commit()
    stats = run_collection(db, llm)
    assert stats["new_items"] == 2 and stats["openings"] == 1 and stats["errors"] == 0
    assert db.query(Source).one().last_checked_at is not None


def test_api(db, llm):
    save_raw_items(db, "youtube", "UC1", parse_feed(FEED))
    process_unprocessed(db, llm)
    c = TestClient(app, headers={"X-API-Key": "test-key"})
    r = c.get("/api/openings", params={"search": "sde", "source": "youtube"}).json()
    assert r["total"] == 1
    oid = r["items"][0]["id"]
    assert c.get("/api/openings", params={"type": "contract"}).json()["total"] == 0
    d = c.get(f"/api/openings/{oid}").json()
    assert "Acme hiring" in d["raw_text"] and d["source_url"]
    assert c.patch(f"/api/openings/{oid}", json={"applied": True}).json()["applied"] is True
    assert c.get("/api/openings", params={"hide_applied": True}).json()["total"] == 0
    assert c.get("/api/openings/999").status_code == 404
    # sources
    body = {"type": "telegram", "identifier": "@jobs"}
    assert TestClient(app).post("/api/sources", json=body).status_code == 401  # API_KEY configured => key required
    s = c.post("/api/sources", json=body)
    assert s.status_code == 201 and s.json()["identifier"] == "jobs"
    assert c.post("/api/sources", json={"type": "telegram", "identifier": "jobs"}).status_code == 409
    assert c.post("/api/sources", json={"type": "bogus", "identifier": "x"}).status_code == 422
    assert c.patch(f"/api/sources/{s.json()['id']}", json={"enabled": False}).json()["enabled"] is False
    # scrape/now auth
    c.headers.pop("X-API-Key")
    assert c.post("/api/scrape/now").status_code == 401
