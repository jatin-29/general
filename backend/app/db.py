from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings

_url = get_settings().database_url
if _url.startswith("postgres://"):  # Render/Heroku style
    _url = "postgresql+psycopg://" + _url.removeprefix("postgres://")
elif _url.startswith("postgresql://"):
    _url = "postgresql+psycopg://" + _url.removeprefix("postgresql://")
_kwargs: dict = {}
if _url.startswith("sqlite"):
    _kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    if _url in ("sqlite://", "sqlite:///:memory:"):
        _kwargs["poolclass"] = StaticPool

engine = create_engine(_url, **_kwargs)

if _url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)

    Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
