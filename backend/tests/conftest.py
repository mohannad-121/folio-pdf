from __future__ import annotations

import io
import os
import tempfile

import pytest

# Point the store at a temp dir before the app imports settings.
_tmp = tempfile.mkdtemp(prefix="folio-test-")
os.environ["FOLIO_DATA_DIR"] = _tmp

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


def make_pdf(pages: int = 3, text: str = "Hello Folio") -> bytes:
    """Build a small multi-page PDF with real text using PyMuPDF."""
    import pymupdf as fitz

    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 72), f"{text} page {i + 1}", fontsize=18)
        page.insert_text((72, 120), "The quick brown fox jumps over the lazy dog.", fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def sample_pdf() -> bytes:
    return make_pdf()


def upload(client: TestClient, data: bytes, name: str = "sample.pdf", ctype: str = "application/pdf") -> dict:
    r = client.post("/api/files", files=[("files", (name, io.BytesIO(data), ctype))])
    assert r.status_code == 200, r.text
    return r.json()[0]


@pytest.fixture
def uploaded(client: TestClient, sample_pdf: bytes) -> dict:
    return upload(client, sample_pdf)


def wait_job(client: TestClient, job: dict, timeout: float = 120) -> dict:
    """Poll a JobOut until finished; returns the final JobOut."""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/jobs/{job['job_id']}")
        assert r.status_code == 200
        j = r.json()
        if j["state"] in ("done", "error"):
            return j
        time.sleep(0.2)
    raise AssertionError("job timed out")


def download(client: TestClient, file_out: dict) -> bytes:
    r = client.get(file_out["download_url"])
    assert r.status_code == 200
    return r.content


# ---- billing / accounts fixtures --------------------------------------------------------------

WEBHOOK_SECRET = "pdl_ntfset_test_secret"
TEST_PRICES = {
    "plus": {"monthly": "pri_plus_m", "yearly": "pri_plus_y"},
    "pro": {"monthly": "pri_pro_m", "yearly": "pri_pro_y"},
    "max": {"monthly": "pri_max_m", "yearly": "pri_max_y"},
}


@pytest.fixture
def billing_on(client, monkeypatch, tmp_path):
    """Enable billing against a fresh, empty database. Yields the settings object."""
    from app import auth, billing, db
    from app.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "paddle_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(settings, "paddle_api_key", "pdl_sdbx_apikey_test")
    monkeypatch.setattr(settings, "paddle_client_token", "test_client_token")
    for tier, by_interval in TEST_PRICES.items():
        for interval, pid in by_interval.items():
            monkeypatch.setattr(settings, f"paddle_price_{tier}_{interval}", pid)
    db.init_db(f"sqlite:///{tmp_path.as_posix()}/billing.db")
    auth.reset_rate_limits()
    yield settings
    billing._transport = None
    auth.reset_rate_limits()
    db.init_db()


@pytest.fixture
def bclient(billing_on):
    """A fresh TestClient (own cookie jar) with billing enabled."""
    with TestClient(app) as c:
        yield c


def signup(c: TestClient, email: str = "ada@example.com", password: str = "correct horse", name: str = "Ada") -> dict:
    r = c.post("/api/auth/signup", json={"email": email, "password": password, "name": name})
    assert r.status_code == 201, r.text
    return r.json()


def sign_webhook(body: bytes, secret: str = WEBHOOK_SECRET, ts: int | None = None) -> str:
    import hashlib
    import hmac
    import time

    ts = int(time.time()) if ts is None else ts
    sig = hmac.new(secret.encode(), str(ts).encode() + b":" + body, hashlib.sha256).hexdigest()
    return f"ts={ts};h1={sig}"


def subscription_event(
    user_id: str | None,
    *,
    status: str = "trialing",
    price_id: str = "pri_pro_m",
    event_type: str = "subscription.created",
    event_id: str | None = None,
    sub_id: str = "sub_01test",
    customer_id: str = "ctm_01test",
    updated_at: str = "2026-11-27T10:00:00Z",
    scheduled_change: dict | None = None,
) -> dict:
    import uuid

    trial = {"starts_at": "2026-11-27T10:00:00Z", "ends_at": "2026-12-04T10:00:00Z"} if status == "trialing" else None
    period = {"starts_at": "2026-11-27T10:00:00Z", "ends_at": "2026-12-04T10:00:00Z"}
    return {
        "event_id": event_id or f"evt_{uuid.uuid4().hex}",
        "event_type": event_type,
        "occurred_at": updated_at,
        "notification_id": f"ntf_{uuid.uuid4().hex}",
        "data": {
            "id": sub_id,
            "status": status,
            "customer_id": customer_id,
            "custom_data": {"user_id": user_id} if user_id else None,
            "items": [{"price": {"id": price_id}, "status": status, "trial_dates": trial, "quantity": 1}],
            "current_billing_period": period if status not in ("canceled", "paused") else None,
            "billing_cycle": {"interval": "month", "frequency": 1},
            "scheduled_change": scheduled_change,
            "updated_at": updated_at,
        },
    }


def post_webhook(c: TestClient, event: dict, secret: str = WEBHOOK_SECRET, signature: str | None = None):
    import json

    raw = json.dumps(event).encode()
    return c.post(
        "/api/billing/webhook",
        content=raw,
        headers={"Paddle-Signature": signature or sign_webhook(raw, secret), "Content-Type": "application/json"},
    )


def set_plan(user_id: str, plan: str, status: str = "active") -> None:
    from app.db import User, session_scope

    with session_scope() as s:
        u = s.get(User, user_id)
        u.plan, u.plan_status = plan, status
