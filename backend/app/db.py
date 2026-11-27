"""Database models and session handling (SQLAlchemy 2.x ORM).

SQLite by default (self-hosted / desktop / tests). In production the database is Supabase Postgres,
reached through the pure-Python ``pg8000`` driver; every Folio table then lives in the dedicated
``folio`` schema, which Supabase's Data API does not expose.
"""

from __future__ import annotations

import importlib.util
import logging
import os
import ssl
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


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
    Uuid,
    create_engine,
    text,
)
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker  # noqa: E402

from .config import settings  # noqa: E402

log = logging.getLogger("folio.db")

#: Postgres schema that holds every Folio table (not exposed through Supabase's Data API).
PG_SCHEMA = "folio"


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


def valid_uuid(value: object) -> str | None:
    """``value`` as a canonical uuid string, or None (user ids from webhooks are untrusted)."""
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    """Local mirror of a Supabase Auth user (``id`` is the Supabase uid, the JWT ``sub``)."""

    __tablename__ = "users"

    # Native uuid on Postgres (so it can reference auth.users), CHAR(32) on SQLite; always a str here.
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

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
    user_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), index=True)
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

_PG_SCHEMES = ("postgres://", "postgresql://", "postgresql+psycopg://", "postgresql+psycopg2://")
_SSLMODES_VERIFY = ("verify-ca", "verify-full")


def normalize_database_url(url: str) -> str:
    """Rewrite a pasted ``postgres://`` / ``postgresql://`` URI to ``postgresql+pg8000://``."""
    url = url.strip()
    for scheme in _PG_SCHEMES:
        if url.startswith(scheme):
            return "postgresql+pg8000://" + url[len(scheme) :]
    return url


def is_postgres(url: str) -> bool:
    return url.startswith("postgresql")


def schema_for(url: str) -> str | None:
    """Schema that holds the Folio tables for ``url``: ``folio`` on Postgres, none on SQLite."""
    return PG_SCHEMA if is_postgres(url) else None


def _postgres_ssl(url: str, root_cert: str = "") -> tuple[str, ssl.SSLContext | None]:
    """Strip libpq-only query params (pg8000 rejects them) and build the TLS context.

    ``sslmode=disable`` turns TLS off (local Postgres). Otherwise TLS is always on: with a CA file
    (``FOLIO_DATABASE_SSL_ROOT_CERT`` or ``sslrootcert=``) the certificate is verified, else the
    connection is encrypted without verification, which is what libpq's ``sslmode=require`` does.
    """
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    mode = query.pop("sslmode", "require")
    root_cert = query.pop("sslrootcert", "") or root_cert
    for k in ("sslcert", "sslkey", "pgbouncer", "connect_timeout"):
        query.pop(k, None)
    clean = urlunsplit(parts._replace(query=urlencode(query)))
    if mode == "disable":
        return clean, None
    if root_cert:
        ctx = ssl.create_default_context(cafile=root_cert)
        ctx.check_hostname = mode != "verify-ca"
        return clean, ctx
    if mode in _SSLMODES_VERIFY:
        return clean, ssl.create_default_context()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    log.warning(
        "Postgres TLS is encrypted but the server certificate is not verified. Set FOLIO_DATABASE_SSL_ROOT_CERT "
        "to the Supabase CA certificate to verify it."
    )
    return clean, ctx


def engine_args(url: str | None = None) -> tuple[str, dict]:
    """Final URL and ``create_engine`` kwargs for ``url`` (default from settings)."""
    url = normalize_database_url(url or settings.resolved_database_url())
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    elif is_postgres(url):
        url, ctx = _postgres_ssl(url, settings.database_ssl_root_cert)
        kwargs["connect_args"] = {"ssl_context": ctx} if ctx is not None else {}
        kwargs["pool_recycle"] = 300
        schema = schema_for(url)
        # Every unqualified Folio table (and FK) is rendered as folio.<table>.
        kwargs["execution_options"] = {"schema_translate_map": {None: schema}}
    return url, kwargs


def init_db(url: str | None = None) -> Engine:
    """(Re)create the engine for ``url`` (default from settings) and create missing tables."""
    global _engine, _Session
    url, kwargs = engine_args(url)
    if _engine is not None:
        _engine.dispose()
    _engine = create_engine(url, **kwargs)
    _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    schema = schema_for(url)
    if schema:
        with _engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    else:
        _retire_legacy_sqlite_accounts(_engine)
    Base.metadata.create_all(_engine)
    if schema:
        _harden_postgres_schema(_engine, schema)
    return _engine


# Mirrors supabase/migrations/*_folio_schema.sql for databases created by create_all: RLS on with no
# policies, no privileges for Supabase's API roles, and users.id tied to auth.users. Each statement
# is best effort (plain Postgres has no auth schema or anon role).
_HARDEN_SQL = [
    *(f"ALTER TABLE {{s}}.{t} ENABLE ROW LEVEL SECURITY" for t in ("users", "api_keys", "usage", "webhook_events")),
    "REVOKE ALL ON SCHEMA {s} FROM anon, authenticated",
    "REVOKE ALL ON ALL TABLES IN SCHEMA {s} FROM anon, authenticated",
    "REVOKE ALL ON ALL SEQUENCES IN SCHEMA {s} FROM anon, authenticated",
    """DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = '{s}.users'::regclass AND confrelid = 'auth.users'::regclass) THEN
           ALTER TABLE {s}.users ADD CONSTRAINT users_id_auth_fkey
             FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE NOT VALID;
         END IF;
       END $$""",
]


def _harden_postgres_schema(engine: Engine, schema: str) -> None:
    for stmt in _HARDEN_SQL:
        try:
            with engine.begin() as conn:
                conn.execute(text(stmt.format(s=f'"{schema}"')))
        except Exception as e:  # noqa: BLE001 - optional hardening must never block startup
            log.info("Schema hardening step skipped (%s): %s", stmt.split()[0:3], str(e).splitlines()[0])


def _retire_legacy_sqlite_accounts(engine: Engine) -> None:
    """Move tables from the pre-Supabase password accounts aside (``*_legacy``) instead of failing.

    Those users had local uuids and password hashes; with Supabase Auth they must sign up again.
    """
    with engine.begin() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(users)"))]
        if "password_hash" not in cols:
            return
        for table in ("api_keys", "users"):
            exists = conn.execute(text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:n"), {"n": table})
            if exists.first():
                conn.execute(text(f"DROP TABLE IF EXISTS {table}_legacy"))
                conn.execute(text(f"ALTER TABLE {table} RENAME TO {table}_legacy"))
        # Indexes keep their names after a rename; drop them so create_all can recreate them.
        for (name,) in conn.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name IN ('users_legacy','api_keys_legacy') AND sql IS NOT NULL"
            )
        ).all():
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
    log.warning(
        "Moved the old password-based account tables to users_legacy / api_keys_legacy "
        "(accounts now use Supabase Auth)."
    )


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
