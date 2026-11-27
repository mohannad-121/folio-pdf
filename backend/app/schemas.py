"""Shared API models used by every tool router."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class FileOut(BaseModel):
    """A stored file the client can download or pass to another tool."""

    file_id: str
    name: str
    size: int
    content_type: str
    download_url: str
    page_count: int | None = None


class ToolResult(BaseModel):
    """Standard synchronous tool response: one or more output files plus optional data."""

    outputs: list[FileOut] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


JobState = Literal["queued", "running", "done", "error"]


class JobOut(BaseModel):
    job_id: str
    state: JobState
    progress: float = 0.0  # 0..1
    message: str = ""
    result: ToolResult | None = None
    error: str | None = None


class PageRange(BaseModel):
    """1-based inclusive range. ``end`` defaults to ``start``."""

    start: int = Field(ge=1)
    end: int | None = Field(default=None, ge=1)


def parse_page_spec(spec: str, page_count: int) -> list[int]:
    """Parse ``"1-3,5,8-"`` into a sorted list of 0-based page indexes.

    Accepts ``all``, open-ended ranges (``5-``), ``odd``/``even`` and ``last``.
    Raises ValueError on garbage.
    """
    spec = (spec or "all").strip().lower()
    if spec in ("", "all", "*"):
        return list(range(page_count))
    if spec == "odd":
        return list(range(0, page_count, 2))
    if spec == "even":
        return list(range(1, page_count, 2))
    pages: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        part = part.replace("last", str(page_count))
        if "-" in part:
            a, b = part.split("-", 1)
            start = int(a) if a.strip() else 1
            end = int(b) if b.strip() else page_count
        else:
            start = end = int(part)
        if start < 1 or end < start:
            raise ValueError(f"Bad page range: {part}")
        for p in range(start, min(end, page_count) + 1):
            pages.add(p - 1)
    if not pages:
        raise ValueError("Page selection is empty")
    return sorted(pages)
