import logging
import threading

from apscheduler.schedulers.background import BackgroundScheduler

from .config import get_settings
from .db import SessionLocal
from .pipeline import expire_openings, run_collection

log = logging.getLogger("openingshub.scheduler")
_lock = threading.Lock()


def run_cycle() -> dict | None:
    """Single-flight collection cycle. Returns None if one is already running."""
    if not _lock.acquire(blocking=False):
        return None
    try:
        with SessionLocal() as db:
            stats = run_collection(db)
        log.info("cycle done: %s", stats)
        return stats
    except Exception:
        log.exception("collection cycle crashed")
        return {"new_items": 0, "openings": 0, "errors": 1}
    finally:
        _lock.release()


def run_expiry() -> None:
    with SessionLocal() as db:
        n = expire_openings(db)
    if n:
        log.info("expired %d openings", n)


def start_scheduler() -> BackgroundScheduler:
    s = BackgroundScheduler(job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60})
    s.add_job(run_cycle, "interval", minutes=get_settings().poll_interval_minutes, id="collect")
    s.add_job(run_expiry, "interval", hours=1, id="expiry")
    s.start()
    log.info("scheduler started (every %d min)", get_settings().poll_interval_minutes)
    return s
