from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

from .conftest import signup


def test_signup_me_logout_login_flow(bclient):
    me = signup(bclient, "Ada@Example.com")
    assert me["user"]["email"] == "ada@example.com"
    assert me["user"]["name"] == "Ada"
    assert me["plan"] == "free" and me["billing_enabled"] is True
    assert me["limits"]["max_file_mb"] == 10
    assert me["usage"] == {"today": 0, "daily_limit": 5}
    assert "folio_session" in bclient.cookies

    r = bclient.get("/api/auth/me")
    assert r.status_code == 200 and r.json()["user"]["email"] == "ada@example.com"

    r = bclient.post("/api/auth/logout")
    assert r.status_code == 204
    assert "folio_session" not in bclient.cookies
    assert bclient.get("/api/auth/me").json()["user"] is None

    r = bclient.post("/api/auth/login", json={"email": "ADA@example.com", "password": "correct horse"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "ada@example.com"
    assert bclient.get("/api/auth/me").json()["user"] is not None


def test_cookie_attributes(bclient):
    r = bclient.post("/api/auth/signup", json={"email": "c@example.com", "password": "password1"})
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("folio_session=")
    assert "HttpOnly" in cookie and "samesite=lax" in cookie.lower() and "Path=/" in cookie
    assert "Secure" not in cookie


def test_wrong_password_and_unknown_email(bclient):
    signup(bclient)
    r = bclient.post("/api/auth/login", json={"email": "ada@example.com", "password": "nope nope"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "invalid_credentials"
    r = bclient.post("/api/auth/login", json={"email": "ghost@example.com", "password": "whatever1"})
    assert r.status_code == 401


def test_duplicate_signup_409_and_validation(bclient):
    signup(bclient)
    r = bclient.post("/api/auth/signup", json={"email": "ADA@example.com", "password": "another pw"})
    assert r.status_code == 409
    assert bclient.post("/api/auth/signup", json={"email": "not-an-email", "password": "longenough"}).status_code == 422
    assert bclient.post("/api/auth/signup", json={"email": "x@example.com", "password": "short"}).status_code == 422


def test_login_rate_limit(bclient):
    signup(bclient)
    bad = {"email": "ada@example.com", "password": "bad pass"}
    for _ in range(10):
        assert bclient.post("/api/auth/login", json=bad).status_code == 401
    r = bclient.post("/api/auth/login", json={"email": "ada@example.com", "password": "correct horse"})
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "too_many_attempts"


def test_tampered_cookie_is_anonymous(bclient):
    signup(bclient)
    token = bclient.cookies.get("folio_session")
    body, sig = token.split(".")
    bclient.cookies.clear()
    bclient.cookies.set("folio_session", body + "." + ("A" * len(sig)))
    assert bclient.get("/api/auth/me").json()["user"] is None


def test_account_update_password_and_delete(bclient):
    signup(bclient)
    r = bclient.patch("/api/account", json={"name": "Countess"})
    assert r.status_code == 200 and r.json()["user"]["name"] == "Countess"

    old_cookie = bclient.cookies.get("folio_session")
    r = bclient.post("/api/account/password", json={"current_password": "wrong one", "new_password": "newpassword"})
    assert r.status_code == 401
    r = bclient.post("/api/account/password", json={"current_password": "correct horse", "new_password": "newpassword"})
    assert r.status_code == 200
    # Older session tokens are invalidated; this browser got a fresh cookie.
    with TestClient(app) as other:
        other.cookies.set("folio_session", old_cookie)
        assert other.get("/api/auth/me").json()["user"] is None
    assert bclient.get("/api/auth/me").json()["user"] is not None

    r = bclient.request("DELETE", "/api/account", json={"password": "correct horse"})
    assert r.status_code == 401
    r = bclient.request("DELETE", "/api/account", json={"password": "newpassword"})
    assert r.status_code == 204
    r = bclient.post("/api/auth/login", json={"email": "ada@example.com", "password": "newpassword"})
    assert r.status_code == 401


def test_account_requires_login(bclient):
    r = bclient.patch("/api/account", json={"name": "x"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "login_required"


def test_me_anonymous_billing_disabled(client):
    from app.config import settings

    assert settings.billing_enabled is False
    me = client.get("/api/auth/me").json()
    assert me["user"] is None and me["plan"] == "max" and me["billing_enabled"] is False
    assert me["usage"]["daily_limit"] is None


def test_password_hash_format():
    from app.auth import hash_password, verify_password

    h = hash_password("s3cret-pass")
    algo, n, r, p, salt, digest = h.split("$")
    assert algo == "scrypt" and int(n) >= 2**14 and salt and digest
    assert verify_password("s3cret-pass", h) and not verify_password("other", h)
    assert hash_password("s3cret-pass") != h  # per-user random salt
