"""Database URL handling: Supabase URI rewriting, TLS and the ``folio`` schema (no real Postgres needed)."""

from __future__ import annotations

import ssl

import pytest

from app import db


@pytest.mark.parametrize(
    "raw",
    [
        "postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        "postgres://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        "postgresql+psycopg://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        "  postgresql+pg8000://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres ",
    ],
)
def test_postgres_urls_use_pg8000(raw):
    url = db.normalize_database_url(raw)
    assert url == "postgresql+pg8000://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
    assert db.schema_for(url) == "folio"


def test_sqlite_keeps_no_schema():
    url = db.normalize_database_url("sqlite:///tmp/folio.db")
    assert url == "sqlite:///tmp/folio.db" and db.schema_for(url) is None
    final, kwargs = db.engine_args(url)
    assert final == url and "execution_options" not in kwargs
    assert kwargs["connect_args"]["check_same_thread"] is False


def test_engine_args_postgres_tls_and_schema():
    url, kwargs = db.engine_args("postgresql://u:p@h.pooler.supabase.com:5432/postgres?sslmode=require")
    assert url == "postgresql+pg8000://u:p@h.pooler.supabase.com:5432/postgres"  # libpq param stripped
    ctx = kwargs["connect_args"]["ssl_context"]
    assert isinstance(ctx, ssl.SSLContext)
    assert kwargs["execution_options"] == {"schema_translate_map": {None: "folio"}}


def test_engine_args_verify_and_disable():
    _, kwargs = db.engine_args("postgresql://u:p@h:5432/postgres?sslmode=verify-full")
    ctx = kwargs["connect_args"]["ssl_context"]
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname
    _, kwargs = db.engine_args("postgresql://u:p@localhost:5432/postgres?sslmode=disable")
    assert kwargs["connect_args"] == {}


def test_tables_render_in_folio_schema():
    """With the translate map, DDL and queries target folio.<table> on the postgres dialect."""
    from sqlalchemy import create_engine, select
    from sqlalchemy.schema import CreateTable

    url, kwargs = db.engine_args("postgresql://u:p@h:5432/postgres")
    engine = create_engine(url, **kwargs)
    tmap = engine.get_execution_options()["schema_translate_map"]
    assert tmap == {None: "folio"}
    opts = {"dialect": engine.dialect, "schema_translate_map": tmap, "render_schema_translate": True}
    assert "FROM folio.users" in str(select(db.User.id).compile(**opts))
    ddl = str(CreateTable(db.ApiKey.__table__).compile(**opts))
    assert "CREATE TABLE folio.api_keys" in ddl and "REFERENCES folio.users" in ddl
    engine.dispose()


def test_legacy_sqlite_accounts_are_moved_aside(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, password_hash TEXT NOT NULL)")
    con.execute("CREATE UNIQUE INDEX ix_users_email ON users(email)")
    con.execute("INSERT INTO users VALUES ('u1', 'a@b.c', 'scrypt$x')")
    con.commit()
    con.close()
    try:
        db.init_db(f"sqlite:///{path.as_posix()}")
        with db.session_scope() as s:
            s.add(db.User(id="00000000-0000-0000-0000-000000000001", email="a@b.c"))
        con = sqlite3.connect(path)
        assert con.execute("SELECT count(*) FROM users_legacy").fetchone() == (1,)
        assert con.execute("SELECT count(*) FROM users").fetchone() == (1,)
        con.close()
    finally:
        db.init_db()
