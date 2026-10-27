from datetime import date, timedelta

from app.models import Opening, RawItem
from app.pipeline import expire_openings
from app.scheduler import run_cycle, start_scheduler


def _opening(db, key, deadline):
    r = RawItem(source_type="telegram", source_name="c", external_id=key, text="t")
    db.add(r)
    db.flush()
    db.add(Opening(company="A", role="R", source_type="telegram", source_name="c",
                   raw_item_id=r.id, dedupe_key=key, deadline=deadline))


def test_expiry_marks_only_past_deadlines(db):
    today = date.today()
    _opening(db, "past", today - timedelta(days=1))
    _opening(db, "today", today)
    _opening(db, "none", None)
    db.commit()
    assert expire_openings(db) == 1
    flags = {o.dedupe_key: o.is_expired for o in db.query(Opening)}
    assert flags == {"past": True, "today": False, "none": False}


def test_expired_on_creation(db, llm):
    from app.collectors.base import RawItemData
    from app.pipeline import process_unprocessed, save_raw_items

    import json
    orig = llm.complete
    llm.complete = lambda s, u: orig(s, u).replace("2099-01-01", "2020-01-01")
    save_raw_items(db, "telegram", "c", [RawItemData("1", "hiring now")])
    process_unprocessed(db, llm)
    assert db.query(Opening).one().is_expired is True


def test_scheduler_registers_jobs():
    s = start_scheduler()
    try:
        assert {j.id for j in s.get_jobs()} == {"collect", "expiry"}
    finally:
        s.shutdown(wait=False)


def test_run_cycle_is_single_flight(db):
    from app import scheduler

    scheduler._lock.acquire()
    try:
        assert run_cycle() is None
    finally:
        scheduler._lock.release()
    assert run_cycle() == {"new_items": 0, "openings": 0, "errors": 0}


def test_retry_backoff_and_no_retry_on_4xx(monkeypatch):
    import httpx

    from app.utils import retry

    monkeypatch.setattr("time.sleep", lambda s: None)
    calls = {"n": 0}

    @retry(attempts=3, exceptions=(RuntimeError,))
    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("boom")
        return "ok"

    assert flaky() == "ok" and calls["n"] == 3

    resp = httpx.Response(404, request=httpx.Request("GET", "http://x"))
    calls["n"] = 0

    @retry(attempts=3, exceptions=(httpx.HTTPError,))
    def notfound():
        calls["n"] += 1
        resp.raise_for_status()

    try:
        notfound()
    except httpx.HTTPStatusError:
        pass
    assert calls["n"] == 1
