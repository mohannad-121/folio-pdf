"""Database models and session handling (SQLAlchemy 2.x ORM; SQLite by default, Postgres in prod)."""

from __future__ import annotations

import importlib.util
import os
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime


def _import_sqlalchemy() -> None:
    """Import SQLAlchemy, falling back to its pure-Python modules if a native ``*_cy`` DLL is blocked.

    SQLAlchemy 2.1 ships Cython modules next to their pure-Python ``.py`` sources. Windows
    Application Control policies sometimes refuse to load the ``.pyd`` files; in that case we
    retry with a finder that loads the ``.py`` sources instead.
    """
    force_pure = os.environ.get("FOLIO_SQLALCHEMY_PURE") == "1"
    if not force_pure:
        try:
            import sqlalchemy.orm  # noqa: F401

            return
        except ImportError as e:
            if "DLL" not in str(e) and "_cy" not in str(e):
                raise
        for name in [m for m in sys.modules if m == "sqlalchemy" or m.startswith("sqlalchemy.")]:
            del sys.modules[name]

    class _PureFinder:
        def find_spec(self, fullname, path, target=None):  # noqa: ANN001
            leaf = fullname.rsplit(".", 1)[-1]
            if not fullname.startswith("sqlalchemy.") or not leaf.endswith("_cy"):
                return None
            for p in path or []:
                candidate = os.path.join(p, leaf + ".py")
                if os.path.isfile(candidate):
                    return importlib.util.spec_from_file_location(fullname, candidate)
            return None

    sys.meta_path.insert(0, _PureFinder())
    import sqlalchemy.orm  # noqa: F401


_import_sqlalchemy()

from sqlalchemy import (  # noqa: E402
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker  # noqa: E402

from .config import settings  # noqa: E402


def utcnow() -> datetime:
    """Naive UTC now (SQLite drops tz info, so we store naive UTC everywhere)."""
    return datetime.now(UTC).replace(tzinfo=None)


def to_naive_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    dt = to_naive_utc(dt)
    return dt.isoformat(timespec="seconds") + "Z"


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    plan: Mapped[str] = mapped_column(String(16), default="free")
    plan_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    plan_interval: Mapped[str | None] = mapped_column(String(16), nullable=True)
    paddle_customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    paddle_subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    subscription_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    trial_used: Mapped[bool] = mapped_column(Boolean, default=False)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    prefix: Mapped[str] = mapped_column(String(32))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Usage(Base):
    __tablename__ = "usage"
    __table_args__ = (UniqueConstraint("subject", "day", name="uq_usage_subject_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject: Mapped[str] = mapped_column(String(80), index=True)  # user id or "ip:x.x.x.x"
    day: Mapped[date] = mapped_column(Date)
    count: Mapped[int] = mapped_column(Integer, default=0)


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    type: Mapped[str] = mapped_column(String(80))
    received_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---- engine / sessions ---------------------------------------------------------------------

_engine: Engine | None = None
_Session: sessionmaker[Session] | None = None


def init_db(url: str | None = None) -> Engine:
    """(Re)create the engine for ``url`` (default from settings) and create missing tables."""
    global _engine, _Session
    url = url or settings.resolved_database_url()
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    if _engine is not None:
        _engine.dispose()
    _engine = create_engine(url, **kwargs)
    _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    Base.metadata.create_all(_engine)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        init_db()
    assert _engine is not None
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional session: commits on success, rolls back on error."""
    if _Session is None:
        init_db()
    assert _Session is not None
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    with session_scope() as s:
        yield s
