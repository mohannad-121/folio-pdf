"""Tool routers. Each module here exposes ``router: APIRouter`` and is auto-registered.

Conventions every tool follows:

* Prefix ``/api/<area>`` (``/api/organize``, ``/api/convert`` ...).
* Inputs are JSON bodies referencing uploaded files by ``file_id``
  (upload first via ``POST /api/files``).
* Fast operations return :class:`app.schemas.ToolResult` directly.
* Slow operations (OCR, Office conversion) return :class:`app.schemas.JobOut`
  via :func:`app.jobs.jobs.submit`; the client polls ``/api/jobs/{id}``.
* Outputs are written through :data:`app.storage.store` and described with
  :func:`app.pdfutil.file_out`.
"""
