import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .collectors import REGISTRY
from .collectors.whatsapp import group_name_from_filename, parse_chat, to_raw_items
from .config import get_settings
from .db import get_db, init_db
from .extractor import LLM, AnthropicLLM
from .pipeline import process_unprocessed, save_raw_items
from .models import Opening, Source
from .schemas import (
    OpeningDetail, OpeningList, OpeningOut, OpeningPatch, SourceCreate, SourceOut, SourcePatch,
    UploadResult,
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


def require_api_key(x_api_key: str = Header(default="")):
    key = get_settings().api_key
    if not key:
        raise HTTPException(503, "API_KEY is not configured; endpoint disabled")
    if not secrets.compare_digest(x_api_key, key):
        raise HTTPException(401, "Invalid API key")


@app.get("/api/health")
def health():
    return {"status": "ok"}


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


@app.get("/api/openings/{opening_id}", response_model=OpeningDetail)
def get_opening(opening_id: int, db: Session = Depends(get_db)):
    o = _get_opening(db, opening_id)
    data = OpeningOut.model_validate(o).model_dump()
    return OpeningDetail(**data, raw_text=o.raw_item.text, source_url=o.raw_item.url)


@app.patch("/api/openings/{opening_id}", response_model=OpeningOut)
def patch_opening(opening_id: int, body: OpeningPatch, db: Session = Depends(get_db)):
    o = _get_opening(db, opening_id)
    o.applied = body.applied
    db.commit()
    return o


@app.get("/api/sources", response_model=list[SourceOut])
def list_sources(db: Session = Depends(get_db)):
    return db.scalars(select(Source).order_by(Source.id)).all()


@app.post("/api/sources", response_model=SourceOut, status_code=201)
def create_source(body: SourceCreate, db: Session = Depends(get_db)):
    if body.type not in REGISTRY:
        raise HTTPException(422, f"Unknown source type; expected one of {sorted(REGISTRY)}")
    ident = body.identifier.strip()
    if body.type == "telegram":
        ident = ident.removeprefix("https://t.me/").removeprefix("@")
    if not ident:
        raise HTTPException(422, "identifier is required")
    if db.scalar(select(Source).where(Source.type == body.type, Source.identifier == ident)):
        raise HTTPException(409, "Source already exists")
    s = Source(type=body.type, identifier=ident)
    db.add(s)
    db.commit()
    return s


@app.patch("/api/sources/{source_id}", response_model=SourceOut)
def patch_source(source_id: int, body: SourcePatch, db: Session = Depends(get_db)):
    s = db.get(Source, source_id)
    if not s:
        raise HTTPException(404, "Source not found")
    s.enabled = body.enabled
    db.commit()
    return s


@app.post("/api/scrape/now", dependencies=[Depends(require_api_key)])
def scrape_now():
    from .scheduler import run_cycle

    stats = run_cycle()
    if stats is None:
        raise HTTPException(409, "A collection cycle is already running")
    return stats


MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def get_llm() -> LLM:
    if not get_settings().anthropic_api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")
    return AnthropicLLM()


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeError:
            continue
    return data.decode("latin-1")


@app.post("/api/upload/whatsapp", response_model=UploadResult)
def upload_whatsapp(
    file: UploadFile = File(...),
    group_name: str | None = Form(None),
    db: Session = Depends(get_db),
    llm: LLM = Depends(get_llm),
):
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 20 MB)")
    if not (file.filename or "").lower().endswith(".txt"):
        raise HTTPException(422, "Upload the exported chat as a .txt file")
    messages = parse_chat(_decode(data))
    if not messages:
        raise HTTPException(422, "No messages found. Expected lines like 'DD/MM/YY, HH:MM - Sender: message'")
    group = (group_name or "").strip() or group_name_from_filename(file.filename)

    new_rows = save_raw_items(db, "whatsapp", group, to_raw_items(group, messages))
    if not db.scalar(select(Source).where(Source.type == "whatsapp", Source.identifier == group)):
        db.add(Source(type="whatsapp", identifier=group))
        db.commit()
    ids = [r.id for r in new_rows]
    found = 0
    for i in range(0, len(ids), 500):
        found += process_unprocessed(db, llm, only_ids=ids[i : i + 500])
    return UploadResult(source_name=group, parsed_messages=len(messages), new_items=len(new_rows), openings_found=found)
