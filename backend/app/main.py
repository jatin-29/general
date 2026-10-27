import logging
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import runtime, telegram_login
from .collectors import REGISTRY
from .collectors.youtube import ChannelNotFound, resolve_channel
from .config import get_settings
from .db import get_db, init_db
from .dedupe import find_duplicate, make_dedupe_key
from .extractor import LLM, AnthropicLLM, extract_batch
from .models import Opening, RawItem, Source
from .schemas import (
    ExtractionOut, ExtractRequest, OpeningCreate, OpeningDetail, OpeningList, OpeningOut,
    OpeningPatch, PhoneBody, SettingOut, SettingsUpdate, SignInBody, SourceCreate, SourceOut,
    SourcePatch, TelegramChat,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("openingshub")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    scheduler = None
    if get_settings().scheduler_enabled:
        from .scheduler import start_scheduler

        scheduler = start_scheduler()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title="OpeningsHub", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().frontend_origin.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------- auth
def require_api_key(x_api_key: str = Header(default="")):
    """Strict: endpoints that expose or change secrets, or spend money. Disabled until API_KEY is set."""
    key = get_settings().api_key
    if not key:
        raise HTTPException(503, "API_KEY is not configured on the server; endpoint disabled")
    if not secrets.compare_digest(x_api_key, key):
        raise HTTPException(401, "Invalid or missing API key. Enter it in Settings.")


def require_key_if_configured(x_api_key: str = Header(default="")):
    """Other writes: open for local dev (no API_KEY set), locked once API_KEY is configured."""
    key = get_settings().api_key
    if key and not secrets.compare_digest(x_api_key, key):
        raise HTTPException(401, "Invalid or missing API key. Enter it in Settings.")


def get_llm() -> LLM:
    if not runtime.effective_settings().anthropic_api_key:
        raise HTTPException(503, "Anthropic API key is not set. Add it in Settings.")
    return AnthropicLLM()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------- openings
@app.get("/api/openings", response_model=OpeningList)
def list_openings(
    source: str | None = None,
    type: str | None = None,
    location: str | None = None,
    search: str | None = None,
    active_only: bool = True,
    hide_applied: bool = False,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = select(Opening)
    if source:
        q = q.where(or_(Opening.source_type == source, Opening.source_name == source))
    if type:
        q = q.where(Opening.employment_type == type)
    if location:
        q = q.where(Opening.location.ilike(f"%{location}%"))
    if search:
        like = f"%{search}%"
        q = q.where(or_(Opening.company.ilike(like), Opening.role.ilike(like), Opening.eligibility.ilike(like)))
    if active_only:
        q = q.where(Opening.is_expired.is_(False))
    if hide_applied:
        q = q.where(Opening.applied.is_(False))
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(
        q.order_by(Opening.created_at.desc(), Opening.id.desc()).offset((page - 1) * limit).limit(limit)
    ).all()
    return OpeningList(items=rows, total=total, page=page, limit=limit)


def _get_opening(db: Session, opening_id: int) -> Opening:
    o = db.get(Opening, opening_id)
    if not o:
        raise HTTPException(404, "Opening not found")
    return o


@app.post("/api/openings", response_model=OpeningOut, status_code=201, dependencies=[Depends(require_key_if_configured)])
def create_opening(body: OpeningCreate, db: Session = Depends(get_db)):
    """Manually add an opening."""
    link = (body.apply_link or "").strip() or None
    key = make_dedupe_key(link, body.company, body.role)
    if find_duplicate(db, key):
        raise HTTPException(409, "This opening is already in the list")
    text = (body.notes or "").strip() or f"{body.role} at {body.company}" + (f"\nApply: {link}" if link else "")
    raw = RawItem(
        source_type="manual", source_name="manual", external_id=uuid.uuid4().hex,
        text=text, processed=True,
    )
    db.add(raw)
    db.flush()
    o = Opening(
        company=body.company.strip(), role=body.role.strip(), location=(body.location or "").strip() or None,
        employment_type=body.employment_type, eligibility=(body.eligibility or "").strip() or None,
        deadline=body.deadline, apply_link=link, source_type="manual", source_name="manual",
        raw_item_id=raw.id, dedupe_key=key, is_expired=bool(body.deadline and body.deadline < date.today()),
    )
    try:
        db.add(o)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This opening is already in the list")
    return o


@app.post("/api/extract", response_model=ExtractionOut, dependencies=[Depends(require_api_key)])
def extract_preview(body: ExtractRequest, llm: LLM = Depends(get_llm)):
    """Paste a post, get the fields pre-filled for the manual-add form (nothing is saved)."""
    result = extract_batch(llm, {0: body.text}).get(0)
    if result is None:
        raise HTTPException(502, "Could not read that post. Fill the form manually.")
    return result


@app.get("/api/openings/{opening_id}", response_model=OpeningDetail)
def get_opening(opening_id: int, db: Session = Depends(get_db)):
    o = _get_opening(db, opening_id)
    data = OpeningOut.model_validate(o).model_dump()
    return OpeningDetail(**data, raw_text=o.raw_item.text, source_url=o.raw_item.url)


@app.patch("/api/openings/{opening_id}", response_model=OpeningOut, dependencies=[Depends(require_key_if_configured)])
def patch_opening(opening_id: int, body: OpeningPatch, db: Session = Depends(get_db)):
    o = _get_opening(db, opening_id)
    o.applied = body.applied
    db.commit()
    return o


@app.delete("/api/openings/{opening_id}", status_code=204, dependencies=[Depends(require_key_if_configured)])
def delete_opening(opening_id: int, db: Session = Depends(get_db)):
    db.delete(_get_opening(db, opening_id))
    db.commit()


# ---------------------------------------------------------------- sources
@app.get("/api/sources", response_model=list[SourceOut])
def list_sources(db: Session = Depends(get_db)):
    return db.scalars(select(Source).order_by(Source.id)).all()


@app.post("/api/sources", response_model=SourceOut, status_code=201, dependencies=[Depends(require_key_if_configured)])
def create_source(body: SourceCreate, db: Session = Depends(get_db)):
    if body.type not in REGISTRY:
        raise HTTPException(422, f"Unknown source type; expected one of {sorted(REGISTRY)}")
    ident = body.identifier.strip()
    name = (body.name or "").strip() or None
    if body.type == "telegram":
        ident = ident.removeprefix("https://t.me/").removeprefix("@")
    elif body.type == "youtube":
        try:
            ident, title = resolve_channel(ident)
        except ChannelNotFound:
            raise HTTPException(422, "Could not find that YouTube channel. Paste its URL, @handle or channel id (UC…).")
        name = name or title
    if not ident:
        raise HTTPException(422, "identifier is required")
    if db.scalar(select(Source).where(Source.type == body.type, Source.identifier == ident)):
        raise HTTPException(409, "Source already exists")
    s = Source(type=body.type, identifier=ident, name=name)
    db.add(s)
    db.commit()
    return s


def _get_source(db: Session, source_id: int) -> Source:
    s = db.get(Source, source_id)
    if not s:
        raise HTTPException(404, "Source not found")
    return s


@app.patch("/api/sources/{source_id}", response_model=SourceOut, dependencies=[Depends(require_key_if_configured)])
def patch_source(source_id: int, body: SourcePatch, db: Session = Depends(get_db)):
    s = _get_source(db, source_id)
    s.enabled = body.enabled
    db.commit()
    return s


@app.delete("/api/sources/{source_id}", status_code=204, dependencies=[Depends(require_key_if_configured)])
def delete_source(source_id: int, db: Session = Depends(get_db)):
    db.delete(_get_source(db, source_id))
    db.commit()


# ---------------------------------------------------------------- settings (edited from the website)
@app.get("/api/settings", response_model=list[SettingOut], dependencies=[Depends(require_api_key)])
def get_app_settings(db: Session = Depends(get_db)):
    return runtime.describe(db)


@app.put("/api/settings", response_model=list[SettingOut], dependencies=[Depends(require_api_key)])
def put_app_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    unknown = set(body.values) - set(runtime.EDITABLE)
    if unknown:
        raise HTTPException(422, f"Unknown setting(s): {', '.join(sorted(unknown))}")
    api_id = body.values.get("telegram_api_id", "").strip()
    if api_id and not api_id.isdigit():
        raise HTTPException(422, "Telegram API ID must be a number")
    runtime.update(db, body.values)
    return runtime.describe(db)


# ---------------------------------------------------------------- Telegram login + chat picker
def _tg_creds():
    s = runtime.effective_settings()
    if not (s.telegram_api_id and s.telegram_api_hash):
        raise HTTPException(422, "Save your Telegram API ID and API hash first (from my.telegram.org).")
    return s


@app.get("/api/telegram/status", dependencies=[Depends(require_api_key)])
def telegram_status():
    s = runtime.effective_settings()
    return {
        "has_credentials": bool(s.telegram_api_id and s.telegram_api_hash),
        "connected": bool(s.telegram_session_string),
    }


@app.post("/api/telegram/send-code", dependencies=[Depends(require_api_key)])
def telegram_send_code(body: PhoneBody):
    s = _tg_creds()
    try:
        telegram_login.send_code(body.phone.strip(), s.telegram_api_id, s.telegram_api_hash)
    except telegram_login.LoginError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.post("/api/telegram/sign-in", dependencies=[Depends(require_api_key)])
def telegram_sign_in(body: SignInBody, db: Session = Depends(get_db)):
    try:
        result = telegram_login.sign_in(body.code.strip(), body.password)
    except telegram_login.LoginError as e:
        raise HTTPException(400, str(e))
    if result.get("needs_password"):
        return {"connected": False, "needs_password": True}
    runtime.update(db, {"telegram_session_string": result["session"]})
    return {"connected": True, "needs_password": False}


@app.get("/api/telegram/chats", response_model=list[TelegramChat], dependencies=[Depends(require_api_key)])
def telegram_chats():
    s = _tg_creds()
    if not s.telegram_session_string:
        raise HTTPException(422, "Log in to Telegram first (Settings).")
    try:
        return telegram_login.list_chats(s.telegram_api_id, s.telegram_api_hash, s.telegram_session_string)
    except telegram_login.LoginError as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------- manual trigger
@app.post("/api/scrape/now", dependencies=[Depends(require_api_key)])
def scrape_now():
    from .scheduler import run_cycle

    stats = run_cycle()
    if stats is None:
        raise HTTPException(409, "A collection cycle is already running")
    return stats
