"""Accounts on Supabase Auth: access-token verification, MFA (aal2) enforcement, API keys and the
/api/auth + /api/account routes.

Supabase owns credentials (sign-up, email codes, passwords, TOTP factors). The browser sends the
Supabase access token as ``Authorization: Bearer <jwt>``; we verify it against the project's JWKS
(ES256/RS256 only) and mirror the user into the local ``users`` table keyed by the Supabase uid
(``sub``). Max users can also authenticate with a personal API key (``Bearer folio_...``).
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from . import plans
from .config import settings
from .db import ApiKey, User, get_db, get_engine, iso, session_scope, utcnow, valid_uuid

log = logging.getLogger("folio.auth")

API_KEY_PREFIX = "folio_"
ACTIVE_STATUSES = ("active", "trialing", "past_due")
ALLOWED_ALGORITHMS = ("ES256", "RS256")
JWKS_TTL_SECONDS = 600
JWKS_MIN_REFETCH_SECONDS = 30  # unknown-kid refetches are throttled (random kids must not hammer Supabase)
FACTOR_CACHE_SECONDS = 60


def _err(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


# ---- JWKS ---------------------------------------------------------------------------------


class TokenError(Exception):
    pass


def jwks_url() -> str:
    return f"{settings.supabase_issuer}/.well-known/jwks.json"


def _fetch_jwks(url: str) -> dict:
    """GET the JWKS document. Tests monkeypatch this."""
    resp = httpx.get(url, timeout=10.0)
    resp.raise_for_status()
    return resp.json()


class _JwksCache:
    def __init__(self) -> None:
        self.keys: dict[str, jwt.PyJWK] = {}
        self.fetched_at = 0.0
        self.lock = threading.Lock()

    def reset(self) -> None:
        with self.lock:
            self.keys, self.fetched_at = {}, 0.0

    def _refresh(self) -> None:
        doc = _fetch_jwks(jwks_url())
        keys: dict[str, jwt.PyJWK] = {}
        for raw in doc.get("keys") or []:
            kid = raw.get("kid")
            alg = raw.get("alg")
            if not kid or (alg and alg not in ALLOWED_ALGORITHMS):
                continue
            try:
                keys[kid] = jwt.PyJWK(raw, algorithm=alg)
            except (jwt.PyJWKError, jwt.InvalidKeyError) as e:
                log.warning("Skipping unusable JWKS key %s: %s", kid, e)
        self.keys, self.fetched_at = keys, time.time()

    def get(self, kid: str) -> jwt.PyJWK:
        with self.lock:
            age = time.time() - self.fetched_at
            stale = age > JWKS_TTL_SECONDS
            missing = kid not in self.keys
            if stale or (missing and age > JWKS_MIN_REFETCH_SECONDS):
                try:
                    self._refresh()
                except (httpx.HTTPError, ValueError) as e:
                    log.warning("Could not fetch the Supabase JWKS: %s", e)
                    if not self.keys:
                        raise TokenError("signing keys unavailable") from e
            key = self.keys.get(kid)
        if key is None:
            raise TokenError("unknown signing key")
        return key


_jwks = _JwksCache()


def verify_access_token(token: str) -> dict:
    """Validate a Supabase access token and return its claims. Raises ``TokenError``."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        raise TokenError("malformed token") from e
    alg, kid = header.get("alg"), header.get("kid")
    if alg not in ALLOWED_ALGORITHMS:
        raise TokenError(f"algorithm {alg!r} not allowed")
    if not kid:
        raise TokenError("token has no key id")
    key = _jwks.get(kid)
    try:
        claims = jwt.decode(
            token,
            key.key,
            algorithms=[alg],
            audience=settings.supabase_jwt_audience,
            issuer=settings.supabase_issuer,
            leeway=10,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except jwt.PyJWTError as e:
        raise TokenError(str(e)) from e
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise TokenError("token has no subject")
    return claims


def _amr_methods(claims: dict) -> list[str]:
    out = []
    for entry in claims.get("amr") or []:
        method = entry.get("method") if isinstance(entry, dict) else entry
        if isinstance(method, str):
            out.append(method)
    return out


# ---- principal ----------------------------------------------------------------------------


def client_ip(request: Request) -> str:
    if settings.trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            first = fwd.split(",")[0].strip()
            if first:
                return first
    return request.client.host if request.client else "unknown"


def effective_tier(user: User | None) -> str:
    if not settings.billing_enabled:
        return "max"
    if user is None:
        return "free"
    if user.plan_status in ACTIVE_STATUSES and user.plan in plans.TIERS:
        return user.plan
    return "free"


@dataclass
class Principal:
    user: User | None  # detached ORM object (safe to read attributes)
    ip: str
    via: str | None = None  # "supabase" | "api_key" | None
    claims: dict = field(default_factory=dict)
    extra: dict = field(default_factory=dict)

    @property
    def tier(self) -> str:
        return effective_tier(self.user)

    @property
    def subject(self) -> str:
        return self.user.id if self.user else f"ip:{self.ip}"

    @property
    def aal(self) -> str | None:
        return self.claims.get("aal") if self.via == "supabase" else None

    @property
    def amr(self) -> list[str]:
        return _amr_methods(self.claims)

    @property
    def email(self) -> str | None:
        """The verified email from the access token (falls back to the stored one)."""
        return self.claims.get("email") or (self.user.email if self.user else None)


def _display_name(claims: dict) -> str | None:
    meta = claims.get("user_metadata") or {}
    if not isinstance(meta, dict):
        return None
    for k in ("full_name", "name"):
        v = meta.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()[:200]
    return None


def upsert_user(claims: dict) -> User:
    """Return the local user for the token's ``sub``, creating it on first sight."""
    uid = valid_uuid(claims["sub"])
    if uid is None:
        raise TokenError("subject is not a uuid")
    email = (claims.get("email") or "").strip().lower()
    for _ in range(2):
        try:
            with session_scope() as s:
                user = s.get(User, uid)
                if user is None:
                    user = User(id=uid, email=email, name=_display_name(claims))
                    s.add(user)
                    s.flush()
                elif email and user.email != email:
                    user.email = email  # changed in Supabase
                s.expunge(user)
                return user
        except IntegrityError:
            continue  # created concurrently by another request; read it back
    with session_scope() as s:
        user = s.get(User, uid)
        s.expunge(user)
        return user


def _load_principal(request: Request) -> Principal:
    ip = client_ip(request)
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return Principal(user=None, ip=ip)
    token = auth[7:].strip()
    if token.startswith(API_KEY_PREFIX):
        with session_scope() as s:
            row = s.scalar(select(ApiKey).where(ApiKey.key_hash == hash_api_key(token)))
            user = s.get(User, row.user_id) if row else None
            if row is None or user is None:
                raise _err(401, "invalid_api_key", "Invalid API key.")
            row.last_used_at = utcnow()
            s.expunge(user)
        principal = Principal(user=user, ip=ip, via="api_key")
        if not plans.tier_at_least(principal.tier, "max"):
            raise _err(402, "upgrade_required", "API access is available on Max.", required_plan="max", feature="api")
        return principal
    if not settings.accounts_enabled or not token:
        return Principal(user=None, ip=ip)
    try:
        claims = verify_access_token(token)
        user = upsert_user(claims)
    except TokenError as e:
        log.info("Rejected access token: %s", e)
        raise _err(401, "invalid_token", "Your session has expired. Please sign in again.") from e
    return Principal(user=user, ip=ip, via="supabase", claims=claims)


def get_principal(request: Request) -> Principal:
    """Resolve (and cache per request) the caller: Supabase token, API key, or anonymous."""
    cached = getattr(request.state, "folio_principal", None)
    if cached is not None:
        return cached
    principal = _load_principal(request)
    request.state.folio_principal = principal
    return principal


def require_user(principal: Principal = Depends(get_principal)) -> Principal:
    if principal.user is None:
        raise _err(401, "login_required", "Please sign in to continue.")
    return principal


# ---- Supabase Admin API ---------------------------------------------------------------------


class AdminError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


# Tests inject an ``httpx.MockTransport`` here.
_admin_transport: httpx.BaseTransport | None = None


def admin_request(method: str, path: str) -> Any:
    """Call the Auth Admin API (``/auth/v1/admin/...``) with the secret key."""
    if not settings.supabase_secret_key:
        raise AdminError("FOLIO_SUPABASE_SECRET_KEY is not configured")
    try:
        with httpx.Client(
            base_url=settings.supabase_issuer,
            # New-style secret keys are not JWTs: they go in the apikey header only.
            headers={"apikey": settings.supabase_secret_key, "Accept": "application/json"},
            timeout=15.0,
            transport=_admin_transport,
        ) as client:
            resp = client.request(method, path)
    except httpx.HTTPError as e:
        raise AdminError(f"Supabase request failed: {e}") from e
    if resp.status_code >= 400:
        raise AdminError(f"Supabase {method} {path} -> {resp.status_code}: {resp.text[:300]}", resp.status_code)
    if not resp.content:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


# ---- MFA ----------------------------------------------------------------------------------

_factor_cache: dict[str, tuple[float, bool]] = {}
_factor_lock = threading.Lock()
_warned_no_factor_source = False


def reset_auth_caches() -> None:
    global _warned_no_factor_source
    _jwks.reset()
    with _factor_lock:
        _factor_cache.clear()
    _warned_no_factor_source = False


def _factors_from_db(user_id: str) -> bool | None:
    engine = get_engine()
    if engine.dialect.name != "postgresql":
        return None
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT 1 FROM auth.mfa_factors WHERE user_id = CAST(:uid AS uuid) "
                    "AND status = 'verified' AND factor_type = 'totp' LIMIT 1"
                ),
                {"uid": user_id},
            ).first()
        return row is not None
    except SQLAlchemyError as e:
        log.warning("Could not read auth.mfa_factors: %s", e)
        return None


def _factors_from_admin(user_id: str) -> bool | None:
    if not settings.supabase_secret_key:
        return None
    try:
        data = admin_request("GET", f"/admin/users/{user_id}")
    except AdminError as e:
        log.warning("Could not read MFA factors from Supabase: %s", e)
        return None
    factors = (data.get("factors") or []) if isinstance(data, dict) else []
    return any(isinstance(f, dict) and f.get("status") == "verified" for f in factors)


def has_verified_factor(principal: Principal) -> bool | None:
    """Whether the user has a verified TOTP factor. ``None`` = unknown (no way to ask)."""
    global _warned_no_factor_source
    if principal.user is None or principal.via != "supabase":
        return False
    if principal.aal == "aal2" or any(m in ("totp", "mfa/totp") for m in principal.amr):
        return True
    uid = principal.user.id
    with _factor_lock:
        hit = _factor_cache.get(uid)
        if hit and time.time() - hit[0] < FACTOR_CACHE_SECONDS:
            return hit[1]
    result = _factors_from_db(uid)
    if result is None:
        result = _factors_from_admin(uid)
    if result is None:
        if not _warned_no_factor_source:
            _warned_no_factor_source = True
            log.warning(
                "Cannot tell whether users have MFA enabled: set FOLIO_SUPABASE_SECRET_KEY or use Supabase "
                "Postgres as FOLIO_DATABASE_URL. Sensitive actions are allowed at aal1 until then."
            )
        return None
    with _factor_lock:
        _factor_cache[uid] = (time.time(), result)
    return result


def forget_factor_cache(user_id: str) -> None:
    with _factor_lock:
        _factor_cache.pop(user_id, None)


def require_sensitive(principal: Principal = Depends(require_user)) -> Principal:
    """Signed-in user who, if they have TOTP set up, proved it in this session (aal2)."""
    if not settings.require_mfa_for_sensitive or principal.via != "supabase" or principal.aal == "aal2":
        return principal
    if has_verified_factor(principal):
        raise _err(403, "mfa_required", "Enter your authenticator code to continue.")
    return principal


# ---- Me -----------------------------------------------------------------------------------


def build_me(principal: Principal, user: User | None = None) -> dict:
    from .entitlements import usage_today

    user = user if user is not None else principal.user
    tier = effective_tier(user)
    limits = plans.limits_for(tier) if settings.billing_enabled else plans.unlocked_limits()
    subject = user.id if user else f"ip:{principal.ip}"
    return {
        "user": (
            {"id": user.id, "email": user.email, "name": user.name, "created_at": iso(user.created_at)}
            if user
            else None
        ),
        "plan": tier,
        "plan_status": user.plan_status if user else None,
        "plan_interval": user.plan_interval if user else None,
        "trial_ends_at": iso(user.trial_ends_at) if user else None,
        "current_period_end": iso(user.current_period_end) if user else None,
        "cancel_at": iso(user.cancel_at) if user else None,
        "trial_used": bool(user.trial_used) if user else False,
        "billing_enabled": settings.billing_enabled,
        "accounts_enabled": settings.accounts_enabled,
        "aal": principal.aal,
        "mfa_enabled": bool(has_verified_factor(principal)) if user else False,
        "limits": limits,
        "usage": {
            "today": usage_today(subject) if settings.billing_enabled else 0,
            "daily_limit": limits["daily_tasks"] if settings.billing_enabled else None,
        },
    }


# ---- schemas ------------------------------------------------------------------------------


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)


class ApiKeyIn(BaseModel):
    name: str = Field(default="API key", min_length=1, max_length=100)


# ---- routes -------------------------------------------------------------------------------

router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/auth/config")
def auth_config():
    """Public Supabase settings so the frontend (and the desktop build) can configure supabase-js."""
    enabled = settings.accounts_enabled
    return {
        "enabled": enabled,
        "supabase_url": settings.supabase_base if enabled else "",
        "publishable_key": settings.supabase_publishable_key if enabled else "",
    }


@router.get("/auth/me")
def me(principal: Principal = Depends(get_principal)):
    return build_me(principal)


@router.patch("/account")
def update_account(body: AccountPatch, principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    user = db.get(User, principal.user.id)
    if body.name is not None:
        user.name = body.name.strip() or None
    db.commit()
    return build_me(principal, user)


@router.delete("/account", status_code=204)
def delete_account(principal: Principal = Depends(require_sensitive), db: Session = Depends(get_db)):
    if principal.via == "supabase" and not settings.supabase_secret_key:
        raise _err(
            501,
            "secret_key_required",
            "Account deletion is not configured on this server (FOLIO_SUPABASE_SECRET_KEY is missing).",
        )
    user = db.get(User, principal.user.id)
    if user.paddle_subscription_id and user.plan_status in ("active", "trialing", "past_due", "paused"):
        from .billing import PaddleError, cancel_subscription_now

        try:
            cancel_subscription_now(user.paddle_subscription_id)
        except PaddleError as e:
            log.warning("Could not cancel subscription %s: %s", user.paddle_subscription_id, e)
            raise _err(
                502,
                "billing_unavailable",
                "We couldn't cancel your subscription, so your account was not deleted. Please try again.",
            ) from e
    uid = user.id
    for k in db.scalars(select(ApiKey).where(ApiKey.user_id == uid)):
        db.delete(k)
    db.delete(user)
    # Commit before calling Supabase: the folio.users -> auth.users FK cascades, and an open
    # transaction holding the row would block Supabase's own delete.
    db.commit()
    if settings.supabase_secret_key:
        try:
            admin_request("DELETE", f"/admin/users/{uid}")
        except AdminError as e:
            if e.status != 404:
                log.warning("Could not delete Supabase user %s: %s", uid, e)
                raise _err(
                    502,
                    "auth_unavailable",
                    "Your data was removed, but we couldn't delete your sign-in. Please try again.",
                ) from e
    forget_factor_cache(uid)
    return Response(status_code=204)


# ---- API keys -----------------------------------------------------------------------------


def _require_api_tier(principal: Principal) -> None:
    if not plans.tier_at_least(principal.tier, "max"):
        raise _err(402, "upgrade_required", "API access is available on Max.", required_plan="max", feature="api")


def _key_out(k: ApiKey) -> dict:
    return {
        "id": k.id,
        "name": k.name,
        "prefix": k.prefix,
        "created_at": iso(k.created_at),
        "last_used_at": iso(k.last_used_at),
    }


@router.get("/account/api-keys")
def list_api_keys(principal: Principal = Depends(require_sensitive), db: Session = Depends(get_db)):
    _require_api_tier(principal)
    rows = db.scalars(select(ApiKey).where(ApiKey.user_id == principal.user.id).order_by(ApiKey.created_at))
    return [_key_out(k) for k in rows]


@router.post("/account/api-keys", status_code=201)
def create_api_key(body: ApiKeyIn, principal: Principal = Depends(require_sensitive), db: Session = Depends(get_db)):
    _require_api_tier(principal)
    raw = API_KEY_PREFIX + secrets.token_urlsafe(24)  # 32 url-safe chars after the prefix
    row = ApiKey(user_id=principal.user.id, name=body.name.strip(), prefix=raw[:12], key_hash=hash_api_key(raw))
    db.add(row)
    db.commit()
    return {**_key_out(row), "key": raw}


@router.delete("/account/api-keys/{key_id}", status_code=204)
def delete_api_key(key_id: str, principal: Principal = Depends(require_sensitive), db: Session = Depends(get_db)):
    row = db.get(ApiKey, key_id)
    if row is None or row.user_id != principal.user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "API key not found."})
    db.delete(row)
    db.commit()
    return Response(status_code=204)
