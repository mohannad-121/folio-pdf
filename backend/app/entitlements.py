"""Plan enforcement, applied centrally to every tool router (see ``routers.register_all``).

``enforce_tool`` is a router-level dependency. FastAPI reads and caches the request body before
it solves dependencies, so ``await request.body()`` here returns the cached bytes and the
endpoint still receives the full body.

When ``settings.billing_enabled`` is False nothing is enforced (self-hosted edition).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta

from fastapi import HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from . import plans
from .auth import Principal, get_principal
from .config import settings
from .db import Usage, session_scope

# ---- usage counting -------------------------------------------------------------------------


def _today():
    return datetime.now(UTC).date()


def next_reset_iso() -> str:
    tomorrow = datetime.combine(_today() + timedelta(days=1), time(0, 0))
    return tomorrow.isoformat(timespec="seconds") + "Z"


def usage_today(subject: str) -> int:
    with session_scope() as s:
        row = s.scalar(select(Usage).where(Usage.subject == subject, Usage.day == _today()))
        return row.count if row else 0


def increment_usage(subject: str) -> int:
    """Add one task for today and return the new count."""
    day = _today()
    for _ in range(3):
        try:
            with session_scope() as s:
                res = s.execute(
                    update(Usage).where(Usage.subject == subject, Usage.day == day).values(count=Usage.count + 1)
                )
                if res.rowcount == 0:
                    s.add(Usage(subject=subject, day=day, count=1))
                    s.flush()
                row = s.scalar(select(Usage).where(Usage.subject == subject, Usage.day == day))
                return row.count if row else 1
        except IntegrityError:
            continue  # concurrent insert; retry as an update
    return usage_today(subject)


# ---- errors -------------------------------------------------------------------------------


def upgrade_required(required: str, feature: str, label: str | None = None) -> HTTPException:
    label = label or plans.tool_label(feature)
    return HTTPException(
        status_code=402,
        detail={
            "code": "upgrade_required",
            "required_plan": required,
            "feature": feature,
            "message": f"{label} is available on {plans.available_on(required)}.",
        },
    )


# ---- body helpers -------------------------------------------------------------------------


async def _json_body(request: Request) -> dict:
    ctype = request.headers.get("content-type", "")
    if "application/json" not in ctype:
        return {}
    try:
        raw = await request.body()  # cached by Starlette; the endpoint still gets it
        data = json.loads(raw or b"{}")
    except (ValueError, RuntimeError):
        return {}
    return data if isinstance(data, dict) else {}


def _file_count(body: dict) -> int:
    ids: list[str] = []
    file_ids = body.get("file_ids")
    if isinstance(file_ids, list):
        ids.extend(str(x) for x in file_ids)
    fid = body.get("file_id")
    if isinstance(fid, str) and fid:
        ids.append(fid)
    return len(set(ids))


@dataclass
class Requirement:
    tier: str
    feature: str
    label: str | None = None


def requirement_for(tool: str, body: dict) -> Requirement:
    """Minimum tier for calling ``tool`` with ``body`` (before per-file and quota checks)."""
    if tool == "edit":
        best = Requirement("free", "edit")
        ops = body.get("ops")
        for op in ops if isinstance(ops, list) else []:
            op_type = op.get("type") if isinstance(op, dict) else None
            if not isinstance(op_type, str):
                continue
            t = plans.op_tier(op_type)
            if plans.tier_rank(t) > plans.tier_rank(best.tier):
                label = plans.OP_LABELS.get(op_type) or f"The '{op_type}' edit"
                best = Requirement(t, op_type, label)
        return best
    if tool == "compress":
        level = body.get("level") or plans.COMPRESS_DEFAULT_LEVEL
        t = plans.COMPRESS_LEVEL_TIERS.get(str(level), "plus")
        label = f"Compression level '{level}'" if t != "free" else None
        return Requirement(plans.max_tier(plans.tool_tier(tool), t), "compress", label)
    return Requirement(plans.tool_tier(tool), tool)


# ---- the dependency -----------------------------------------------------------------------


async def enforce_tool(request: Request) -> None:
    if not settings.billing_enabled:
        return
    route = request.scope.get("route")
    path = getattr(route, "path", None) or request.url.path
    tool = plans.route_tool(request.method, path)
    if tool is None:
        return  # read-only endpoint (annotations, text spans, metadata...): free
    principal: Principal = await run_in_threadpool(get_principal, request)
    tier = principal.tier
    limits = plans.limits_for(tier)
    body = await _json_body(request) if request.method in ("POST", "PUT", "PATCH") else {}

    req = requirement_for(tool, body)
    if not plans.tier_at_least(tier, req.tier):
        raise upgrade_required(req.tier, req.feature, req.label)

    n = _file_count(body)
    if tool in plans.FILES_PER_TASK_TOOLS:
        cap = limits["max_files_per_task"]
        if cap is not None and n > cap:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "upgrade_required",
                    "required_plan": plans.next_tier(tier) or "plus",
                    "feature": "max_files_per_task",
                    "limit": cap,
                    "message": f"Your plan allows up to {cap} files per task. Upgrade to Plus for unlimited files.",
                },
            )
    elif n > 1 and tool not in plans.MULTI_INPUT_TOOLS and not limits["batch"]:
        raise upgrade_required("pro", "batch", "Processing several files at once (batch)")

    if request.method == "POST" and tool not in plans.NON_TASK_TOOLS:
        cap = limits["daily_tasks"]
        if cap is not None:
            used = await run_in_threadpool(usage_today, principal.subject)
            if used >= cap:
                raise HTTPException(
                    status_code=429,
                    detail={
                        "code": "daily_limit",
                        "limit": cap,
                        "used": used,
                        "reset_at": next_reset_iso(),
                        "required_plan": "plus",
                        "message": f"You've used all {cap} free tasks for today. "
                        "Upgrade to Plus for unlimited tasks, or come back tomorrow.",
                    },
                )
        await run_in_threadpool(increment_usage, principal.subject)


# ---- uploads ------------------------------------------------------------------------------


@dataclass
class UploadLimit:
    max_bytes: int
    detail: dict


def upload_limit(request: Request) -> UploadLimit | None:
    """Dependency for ``POST /api/files``: the caller's per-file size cap (None = server default)."""
    if not settings.billing_enabled:
        return None
    principal = get_principal(request)
    tier = principal.tier
    plan_mb = plans.limits_for(tier)["max_file_mb"]
    plan_bytes = plan_mb * 1024 * 1024
    if plan_bytes >= settings.max_upload_bytes:
        server_mb = settings.max_upload_bytes // (1024 * 1024)
        return UploadLimit(
            settings.max_upload_bytes,
            {
                "code": "file_too_large",
                "max_mb": server_mb,
                "required_plan": None,
                "message": f"Files can be at most {server_mb} MB on this server.",
            },
        )
    nxt = plans.next_tier(tier)
    nxt_mb = plans.limits_for(nxt)["max_file_mb"] if nxt else None
    message = f"Files on the {plans.TIER_NAMES[tier]} plan can be up to {plan_mb} MB."
    if nxt:
        message += f" Upgrade to {plans.TIER_NAMES[nxt]} for files up to {nxt_mb} MB."
    return UploadLimit(
        plan_bytes,
        {"code": "file_too_large", "max_mb": plan_mb, "required_plan": nxt, "message": message},
    )
