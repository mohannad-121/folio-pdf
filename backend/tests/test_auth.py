"""Supabase access-token verification, MFA (aal2) enforcement and account endpoints."""

from __future__ import annotations

import uuid

import httpx
import pytest

from app import auth
from app.db import ApiKey, User, session_scope

from .conftest import SUPABASE_URL, _ec_key, make_token, post_webhook, set_plan, signup, subscription_event


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---- token verification ---------------------------------------------------------------------


def test_valid_token_me(aclient, accounts_on):
    uid = str(uuid.uuid4())
    r = aclient.get("/api/auth/me", headers=_bearer(make_token(uid, "Ada@Example.com", name="Ada Lovelace")))
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["user"]["id"] == uid
    assert me["user"]["email"] == "ada@example.com"
    assert me["user"]["name"] == "Ada Lovelace"
    assert me["aal"] == "aal1" and me["mfa_enabled"] is False
    assert me["accounts_enabled"] is True and me["billing_enabled"] is False
    assert me["plan"] == "max"  # billing off: everything unlocked
    assert accounts_on == [f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"]
    # Keys are cached: a second request does not refetch the JWKS.
    aclient.get("/api/auth/me", headers=_bearer(make_token(uid)))
    assert len(accounts_on) == 1


def test_first_seen_upsert_then_stable(aclient):
    uid = str(uuid.uuid4())
    aclient.get("/api/auth/me", headers=_bearer(make_token(uid, "grace@example.com", name="Grace")))
    with session_scope() as s:
        u = s.get(User, uid)
        assert u is not None and u.email == "grace@example.com" and u.name == "Grace"
    # A renamed profile is kept locally; a changed email follows Supabase.
    headers = _bearer(make_token(uid, "grace@example.com"))
    r = aclient.patch("/api/account", json={"name": "Grace Hopper"}, headers=headers)
    assert r.json()["user"]["name"] == "Grace Hopper"
    me = aclient.get("/api/auth/me", headers=_bearer(make_token(uid, "g@navy.mil", name="Other"))).json()
    assert me["user"]["name"] == "Grace Hopper" and me["user"]["email"] == "g@navy.mil"
    with session_scope() as s:
        assert s.query(User).count() == 1


def test_name_falls_back_to_metadata_name(aclient):
    import time

    import jwt

    from .conftest import SIGNING_KEY, TEST_KID

    now = int(time.time())
    claims = {
        "sub": str(uuid.uuid4()),
        "email": "x@example.com",
        "aud": "authenticated",
        "iss": f"{SUPABASE_URL}/auth/v1",
        "exp": now + 60,
        "aal": "aal1",
        "user_metadata": {"name": "Xavier"},
    }
    token = jwt.encode(claims, SIGNING_KEY, algorithm="ES256", headers={"kid": TEST_KID})
    assert aclient.get("/api/auth/me", headers=_bearer(token)).json()["user"]["name"] == "Xavier"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"expires_in": -120},
        {"aud": "anon"},
        {"iss": "https://evil.supabase.co/auth/v1"},
        {"key": _ec_key()},  # bad signature
        {"kid": "unknown-kid"},
    ],
    ids=["expired", "bad-aud", "bad-iss", "bad-signature", "unknown-kid"],
)
def test_invalid_tokens_401(aclient, kwargs):
    token = make_token(str(uuid.uuid4()), **kwargs)
    r = aclient.get("/api/auth/me", headers=_bearer(token))
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "invalid_token"


def test_unknown_kid_triggers_refetch(aclient, accounts_on, monkeypatch):
    new_key = _ec_key()
    from .conftest import jwk_for

    aclient.get("/api/auth/me", headers=_bearer(make_token(str(uuid.uuid4()))))
    assert len(accounts_on) == 1
    # Supabase rotated keys: the next fetch serves the new kid. Pretend the cache is old enough to refetch.
    monkeypatch.setattr(auth, "_fetch_jwks", lambda url: {"keys": [jwk_for(new_key, "rotated")]})
    auth._jwks.fetched_at -= auth.JWKS_MIN_REFETCH_SECONDS + 1
    r = aclient.get("/api/auth/me", headers=_bearer(make_token(str(uuid.uuid4()), kid="rotated", key=new_key)))
    assert r.status_code == 200, r.text


def test_hs256_and_garbage_rejected(aclient):
    import time

    import jwt

    now = int(time.time())
    hs = jwt.encode(
        {"sub": "u", "aud": "authenticated", "iss": f"{SUPABASE_URL}/auth/v1", "exp": now + 60},
        "a-shared-secret-that-is-long-enough-for-hs256",
        algorithm="HS256",
        headers={"kid": "test-kid-1"},
    )
    assert aclient.get("/api/auth/me", headers=_bearer(hs)).status_code == 401
    assert aclient.get("/api/auth/me", headers=_bearer("not.a.jwt")).status_code == 401


def test_no_token_is_anonymous(aclient):
    me = aclient.get("/api/auth/me").json()
    assert me["user"] is None and me["aal"] is None


def test_tokens_ignored_when_accounts_disabled(client):
    from app.config import settings

    assert not settings.accounts_enabled
    r = client.get("/api/auth/me", headers=_bearer(make_token(str(uuid.uuid4()))))
    assert r.status_code == 200 and r.json()["user"] is None


def test_auth_config(aclient, client):
    cfg = aclient.get("/api/auth/config").json()
    assert cfg == {"enabled": True, "supabase_url": SUPABASE_URL, "publishable_key": "sb_publishable_test"}


def test_auth_config_disabled(client):
    assert client.get("/api/auth/config").json() == {"enabled": False, "supabase_url": "", "publishable_key": ""}


def test_old_password_routes_are_gone(aclient):
    for path in ("/api/auth/signup", "/api/auth/login", "/api/auth/logout", "/api/account/password"):
        assert aclient.post(path, json={}).status_code in (404, 405)


def test_account_requires_login(aclient):
    r = aclient.patch("/api/account", json={"name": "x"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "login_required"


def test_me_anonymous_billing_disabled(client):
    from app.config import settings

    assert settings.billing_enabled is False
    me = client.get("/api/auth/me").json()
    assert me["user"] is None and me["plan"] == "max" and me["billing_enabled"] is False
    assert me["usage"]["daily_limit"] is None


# ---- MFA ----------------------------------------------------------------------------------


def _admin_with_factor(calls: list, verified: bool = True):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, request.headers.get("apikey")))
        status = "verified" if verified else "unverified"
        return httpx.Response(200, json={"id": "x", "factors": [{"id": "f1", "factor_type": "totp", "status": status}]})

    return httpx.MockTransport(handler)


def test_aal1_with_factor_gets_mfa_required(bclient, billing_on, monkeypatch):
    monkeypatch.setattr(billing_on, "supabase_secret_key", "sb_secret_test")
    calls: list = []
    auth._admin_transport = _admin_with_factor(calls)
    me = signup(bclient)
    uid = me["user"]["id"]
    assert me["mfa_enabled"] is True and me["aal"] == "aal1"
    r = bclient.post("/api/billing/checkout", json={"plan": "pro", "interval": "monthly"})
    assert r.status_code == 403
    assert r.json()["detail"] == {"code": "mfa_required", "message": "Enter your authenticator code to continue."}
    assert calls[0] == ("GET", f"/auth/v1/admin/users/{uid}", "sb_secret_test")
    assert len(calls) == 1  # cached for 60 s
    # Account deletion and API keys are sensitive too.
    assert bclient.delete("/api/account").json()["detail"]["code"] == "mfa_required"
    set_plan(uid, "max")
    assert bclient.get("/api/account/api-keys").status_code == 403
    # Non-sensitive endpoints still work at aal1.
    assert bclient.patch("/api/account", json={"name": "Ada L"}).status_code == 200


def test_aal2_is_allowed(bclient, billing_on, monkeypatch):
    monkeypatch.setattr(billing_on, "supabase_secret_key", "sb_secret_test")
    calls: list = []
    auth._admin_transport = _admin_with_factor(calls)
    me = signup(bclient, aal="aal2", amr=["totp", "password"])
    assert me["aal"] == "aal2" and me["mfa_enabled"] is True
    r = bclient.post("/api/billing/checkout", json={"plan": "pro", "interval": "monthly"})
    assert r.status_code == 200, r.text
    assert r.json()["custom_data"] == {"user_id": me["user"]["id"]}
    assert calls == []  # aal2 needs no lookup


def test_aal1_without_verified_factor_is_allowed(bclient, billing_on, monkeypatch):
    monkeypatch.setattr(billing_on, "supabase_secret_key", "sb_secret_test")
    auth._admin_transport = _admin_with_factor([], verified=False)
    signup(bclient)
    assert bclient.post("/api/billing/checkout", json={"plan": "pro", "interval": "monthly"}).status_code == 200


def test_mfa_check_can_be_disabled(bclient, billing_on, monkeypatch):
    monkeypatch.setattr(billing_on, "supabase_secret_key", "sb_secret_test")
    monkeypatch.setattr(billing_on, "require_mfa_for_sensitive", False)
    auth._admin_transport = _admin_with_factor([])
    signup(bclient)
    assert bclient.post("/api/billing/checkout", json={"plan": "pro", "interval": "monthly"}).status_code == 200


def test_no_factor_source_allows_and_warns_once(bclient, caplog):
    signup(bclient)
    with caplog.at_level("WARNING", logger="folio.auth"):
        assert bclient.post("/api/billing/checkout", json={"plan": "pro", "interval": "monthly"}).status_code == 200
        bclient.post("/api/billing/checkout", json={"plan": "pro", "interval": "monthly"})
    assert sum("Cannot tell whether users have MFA" in r.message for r in caplog.records) == 1


def test_checkout_uses_token_email(bclient):
    signup(bclient, "verified@example.com")
    with session_scope() as s:
        u = s.scalar(__import__("sqlalchemy").select(User))
        u.email = "stale@example.com"
    r = bclient.post("/api/billing/checkout", json={"plan": "plus", "interval": "monthly"})
    assert r.json()["customer"] == {"email": "verified@example.com"}


# ---- account deletion ---------------------------------------------------------------------


def test_delete_account_calls_admin_api(aclient, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "supabase_secret_key", "sb_secret_test")
    calls: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, request.headers.get("apikey")))
        if request.method == "GET":
            return httpx.Response(200, json={"factors": []})
        return httpx.Response(200, json={})

    auth._admin_transport = httpx.MockTransport(handler)
    me = signup(aclient)
    uid = me["user"]["id"]
    r = aclient.delete("/api/account")
    assert r.status_code == 204, r.text
    assert ("DELETE", f"/auth/v1/admin/users/{uid}", "sb_secret_test") in calls
    with session_scope() as s:
        assert s.get(User, uid) is None


def test_delete_account_without_secret_key_501(aclient):
    me = signup(aclient)
    r = aclient.delete("/api/account")
    assert r.status_code == 501 and r.json()["detail"]["code"] == "secret_key_required"
    with session_scope() as s:
        assert s.get(User, me["user"]["id"]) is not None


def test_delete_account_admin_failure_502(aclient, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "supabase_secret_key", "sb_secret_test")
    auth._admin_transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"factors": []})
        if request.method == "GET"
        else httpx.Response(500, text="boom")
    )
    signup(aclient)
    r = aclient.delete("/api/account")
    assert r.status_code == 502 and r.json()["detail"]["code"] == "auth_unavailable"


# ---- API keys -----------------------------------------------------------------------------


def test_api_key_path_still_works(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    post_webhook(bclient, subscription_event(uid, status="active", price_id="pri_max_m"))
    key = bclient.post("/api/account/api-keys", json={"name": "CI"}).json()["key"]
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as api:
        r = api.get("/api/auth/me", headers=_bearer(key))
        assert r.status_code == 200 and r.json()["user"]["id"] == uid and r.json()["plan"] == "max"
        assert r.json()["aal"] is None
        assert api.get("/api/auth/me", headers=_bearer("folio_nope")).status_code == 401
    with session_scope() as s:
        assert s.query(ApiKey).count() == 1
