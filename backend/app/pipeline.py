import logging
from datetime import date

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .collectors import REGISTRY
from .collectors.base import RawItemData
from .dedupe import find_duplicate, make_dedupe_key
from .config import get_settings
from .extractor import LLM, AnthropicLLM, extract_batch
from .models import Opening, RawItem, Source, utcnow
from .notifier import notify_opening

log = logging.getLogger("openingshub.pipeline")
MAX_ATTEMPTS = 3


def save_raw_items(db: Session, source_type: str, default_name: str, items: list[RawItemData]) -> list[RawItem]:
    """Insert items not yet stored (unique per source). Returns the new rows."""
    if not items:
        return []
    names = {i.source_name or default_name for i in items}
    existing = set(
        db.execute(
            select(RawItem.source_name, RawItem.external_id).where(
                RawItem.source_type == source_type, RawItem.source_name.in_(names)
            )
        ).all()
    )
    new, seen = [], set()
    for it in items:
        name = it.source_name or default_name
        key = (name, it.external_id)
        if key in existing or key in seen or not it.text.strip():
            continue
        seen.add(key)
        row = RawItem(
            source_type=source_type, source_name=name, external_id=it.external_id,
            text=it.text, url=it.url,
        )
        db.add(row)
        new.append(row)
    db.commit()
    return new


def process_unprocessed(db: Session, llm: LLM | None = None, only_ids: list[int] | None = None) -> int:
    """Run extraction over unprocessed RawItems. Returns number of Openings created."""
    q = select(RawItem).where(RawItem.processed.is_(False), RawItem.attempts < MAX_ATTEMPTS)
    if only_ids is not None:
        q = q.where(RawItem.id.in_(only_ids))
    rows = list(db.scalars(q.order_by(RawItem.id).limit(500)))
    if not rows:
        return 0
    llm = llm or AnthropicLLM()
    results = extract_batch(llm, {r.id: r.text for r in rows})

    created: list[Opening] = []
    for row in rows:
        ext = results.get(row.id)
        if ext is None:
            row.attempts += 1  # LLM output unusable; retry on a later run (max 3)
            continue
        row.processed = True
        if not (ext.is_opening and ext.company and ext.role):
            continue
        key = make_dedupe_key(ext.apply_link, ext.company, ext.role)
        if find_duplicate(db, key):
            continue
        opening = Opening(
            company=ext.company, role=ext.role, location=ext.location,
            employment_type=ext.employment_type, eligibility=ext.eligibility,
            deadline=ext.deadline, apply_link=ext.apply_link,
            source_type=row.source_type, source_name=row.source_name,
            raw_item_id=row.id, dedupe_key=key,
            is_expired=bool(ext.deadline and ext.deadline < date.today()),
        )
        try:
            with db.begin_nested():
                db.add(opening)
            created.append(opening)
        except IntegrityError:
            log.info("duplicate opening skipped: %s", key)
    db.commit()
    for o in created:
        if not o.is_expired:
            notify_opening(o)
    return len(created)


def collect_source(db: Session, source: Source) -> int:
    cls = REGISTRY.get(source.type)
    if cls is None or not cls.polled:
        return 0
    last = db.scalar(
        select(RawItem.external_id)
        .where(RawItem.source_type == source.type, RawItem.source_name == source.identifier)
        .order_by(func.length(RawItem.external_id).desc(), RawItem.external_id.desc())
        .limit(1)
    )
    items = cls().collect(source, last)
    new = save_raw_items(db, source.type, source.identifier, items)
    source.last_checked_at = utcnow()
    db.commit()
    return len(new)


def run_collection(db: Session, llm: LLM | None = None) -> dict:
    """One full cycle: collect from every enabled polled source, then extract."""
    stats = {"new_items": 0, "openings": 0, "errors": 0}
    for source in db.scalars(select(Source).where(Source.enabled.is_(True))).all():
        try:
            stats["new_items"] += collect_source(db, source)
        except Exception:
            db.rollback()
            stats["errors"] += 1
            log.exception("collector failed for %s:%s", source.type, source.identifier)
    if llm is None and not get_settings().anthropic_api_key:
        log.warning("ANTHROPIC_API_KEY not set; items stored but extraction skipped")
        expire_openings(db)
        return stats
    try:
        stats["openings"] = process_unprocessed(db, llm)
    except Exception:
        db.rollback()
        stats["errors"] += 1
        log.exception("extraction failed")
    expire_openings(db)
    return stats


def expire_openings(db: Session) -> int:
    res = db.execute(
        update(Opening)
        .where(Opening.is_expired.is_(False), Opening.deadline.is_not(None), Opening.deadline < date.today())
        .values(is_expired=True)
    )
    db.commit()
    return res.rowcount or 0
