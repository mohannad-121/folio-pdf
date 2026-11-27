from __future__ import annotations

import json
import time

import httpx

from app import billing
from app.db import User, session_scope

from .conftest import (
    WEBHOOK_SECRET,
    make_pdf,
    post_webhook,
    set_plan,
    sign_webhook,
    signup,
    subscription_event,
    upload,
)


def _user(user_id: str) -> User:
    with session_scope() as s:
        u = s.get(User, user_id)
        s.expunge(u)
        return u


def test_config(bclient):
    cfg = bclient.get("/api/billing/config").json()
    assert cfg["enabled"] is True and cfg["environment"] == "sandbox"
    assert cfg["client_token"] == "test_client_token" and cfg["trial_days"] == 7
    assert cfg["prices"]["pro"] == {"monthly": "pri_pro_m", "yearly": "pri_pro_y"}


def test_config_disabled(client):
    cfg = client.get("/api/billing/config").json()
    assert cfg["enabled"] is False


def test_checkout(bclient, billing_on, monkeypatch):
    r = bclient.post("/api/billing/checkout", json={"plan": "pro", "interval": "yearly"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "login_required"
    me = signup(bclient)
    r = bclient.post("/api/billing/checkout", json={"plan": "pro", "interval": "yearly"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["price_id"] == "pri_pro_y"
    assert body["customer"] == {"email": "ada@example.com"}
    assert body["custom_data"] == {"user_id": me["user"]["id"]}
    assert body["success_url"] == "http://localhost:5173/account?checkout=success"

    monkeypatch.setattr(billing_on, "paddle_price_max_monthly", "")
    r = bclient.post("/api/billing/checkout", json={"plan": "max", "interval": "monthly"})
    assert r.status_code == 400

    set_plan(me["user"]["id"], "pro", "trialing")
    with session_scope() as s:
        s.get(User, me["user"]["id"]).paddle_subscription_id = "sub_x"
    r = bclient.post("/api/billing/checkout", json={"plan": "max", "interval": "yearly"})
    assert r.status_code == 409


def test_webhook_upgrades_to_pro_trialing(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    r = post_webhook(bclient, subscription_event(uid, status="trialing", price_id="pri_pro_m"))
    assert r.status_code == 200, r.text
    now = bclient.get("/api/auth/me").json()
    assert now["plan"] == "pro" and now["plan_status"] == "trialing" and now["plan_interval"] == "monthly"
    assert now["trial_ends_at"] == "2026-12-04T10:00:00Z"
    assert now["current_period_end"] == "2026-12-04T10:00:00Z"
    assert now["trial_used"] is True and now["limits"]["max_file_mb"] == 200
    u = _user(uid)
    assert u.paddle_customer_id == "ctm_01test" and u.paddle_subscription_id == "sub_01test"
    # Pro tools now pass the gate (redact).
    f = upload(bclient, make_pdf(1))
    assert bclient.post("/api/security/redact", json={"file_id": f["file_id"], "terms": ["fox"]}).status_code == 200


def test_webhook_bad_signature_401(bclient):
    me = signup(bclient)
    event = subscription_event(me["user"]["id"])
    assert post_webhook(bclient, event, secret="pdl_ntfset_wrong").status_code == 401
    raw = json.dumps(event).encode()
    stale = sign_webhook(raw, ts=int(time.time()) - 600)
    r = bclient.post("/api/billing/webhook", content=raw, headers={"Paddle-Signature": stale})
    assert r.status_code == 401
    r = bclient.post("/api/billing/webhook", content=raw)  # no header
    assert r.status_code == 401
    assert bclient.get("/api/auth/me").json()["plan"] == "free"


def test_verify_signature_multiple_h1():
    raw = b'{"a":1}'
    good = sign_webhook(raw).split("h1=")[1]
    ts = int(time.time())
    header = f"ts={ts};h1=deadbeef;h1={good}"
    assert billing.verify_signature(raw, header, WEBHOOK_SECRET, now=ts)
    assert not billing.verify_signature(raw + b" ", header, WEBHOOK_SECRET, now=ts)


def test_webhook_idempotent(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    event = subscription_event(uid, status="active", price_id="pri_plus_y", event_id="evt_same")
    assert post_webhook(bclient, event).json()["handled"] is True
    set_plan(uid, "free", "canceled")  # change state behind the webhook's back
    r = post_webhook(bclient, event)
    assert r.status_code == 200 and r.json()["duplicate"] is True
    assert bclient.get("/api/auth/me").json()["plan"] == "free"  # not re-applied


def test_webhook_canceled_goes_free_and_scheduled_cancel(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    post_webhook(bclient, subscription_event(uid, status="active", updated_at="2026-11-27T10:00:00Z"))
    post_webhook(
        bclient,
        subscription_event(
            uid,
            status="active",
            event_type="subscription.updated",
            updated_at="2026-11-28T10:00:00Z",
            scheduled_change={"action": "cancel", "effective_at": "2026-12-27T10:00:00Z", "resume_at": None},
        ),
    )
    m = bclient.get("/api/auth/me").json()
    assert m["plan"] == "pro" and m["cancel_at"] == "2026-12-27T10:00:00Z"

    canceled = subscription_event(
        uid, status="canceled", event_type="subscription.canceled", updated_at="2026-12-27T10:00:00Z"
    )
    post_webhook(bclient, canceled)
    m = bclient.get("/api/auth/me").json()
    assert m["plan"] == "free" and m["plan_status"] == "canceled"


def test_webhook_out_of_order_is_ignored(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    post_webhook(bclient, subscription_event(uid, status="active", updated_at="2026-11-28T10:00:00Z"))
    r = post_webhook(bclient, subscription_event(uid, status="trialing", updated_at="2026-11-27T10:00:00Z"))
    assert r.json()["handled"] is False
    assert bclient.get("/api/auth/me").json()["plan_status"] == "active"


def test_webhook_finds_user_by_customer_and_transaction_completed(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    txn = {
        "event_id": "evt_txn1",
        "event_type": "transaction.completed",
        "data": {"id": "txn_1", "customer_id": "ctm_abc", "custom_data": {"user_id": uid}},
    }
    assert post_webhook(bclient, txn).json()["handled"] is True
    assert _user(uid).paddle_customer_id == "ctm_abc"
    # A subscription event without custom_data is matched through the customer id.
    post_webhook(bclient, subscription_event(None, status="active", price_id="pri_max_m", customer_id="ctm_abc"))
    assert bclient.get("/api/auth/me").json()["plan"] == "max"
    # Unknown event types are acknowledged.
    r = post_webhook(bclient, {"event_id": "evt_c", "event_type": "customer.updated", "data": {}})
    assert r.status_code == 200 and r.json()["handled"] is False


def _mock_paddle(handler):
    billing._transport = httpx.MockTransport(handler)


def test_portal(bclient):
    me = signup(bclient)
    r = bclient.post("/api/billing/portal")
    assert r.status_code == 409  # no Paddle customer yet
    post_webhook(bclient, subscription_event(me["user"]["id"], status="active"))
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            201,
            json={
                "data": {
                    "id": "cpls_1",
                    "customer_id": "ctm_01test",
                    "urls": {
                        "general": {"overview": "https://customer-portal.paddle.com/cpl_1?action=overview&token=t"},
                        "subscriptions": [
                            {
                                "id": "sub_01test",
                                "cancel_subscription": "https://x/cancel",
                                "update_subscription_payment_method": "https://x/pm",
                                "view_subscription": "https://x/view",
                            }
                        ],
                    },
                }
            },
        )

    _mock_paddle(handler)
    r = bclient.post("/api/billing/portal")
    assert r.status_code == 200, r.text
    assert r.json()["url"].startswith("https://customer-portal.paddle.com/")
    assert r.json()["links"]["cancel_subscription"] == "https://x/cancel"
    assert seen["url"] == "https://sandbox-api.paddle.com/customers/ctm_01test/portal-sessions"
    assert seen["auth"] == "Bearer pdl_sdbx_apikey_test"
    assert seen["body"] == {"subscription_ids": ["sub_01test"]}


def test_sync_by_email(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    sub = subscription_event(uid, status="trialing", price_id="pri_max_y")["data"]
    other = subscription_event("someone-else", status="active", price_id="pri_max_m", sub_id="sub_other")["data"]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/customers":
            assert request.url.params["email"] == "ada@example.com"
            return httpx.Response(200, json={"data": [{"id": "ctm_01test", "email": "ada@example.com"}]})
        if request.url.path == "/subscriptions":
            assert request.url.params["customer_id"] == "ctm_01test"
            return httpx.Response(200, json={"data": [other, sub]})
        return httpx.Response(404)

    _mock_paddle(handler)
    r = bclient.post("/api/billing/sync")
    assert r.status_code == 200, r.text
    body = r.json()
    # The subscription started for someone else is ignored when matched by email only.
    assert body["plan"] == "max" and body["plan_status"] == "trialing" and body["plan_interval"] == "yearly"
    assert _user(uid).paddle_subscription_id == "sub_01test"


def test_sync_paddle_down(bclient):
    signup(bclient)
    _mock_paddle(lambda request: httpx.Response(500, text="boom"))
    r = bclient.post("/api/billing/sync")
    assert r.status_code == 502 and r.json()["detail"]["code"] == "billing_unavailable"


def test_change_plan(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    post_webhook(bclient, subscription_event(uid, status="active", price_id="pri_plus_m"))
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"], seen["path"] = request.method, request.url.path
        seen["body"] = json.loads(request.content)
        data = subscription_event(uid, status="active", price_id="pri_pro_y", updated_at="2026-11-29T00:00:00Z")
        return httpx.Response(200, json={"data": data["data"]})

    _mock_paddle(handler)
    r = bclient.post("/api/billing/change-plan", json={"plan": "pro", "interval": "yearly"})
    assert r.status_code == 200, r.text
    assert r.json()["plan"] == "pro" and r.json()["plan_interval"] == "yearly"
    assert seen["method"] == "PATCH" and seen["path"] == "/subscriptions/sub_01test"
    assert seen["body"] == {
        "items": [{"price_id": "pri_pro_y", "quantity": 1}],
        "proration_billing_mode": "prorated_immediately",
    }


def test_delete_account_cancels_subscription(bclient):
    me = signup(bclient)
    post_webhook(bclient, subscription_event(me["user"]["id"], status="active"))
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"], seen["body"] = request.url.path, json.loads(request.content)
        return httpx.Response(200, json={"data": {"id": "sub_01test", "status": "canceled"}})

    _mock_paddle(handler)
    r = bclient.request("DELETE", "/api/account", json={"password": "correct horse"})
    assert r.status_code == 204
    assert seen == {"path": "/subscriptions/sub_01test/cancel", "body": {"effective_from": "immediately"}}


def test_api_keys_require_max_then_bearer_works(bclient):
    me = signup(bclient)
    uid = me["user"]["id"]
    r = bclient.post("/api/account/api-keys", json={"name": "CI"})
    assert r.status_code == 402 and r.json()["detail"]["required_plan"] == "max"
    assert bclient.get("/api/account/api-keys").status_code == 402

    post_webhook(bclient, subscription_event(uid, status="active", price_id="pri_max_m"))
    r = bclient.post("/api/account/api-keys", json={"name": "CI"})
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    assert key.startswith("folio_") and len(key) == len("folio_") + 32
    listed = bclient.get("/api/account/api-keys").json()
    assert len(listed) == 1 and "key" not in listed[0] and listed[0]["prefix"] == key[:12]

    # A cookie-less client authenticates with the key and can use Pro/Max features.
    import io

    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as api:
        h = {"Authorization": f"Bearer {key}"}
        assert api.get("/api/auth/me", headers=h).json()["plan"] == "max"
        up = api.post("/api/files", headers=h, files=[("files", ("a.pdf", io.BytesIO(make_pdf(1)), "application/pdf"))])
        assert up.status_code == 200
        fid = up.json()[0]["file_id"]
        r = api.post("/api/security/redact", headers=h, json={"file_id": fid, "terms": ["fox"]})
        assert r.status_code == 200, r.text
        bad = api.get("/api/auth/me", headers={"Authorization": "Bearer folio_nope"})
        assert bad.status_code == 401
    assert bclient.get("/api/account/api-keys").json()[0]["last_used_at"] is not None

    # Downgrade: the key stops granting access.
    set_plan(uid, "max", "canceled")
    with TestClient(app) as api:
        r = api.get("/api/auth/me", headers={"Authorization": f"Bearer {key}"})
        assert r.status_code == 402

    set_plan(uid, "max", "active")
    key_id = listed[0]["id"]
    assert bclient.delete(f"/api/account/api-keys/{key_id}").status_code == 204
    assert bclient.get("/api/account/api-keys").json() == []
