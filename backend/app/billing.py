"""Paddle Billing integration: checkout config, customer portal, plan changes, webhooks and sync.

Paddle is the source of truth for subscriptions; we mirror the relevant bits onto ``User`` from
webhooks (``POST /api/billing/webhook``) or on demand (``POST /api/billing/sync``).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import ACTIVE_STATUSES, Principal, build_me, require_user
from .config import settings
from .db import User, WebhookEvent, get_db, session_scope, to_naive_utc

log = logging.getLogger("folio.billing")

PAID_TIERS = ("plus", "pro", "max")
INTERVALS = ("monthly", "yearly")
SUBSCRIPTION_EVENTS = {
    "subscription.created",
    "subscription.updated",
    "subscription.activated",
    "subscription.trialing",
    "subscription.past_due",
    "subscription.paused",
    "subscription.resumed",
    "subscription.canceled",
    "subscription.imported",
}
SIGNATURE_TOLERANCE_SECONDS = 300
# Statuses that mean the user still holds a subscription (a second checkout would double-bill).
HOLDING_STATUSES = ("active", "trialing", "past_due", "paused")


# ---- Paddle API client --------------------------------------------------------------------


class PaddleError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


# Tests inject an ``httpx.MockTransport`` here.
_transport: httpx.BaseTransport | None = None


def paddle_request(method: str, path: str, *, params: dict | None = None, body: dict | None = None) -> dict:
    if not settings.paddle_api_key:
        raise PaddleError("Paddle API key is not configured")
    try:
        with httpx.Client(
            base_url=settings.paddle_api_base,
            headers={"Authorization": f"Bearer {settings.paddle_api_key}", "Content-Type": "application/json"},
            timeout=20.0,
            transport=_transport,
        ) as client:
            resp = client.request(method, path, params=params, json=body)
    except httpx.HTTPError as e:
        raise PaddleError(f"Paddle request failed: {e}") from e
    if resp.status_code >= 400:
        raise PaddleError(f"Paddle {method} {path} -> {resp.status_code}: {resp.text[:500]}", resp.status_code)
    try:
        return resp.json()
    except ValueError as e:
        raise PaddleError("Paddle returned invalid JSON") from e


def cancel_subscription_now(subscription_id: str) -> dict:
    return paddle_request("POST", f"/subscriptions/{subscription_id}/cancel", body={"effective_from": "immediately"})


# ---- prices -------------------------------------------------------------------------------


def configured_prices() -> dict[str, dict[str, str]]:
    return {
        tier: {interval: getattr(settings, f"paddle_price_{tier}_{interval}") or "" for interval in INTERVALS}
        for tier in PAID_TIERS
    }


def price_lookup() -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    for tier, by_interval in configured_prices().items():
        for interval, pid in by_interval.items():
            if pid:
                out[pid] = (tier, interval)
    return out


# ---- subscription -> user mapping -------------------------------------------------------------


def _dt(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return to_naive_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None


def _resolve_price(sub: dict) -> tuple[str | None, str | None]:
    lookup = price_lookup()
    interval = None
    for item in sub.get("items") or []:
        pid = ((item or {}).get("price") or {}).get("id") or (item or {}).get("price_id")
        if pid in lookup:
            return lookup[pid]
    cycle = (sub.get("billing_cycle") or {}).get("interval")
    if cycle == "month":
        interval = "monthly"
    elif cycle == "year":
        interval = "yearly"
    return None, interval


def apply_subscription(user: User, sub: dict, *, force: bool = False) -> bool:
    """Mirror a Paddle subscription entity onto ``user``. Returns False if it was ignored as stale."""
    sub_id = sub.get("id")
    status = sub.get("status")
    updated = _dt(sub.get("updated_at"))

    if not force:
        if (
            user.paddle_subscription_id == sub_id
            and user.subscription_updated_at
            and updated
            and updated < user.subscription_updated_at
        ):
            log.info("Ignoring out-of-order update for %s", sub_id)
            return False
        if (
            user.paddle_subscription_id
            and user.paddle_subscription_id != sub_id
            and user.plan_status in ACTIVE_STATUSES
            and status not in ACTIVE_STATUSES
        ):
            log.info("Ignoring %s event for superseded subscription %s", status, sub_id)
            return False

    tier, interval = _resolve_price(sub)
    user.paddle_subscription_id = sub_id
    if sub.get("customer_id"):
        user.paddle_customer_id = sub["customer_id"]
    user.subscription_updated_at = updated
    user.plan_status = status

    period = sub.get("current_billing_period") or {}
    user.current_period_end = _dt(period.get("ends_at"))

    trial_end = None
    for item in sub.get("items") or []:
        td = (item or {}).get("trial_dates") or {}
        end = _dt(td.get("ends_at"))
        if end and (trial_end is None or end > trial_end):
            trial_end = end
    if trial_end is None and status == "trialing":
        trial_end = _dt(period.get("ends_at"))
    user.trial_ends_at = trial_end
    if status == "trialing" or trial_end is not None:
        user.trial_used = True

    change = sub.get("scheduled_change") or {}
    user.cancel_at = _dt(change.get("effective_at")) if change.get("action") == "cancel" else None

    if status in ("canceled", "paused"):
        user.plan = "free"
        user.plan_interval = None
        user.current_period_end = None if status == "canceled" else user.current_period_end
    else:
        if tier:
            user.plan = tier
        else:
            log.error(
                "Subscription %s uses a price that is not configured (FOLIO_PADDLE_PRICE_*); plan left as %s",
                sub_id,
                user.plan,
            )
        if interval:
            user.plan_interval = interval
    return True


def _find_user(db: Session, sub: dict) -> User | None:
    custom = sub.get("custom_data") or {}
    uid = custom.get("user_id") if isinstance(custom, dict) else None
    if uid:
        user = db.get(User, str(uid))
        if user:
            return user
    if sub.get("id"):
        user = db.scalar(select(User).where(User.paddle_subscription_id == sub["id"]))
        if user:
            return user
    if sub.get("customer_id"):
        return db.scalar(select(User).where(User.paddle_customer_id == sub["customer_id"]))
    return None


# ---- webhook signature ------------------------------------------------------------------------


def verify_signature(raw: bytes, header: str | None, secret: str, *, now: float | None = None) -> bool:
    """Verify a ``Paddle-Signature: ts=...;h1=...`` header (HMAC-SHA256 over ``ts:raw_body``)."""
    if not header or not secret:
        return False
    ts: str | None = None
    sigs: list[str] = []
    for part in header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == "ts":
            ts = v
        elif k == "h1":
            sigs.append(v)
    if not ts or not sigs:
        return False
    try:
        ts_i = int(ts)
    except ValueError:
        return False
    if abs((now if now is not None else time.time()) - ts_i) > SIGNATURE_TOLERANCE_SECONDS:
        return False
    expected = hmac.new(secret.encode(), ts.encode() + b":" + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in sigs)


# ---- routes -------------------------------------------------------------------------------

router = APIRouter(prefix="/api/billing", tags=["billing"])


def _err(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def _require_billing() -> None:
    if not settings.billing_enabled:
        raise _err(400, "billing_disabled", "Billing is not enabled on this server.")


class CheckoutIn(BaseModel):
    plan: Literal["plus", "pro", "max"]
    interval: Literal["monthly", "yearly"] = "monthly"


@router.get("/config")
def billing_config():
    return {
        "enabled": settings.billing_enabled,
        "environment": settings.paddle_environment,
        "client_token": settings.paddle_client_token if settings.billing_enabled else "",
        "trial_days": settings.trial_days,
        "prices": configured_prices(),
    }


@router.post("/checkout")
def checkout(body: CheckoutIn, principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    _require_billing()
    price_id = configured_prices()[body.plan][body.interval]
    if not price_id:
        raise _err(400, "price_not_configured", f"The {body.plan} {body.interval} price is not configured.")
    user = db.get(User, principal.user.id)
    if user.paddle_subscription_id and user.plan_status in HOLDING_STATUSES:
        raise _err(
            409,
            "subscription_exists",
            "You already have a subscription. Change or manage your plan from the billing portal.",
            plan=user.plan,
            plan_status=user.plan_status,
        )
    customer = {"id": user.paddle_customer_id} if user.paddle_customer_id else {"email": user.email}
    return {
        "price_id": price_id,
        "customer": customer,
        "custom_data": {"user_id": user.id},
        "success_url": settings.public_url.rstrip("/") + "/account?checkout=success",
    }


@router.post("/change-plan")
def change_plan(body: CheckoutIn, principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    _require_billing()
    price_id = configured_prices()[body.plan][body.interval]
    if not price_id:
        raise _err(400, "price_not_configured", f"The {body.plan} {body.interval} price is not configured.")
    user = db.get(User, principal.user.id)
    if not user.paddle_subscription_id or user.plan_status not in ("active", "trialing"):
        raise _err(409, "no_active_subscription", "There is no active subscription to change.")
    try:
        resp = paddle_request(
            "PATCH",
            f"/subscriptions/{user.paddle_subscription_id}",
            body={
                "items": [{"price_id": price_id, "quantity": 1}],
                "proration_billing_mode": "prorated_immediately",
            },
        )
    except PaddleError as e:
        log.warning("Plan change failed: %s", e)
        raise _err(502, "billing_unavailable", "We couldn't change your plan right now. Please try again.") from e
    apply_subscription(user, resp.get("data") or {}, force=True)
    db.commit()
    return build_me(principal, user)


@router.post("/portal")
def portal(principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    _require_billing()
    user = db.get(User, principal.user.id)
    if not user.paddle_customer_id:
        raise _err(409, "no_customer", "You don't have a billing account yet. Choose a plan first.")
    body: dict = {}
    if user.paddle_subscription_id:
        body["subscription_ids"] = [user.paddle_subscription_id]
    try:
        resp = paddle_request("POST", f"/customers/{user.paddle_customer_id}/portal-sessions", body=body)
    except PaddleError as e:
        log.warning("Portal session failed: %s", e)
        raise _err(502, "billing_unavailable", "The billing portal is unavailable right now. Please try again.") from e
    urls = (resp.get("data") or {}).get("urls") or {}
    overview = (urls.get("general") or {}).get("overview")
    if not overview:
        raise _err(502, "billing_unavailable", "The billing portal returned no link.")
    links = {}
    for s in urls.get("subscriptions") or []:
        if s.get("id") == user.paddle_subscription_id:
            links = {
                "cancel_subscription": s.get("cancel_subscription"),
                "update_payment_method": s.get("update_subscription_payment_method"),
            }
    return {"url": overview, "links": links}


def sync_user(user: User) -> bool:
    """Pull the user's subscriptions from Paddle and apply the most relevant one."""
    trusted_customer = bool(user.paddle_customer_id)
    customer_id = user.paddle_customer_id
    if not customer_id:
        found = paddle_request("GET", "/customers", params={"email": user.email}).get("data") or []
        if not found:
            return False
        customer_id = found[0].get("id")
    params = {"customer_id": customer_id, "per_page": 50}
    subs = paddle_request("GET", "/subscriptions", params=params).get("data") or []
    if not trusted_customer:
        # Matched by email only (emails are not verified): accept only subscriptions we started for this user.
        subs = [s for s in subs if ((s.get("custom_data") or {}).get("user_id")) == user.id]
    if not subs:
        return False
    best = max(
        subs,
        key=lambda s: (
            s.get("status") in ACTIVE_STATUSES,
            s.get("status") == "paused",
            s.get("updated_at") or s.get("created_at") or "",
        ),
    )
    user.paddle_customer_id = customer_id
    return apply_subscription(user, best, force=True)


@router.post("/sync")
def sync(principal: Principal = Depends(require_user), db: Session = Depends(get_db)):
    _require_billing()
    user = db.get(User, principal.user.id)
    try:
        sync_user(user)
    except PaddleError as e:
        log.warning("Sync failed: %s", e)
        raise _err(502, "billing_unavailable", "We couldn't reach the billing provider. Please try again.") from e
    db.commit()
    return build_me(principal, user)


@router.post("/webhook")
async def webhook(request: Request):
    raw = await request.body()
    if not verify_signature(raw, request.headers.get("paddle-signature"), settings.paddle_webhook_secret):
        raise _err(401, "invalid_signature", "Invalid webhook signature.")
    try:
        event = json.loads(raw)
    except ValueError as e:
        raise _err(400, "invalid_payload", "Webhook body is not JSON.") from e
    event_id = str(event.get("event_id") or event.get("notification_id") or "")
    event_type = str(event.get("event_type") or "")
    data = event.get("data") or {}
    if not event_id:
        raise _err(400, "invalid_payload", "Webhook has no event_id.")

    from starlette.concurrency import run_in_threadpool

    return await run_in_threadpool(_handle_event, event_id, event_type, data)


def _handle_event(event_id: str, event_type: str, data: dict) -> dict:
    with session_scope() as db:
        if db.scalar(select(WebhookEvent).where(WebhookEvent.event_id == event_id)):
            return {"ok": True, "duplicate": True}
        handled = False
        if event_type in SUBSCRIPTION_EVENTS:
            user = _find_user(db, data)
            if user is None:
                log.warning("Webhook %s (%s): no matching user", event_id, event_type)
            else:
                handled = apply_subscription(user, data)
        elif event_type == "transaction.completed":
            custom = data.get("custom_data") or {}
            uid = custom.get("user_id") if isinstance(custom, dict) else None
            user = db.get(User, str(uid)) if uid else None
            if user and data.get("customer_id") and not user.paddle_customer_id:
                user.paddle_customer_id = data["customer_id"]
                handled = True
        db.add(WebhookEvent(event_id=event_id, type=event_type))
    return {"ok": True, "handled": handled}
