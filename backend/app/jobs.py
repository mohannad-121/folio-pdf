"""Tiny background job manager.

Long-running tools (OCR, Office conversion, big compressions) run in a thread
pool and report progress. The client polls ``GET /api/jobs/{job_id}``.

Usage inside a router::

    from ..jobs import jobs

    @router.post("/ocr")
    async def ocr(req: OcrRequest):
        def work(progress):
            progress(0.1, "Rendering pages")
            ...
            return ToolResult(outputs=[...])
        return jobs.submit(work)
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException

from .config import settings
from .schemas import JobOut, ToolResult

ProgressFn = Callable[[float, str], None]
WorkFn = Callable[[ProgressFn], ToolResult]


class JobManager:
    def __init__(self, workers: int | None = None) -> None:
        self._pool = ThreadPoolExecutor(max_workers=workers or settings.job_workers, thread_name_prefix="folio-job")
        self._jobs: dict[str, JobOut] = {}
        self._created: dict[str, float] = {}
        self._lock = threading.Lock()

    def submit(self, work: WorkFn) -> JobOut:
        job_id = uuid.uuid4().hex
        job = JobOut(job_id=job_id, state="queued")
        with self._lock:
            self._jobs[job_id] = job
            self._created[job_id] = time.time()

        def progress(frac: float, message: str = "") -> None:
            with self._lock:
                j = self._jobs[job_id]
                j.progress = max(0.0, min(1.0, frac))
                if message:
                    j.message = message

        def run() -> None:
            with self._lock:
                self._jobs[job_id].state = "running"
            try:
                result = work(progress)
                with self._lock:
                    j = self._jobs[job_id]
                    j.state = "done"
                    j.progress = 1.0
                    j.result = result
            except HTTPException as e:  # tool-raised user error
                with self._lock:
                    j = self._jobs[job_id]
                    j.state = "error"
                    j.error = str(e.detail)
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                with self._lock:
                    j = self._jobs[job_id]
                    j.state = "error"
                    j.error = f"{type(e).__name__}: {e}"

        self._pool.submit(run)
        return job

    def get(self, job_id: str) -> JobOut:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    def sweep(self, ttl_seconds: int = 6 * 3600) -> None:
        cutoff = time.time() - ttl_seconds
        with self._lock:
            for jid, created in list(self._created.items()):
                if created < cutoff and self._jobs[jid].state in ("done", "error"):
                    self._jobs.pop(jid, None)
                    self._created.pop(jid, None)


jobs = JobManager()
