from __future__ import annotations

import io

import pymupdf
import pytest
from fastapi.routing import APIRoute

from app import plans
from app.main import app

from .conftest import download, make_pdf, set_plan, signup, upload


def _iter_routes(routes, prefix: str = ""):
    """Walk app.routes, descending into FastAPI's included-router wrappers."""
    for r in routes:
        if isinstance(r, APIRoute):
            yield r.path if r.path.startswith(prefix) else prefix + r.path, r.methods or set()
        elif hasattr(r, "original_router"):
            ctx_prefix = getattr(getattr(r, "include_context", None), "prefix", "") or ""
            yield from _iter_routes(r.original_router.routes, prefix + ctx_prefix)
        elif hasattr(r, "routes") and not hasattr(r, "app"):
            yield from _iter_routes(r.routes, prefix)


def test_every_tool_post_is_explicitly_mapped():
    gated = "|".join(plans.GATED_AREAS)
    import re

    pattern = re.compile(rf"^/api/({gated})/")
    found = [(p, m) for p, ms in _iter_routes(app.routes) for m in ms if m == "POST" and pattern.match(p)]
    assert len(found) > 50, "route walk found too few tool endpoints"
    unmapped = sorted(p for p, m in found if (m, p) not in plans.ROUTE_TOOLS)
    assert not unmapped, f"Unmapped tool endpoints (add them to plans.ROUTE_TOOLS): {unmapped}"
    # And every mapping points at a known tool tier.
    for tool in plans.ROUTE_TOOLS.values():
        assert tool in plans.TOOL_TIERS, tool


def test_unmapped_tool_defaults_to_plus():
    assert plans.route_tool("POST", "/api/edit/some-new-tool") == "/api/edit/some-new-tool"
    assert plans.tool_tier("/api/edit/some-new-tool") == "plus"
    assert plans.route_tool("GET", "/api/edit/annotations/{file_id}") is None


def test_plans_endpoint(client):
    data = client.get("/api/plans").json()
    ids = [t["id"] for t in data["tiers"]]
    assert ids == ["free", "plus", "pro", "max"]
    pro = data["tiers"][2]
    assert pro["highlight"] is True and pro["price_monthly"] == 12 and pro["price_yearly"] == 108
    assert pro["trial_days"] == 7 and pro["limits"]["batch"] is True and pro["features"]
    assert data["tiers"][0]["limits"]["daily_tasks"] == 5
    assert data["tool_tiers"]["ocr"] == "pro" and data["tool_tiers"]["merge"] == "free"
    assert data["op_tiers"]["highlight"] == "free" and data["op_tiers"]["redact"] == "pro"


def test_anonymous_free_limits(bclient):
    me = bclient.get("/api/auth/me").json()
    assert me["user"] is None and me["plan"] == "free"
    assert me["limits"] == plans.LIMITS["free"]
    assert me["usage"] == {"today": 0, "daily_limit": 5}


def test_free_user_ocr_402(bclient):
    signup(bclient)
    f = upload(bclient, make_pdf(1))
    r = bclient.post("/api/ocr/pdf", json={"file_id": f["file_id"]})
    assert r.status_code == 402
    d = r.json()["detail"]
    assert d["code"] == "upgrade_required" and d["required_plan"] == "pro" and d["feature"] == "ocr"
    assert d["message"] == "OCR is available on Pro and Max."
    # Free helpers on the OCR router still work.
    assert bclient.post("/api/ocr/detect", json={"file_id": f["file_id"]}).status_code == 200
    assert bclient.get("/api/ocr/languages").status_code == 200


def test_compress_level_gating(bclient):
    f = upload(bclient, make_pdf(1))
    r = bclient.post("/api/optimize/compress", json={"file_id": f["file_id"], "level": "low"})
    assert r.status_code == 200, r.text
    r = bclient.post("/api/optimize/compress", json={"file_id": f["file_id"], "level": "high"})
    assert r.status_code == 402
    assert r.json()["detail"]["required_plan"] == "plus" and r.json()["detail"]["feature"] == "compress"
    # Omitted level means the endpoint default ("medium"), which is a paid level.
    assert bclient.post("/api/optimize/compress", json={"file_id": f["file_id"]}).status_code == 402


def test_edit_apply_per_op_gating_and_body_passthrough(bclient):
    f = upload(bclient, make_pdf(1))
    hl = {"type": "highlight", "page": 1, "rects": [[72, 100, 300, 125]], "color": "#ffff00"}
    r = bclient.post("/api/edit/apply", json={"file_id": f["file_id"], "ops": [hl]})
    assert r.status_code == 200, r.text
    # The body reached the handler intact: the output has the highlight.
    out = download(bclient, r.json()["outputs"][0])
    doc = pymupdf.open(stream=out, filetype="pdf")
    assert [a.type[1] for a in doc[0].annots()] == ["Highlight"]
    doc.close()

    text_op = {"type": "text", "page": 1, "x": 72, "y": 200, "text": "hi"}
    r = bclient.post("/api/edit/apply", json={"file_id": f["file_id"], "ops": [hl, text_op]})
    assert r.status_code == 402
    assert r.json()["detail"]["required_plan"] == "plus" and r.json()["detail"]["feature"] == "text"

    redact = {"type": "redact", "page": 1, "rects": [[72, 100, 300, 125]]}
    r = bclient.post("/api/edit/apply", json={"file_id": f["file_id"], "ops": [text_op, redact]})
    assert r.status_code == 402
    assert r.json()["detail"]["required_plan"] == "pro" and r.json()["detail"]["feature"] == "redact"


def test_plus_user_can_use_plus_ops_and_body_survives(bclient):
    me = signup(bclient)
    set_plan(me["user"]["id"], "plus")
    f = upload(bclient, make_pdf(2))
    r = bclient.post("/api/edit/apply", json={"file_id": f["file_id"], "ops": [{"type": "delete_page", "page": 2}]})
    assert r.status_code == 200, r.text
    assert r.json()["outputs"][0]["page_count"] == 1
    r = bclient.post("/api/security/redact", json={"file_id": f["file_id"], "terms": ["fox"]})
    assert r.status_code == 402 and r.json()["detail"]["required_plan"] == "pro"


def test_batch_requires_pro(bclient):
    me = signup(bclient)
    set_plan(me["user"]["id"], "plus")
    a, b = upload(bclient, make_pdf(1)), upload(bclient, make_pdf(1))
    body = {"file_ids": [a["file_id"], b["file_id"]], "angle": 90}
    r = bclient.post("/api/organize/rotate", json=body)
    assert r.status_code == 402
    assert r.json()["detail"]["feature"] == "batch" and r.json()["detail"]["required_plan"] == "pro"
    set_plan(me["user"]["id"], "pro")
    assert bclient.post("/api/organize/rotate", json=body).status_code == 200


def test_free_max_files_per_task(bclient):
    files = [upload(bclient, make_pdf(1))["file_id"] for _ in range(4)]
    assert bclient.post("/api/organize/merge", json={"file_ids": files[:3]}).status_code == 200
    r = bclient.post("/api/organize/merge", json={"file_ids": files})
    assert r.status_code == 402
    d = r.json()["detail"]
    assert d["code"] == "upgrade_required" and d["feature"] == "max_files_per_task" and d["required_plan"] == "plus"


def test_upload_over_plan_limit_413(bclient):
    big = b"%PDF-1.4\n" + b"0" * (10 * 1024 * 1024 + 10)
    r = bclient.post("/api/files", files=[("files", ("big.pdf", io.BytesIO(big), "application/pdf"))])
    assert r.status_code == 413
    d = r.json()["detail"]
    assert d["code"] == "file_too_large" and d["max_mb"] == 10 and d["required_plan"] == "plus"

    me = signup(bclient)
    set_plan(me["user"]["id"], "plus")
    r = bclient.post("/api/files", files=[("files", ("big.pdf", io.BytesIO(big), "application/pdf"))])
    assert r.status_code == 200, r.text


def test_daily_limit_429(bclient):
    f = upload(bclient, make_pdf(1))
    for _ in range(5):
        r = bclient.post("/api/organize/rotate", json={"file_id": f["file_id"], "angle": 90})
        assert r.status_code == 200, r.text
    r = bclient.post("/api/organize/rotate", json={"file_id": f["file_id"], "angle": 90})
    assert r.status_code == 429
    d = r.json()["detail"]
    assert d["code"] == "daily_limit" and d["limit"] == 5 and d["used"] == 5 and d["required_plan"] == "plus"
    assert d["reset_at"].endswith("T00:00:00Z")
    assert bclient.get("/api/auth/me").json()["usage"]["today"] == 5
    # Reads stay free and uncounted.
    assert bclient.get(f"/api/files/{f['file_id']}/pdf-info").status_code == 200


def test_daily_limit_is_per_subject(bclient):
    f = upload(bclient, make_pdf(1))
    for _ in range(5):
        bclient.post("/api/organize/rotate", json={"file_id": f["file_id"], "angle": 90})
    signup(bclient)  # a signed-in user has their own quota
    r = bclient.post("/api/organize/rotate", json={"file_id": f["file_id"], "angle": 90})
    assert r.status_code == 200


def test_paid_user_has_no_daily_limit(bclient):
    me = signup(bclient)
    set_plan(me["user"]["id"], "plus")
    f = upload(bclient, make_pdf(1))
    for _ in range(7):
        assert bclient.post("/api/organize/rotate", json={"file_id": f["file_id"], "angle": 90}).status_code == 200


def test_canceled_status_means_free(bclient):
    me = signup(bclient)
    set_plan(me["user"]["id"], "pro", status="canceled")
    assert bclient.get("/api/auth/me").json()["plan"] == "free"
    set_plan(me["user"]["id"], "pro", status="past_due")  # grace period keeps the tier
    assert bclient.get("/api/auth/me").json()["plan"] == "pro"


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/api/ocr/pdf", None),
        ("post", "/api/security/redact", {"terms": ["fox"]}),
        ("post", "/api/optimize/compress", {"level": "extreme"}),
        ("post", "/api/edit/apply", {"ops": [{"type": "redact", "page": 1, "rects": [[0, 0, 10, 10]]}]}),
    ],
)
def test_billing_disabled_no_gating(client, method, path, body):
    """The default (self-hosted) configuration never returns 402/429."""
    f = upload(client, make_pdf(1))
    payload = {"file_id": f["file_id"], **(body or {})}
    r = getattr(client, method)(path, json=payload)
    assert r.status_code not in (402, 413, 429), r.text


def test_billing_disabled_batch_and_many_files(client):
    files = [upload(client, make_pdf(1))["file_id"] for _ in range(5)]
    assert client.post("/api/organize/merge", json={"file_ids": files}).status_code == 200
    assert client.post("/api/organize/rotate", json={"file_ids": files[:2], "angle": 90}).status_code == 200
