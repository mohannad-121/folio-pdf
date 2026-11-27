"""Accounts: password hashing, signed session cookies, API keys and the /api/auth + /api/account routes.

Only the standard library is used for crypto (``hashlib.scrypt``, ``hmac``, ``secrets``) so nothing
native beyond CPython itself is needed.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
import threading
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import plans
from .config import settings
from .db import ApiKey, User, get_db, iso, session_scope, utcnow

log = logging.getLogger("folio.auth")

COOKIE_NAME = "folio_session"
API_KEY_PREFIX = "folio_"
ACTIVE_STATUSES = ("active", "trialing", "past_due")

# ---- passwords ----------------------------------------------------------------------------

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64e(salt)}${_b64e(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, expected = stored.split("$")
        if algo != "scrypt":
            return False
        want = _b64d(expected)
        dk = hashlib.scrypt(
            password.encode(), salt=_b64d(salt), n=int(n), r=int(r), p=int(p), dklen=len(want), maxmem=64 * 1024 * 1024
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk, want)


# Used to keep the timing of "unknown email" close to "wrong password".
_DUMMY_HASH = hash_password(secrets.token_hex(8))


# ---- session tokens -----------------------------------------------------------------------

_secret_cache: bytes | None = None
_secret_lock = threading.Lock()


def secret_key() -> bytes:
    global _secret_cache
    if settings.secret_key:
        return settings.secret_key.encode()
    with _secret_lock:
        if _secret_cache is None:
            path = settings.data_dir / ".secret_key"
            if path.exists() and path.read_text(encoding="utf-8").strip():
                _secret_cache = path.read_text(encoding="utf-8").strip().encode()
            else:
                value = secrets.token_urlsafe(48)
                path.write_text(value, encoding="utf-8")
                _secret_cache = value.encode()
        return _secret_cache


def _sign(payload: str) -> str:
    return _b64e(hmac.new(secret_key(), payload.encode(), hashlib.sha256).digest())


def password_fingerprint(password_hash: str) -> str:
    """Short keyed digest of the password hash; changing the password invalidates every session."""
    return _sign("pw:" + password_hash)[:16]


def make_session_token(user: User, now: float | None = None) -> str:
    issued = int(now if now is not None else time.time())
    expiry = issued + settings.session_days * 86400
    payload = f"{user.id}|{issued}|{expiry}|{password_fingerprint(user.password_hash)}"
    return f"{_b64e(payload.encode())}.{_sign(payload)}"


def parse_session_token(token: str) -> tuple[str, int, str] | None:
    """Return (user_id, issued_at, password_fingerprint) for a validly signed, unexpired token."""
    try:
        body, sig = token.split(".", 1)
        payload = _b64d(body).decode()
    except (ValueError, UnicodeDecodeError):
        return None
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    try:
        user_id, issued, expiry, fingerprint = payload.split("|")
        issued_i, expiry_i = int(issued), int(expiry)
    except ValueError:
        return None
    if expiry_i < time.time():
        return None
    return user_id, issued_i, fingerprint


def set_session_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        COOKIE_NAME,
        make_session_token(user),
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure)


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


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
    via: str | None = None  # "session" | "api_key" | None
    extra: dict = field(default_factory=dict)

    @property
    def tier(self) -> str:
        return effective_tier(self.user)

    @property
    def subject(self) -> str:
        return self.user.id if self.user else f"ip:{self.ip}"


def _err(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def _load_principal(request: Request) -> Principal:
    ip = client_ip(request)
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        key = auth[7:].strip()
        if key.startswith(API_KEY_PREFIX):
            with session_scope() as s:
                row = s.scalar(select(ApiKey).where(ApiKey.key_hash == hash_api_key(key)))
                user = s.get(User, row.user_id) if row else None
                if row is None or user is None:
                    raise _err(401, "invalid_api_key", "Invalid API key.")
                row.last_used_at = utcnow()
                s.expunge(user)
            principal = Principal(user=user, ip=ip, via="api_key")
            if not plans.tier_at_least(principal.tier, "max"):
                raise _err(
                    402,
                    "upgrade_required",
                    "API access is available on Max.",
                    required_plan="max",
                    feature="api",
                )
            return principal
    token = request.cookies.get(COOKIE_NAME)
    if token:
        parsed = parse_session_token(token)
        if parsed:
            user_id, _issued, fingerprint = parsed
            with session_scope() as s:
                user = s.get(User, user_id)
                if user is not None:
                    if not hmac.compare_digest(fingerprint, password_fingerprint(user.password_hash)):
                        user = None
                    else:
                        s.expunge(user)
            if user is not None:
                return Principal(user=user, ip=ip, via="session")
    return Principal(user=None, ip=ip)


def get_principal(request: Request) -> Principal:
    """Resolve (and cache per request) the caller: session cookie, API key, or anonymous."""
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
        "limits": limits,
        "usage": {
            "today": usage_today(subject) if settings.billing_enabled else 0,
            "daily_limit": limits["daily_tasks"] if settings.billing_enabled else None,
        },
    }


# ---- login rate limiting --------------------------------------------------------------------

_FAIL_WINDOW = 15 * 60
_FAIL_LIMIT = 10
_failures: dict[str, list[float]] = {}
_fail_lock = threading.Lock()


def _fail_key(email: str, ip: str) -> str:
    return f"{email}|{ip}"


def _recent_failures(key: str) -> int:
    cutoff = time.time() - _FAIL_WINDOW
    with _fail_lock:
        hits = [t for t in _failures.get(key, []) if t > cutoff]
        if hits:
            _failures[key] = hits
        else:
            _failures.pop(key, None)
        return len(hits)


def _record_failure(key: str) -> None:
    with _fail_lock:
        _failures.setdefault(key, []).append(time.time())
        if len(_failures) > 10000:  # crude memory bound
            for k in list(_failures)[:1000]:
                _failures.pop(k, None)


def reset_rate_limits() -> None:
    with _fail_lock:
        _failures.clear()


# ---- schemas ------------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(email: str) -> str:
    email = (email or "").strip().lower()
    if len(email) > 320 or not _EMAIL_RE.match(email):
        raise _err(422, "invalid_email", "Please enter a valid email address.")
    return email


class SignupIn(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=512)
    name: str | None = Field(default=None, max_length=200)


class LoginIn(BaseModel):
    email: str
    password: str = Field(max_length=512)


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=512)
    new_password: str = Field(min_length=8, max_length=512)


class DeleteAccount(BaseModel):
    password: str = Field(max_length=512)


class ApiKeyIn(BaseModel):
    name: str = Field(default="API key", min_length=1, max_length=100)


# ---- routes -------------------------------------------------------------------------------

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(body.email)
    if db.scalar(select(User).where(User.email == email)):
        raise _err(409, "email_taken", "An account with this email already exists.")
    user = User(email=email, name=(body.name or "").strip() or None, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    set_session_cookie(response, user)
    return build_me(Principal(user=user, ip=client_ip(request), via="session"), user)


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = (body.email or "").strip().lower()
    ip = client_ip(request)
    key = _fail_key(email, ip)
    if _recent_failures(key) >= _FAIL_LIMIT:
        raise _err(429, "too_many_attempts", "Too many failed sign-in attempts. Try again in 15 minutes.")
    user = db.scalar(select(User).where(User.email == email)) if email else None
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok:
        _record_failure(key)
        raise _err(401, "invalid_credentials", "Incorrect email or password.")
    with _fail_lock:
        _failures.pop(key, None)
    set_session_cookie(response, user)
    return build_me(Principal(user=user, ip=ip, via="session"), user)


@router.post("/auth/logout", status_code=204)
def logout():
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


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


@router.post("/account/password")
def change_password(
    body: PasswordChange,
    response: Response,
    principal: Principal = Depends(require_user),
    db: Session = Depends(get_db),
):
    user = db.get(User, principal.user.id)
    if not verify_password(body.current_password, user.password_hash):
        raise _err(401, "invalid_credentials", "Your current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    # The new hash changes the session fingerprint, so every older session token stops working;
    # re-issue one for this browser.
    user.password_changed_at = utcnow()
    db.commit()
    set_session_cookie(response, user)
    return build_me(principal, user)


@router.delete("/account", status_code=204)
def delete_account(body: DeleteAccount, principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    user = db.get(User, principal.user.id)
    if not verify_password(body.password, user.password_hash):
        raise _err(401, "invalid_credentials", "Your password is incorrect.")
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
    for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id)):
        db.delete(k)
    db.delete(user)
    db.commit()
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


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
def list_api_keys(principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    _require_api_tier(principal)
    rows = db.scalars(select(ApiKey).where(ApiKey.user_id == principal.user.id).order_by(ApiKey.created_at))
    return [_key_out(k) for k in rows]


@router.post("/account/api-keys", status_code=201)
def create_api_key(body: ApiKeyIn, principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    _require_api_tier(principal)
    raw = API_KEY_PREFIX + secrets.token_urlsafe(24)  # 32 url-safe chars after the prefix
    row = ApiKey(user_id=principal.user.id, name=body.name.strip(), prefix=raw[:12], key_hash=hash_api_key(raw))
    db.add(row)
    db.commit()
    return {**_key_out(row), "key": raw}


@router.delete("/account/api-keys/{key_id}", status_code=204)
def delete_api_key(key_id: str, principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    row = db.get(ApiKey, key_id)
    if row is None or row.user_id != principal.user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "API key not found."})
    db.delete(row)
    db.commit()
    return Response(status_code=204)
