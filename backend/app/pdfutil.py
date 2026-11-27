"""Helpers shared by tool routers."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pymupdf as fitz  # PyMuPDF
from fastapi import HTTPException

from .config import settings
from .schemas import FileOut
from .storage import StoredFile, store


def file_out(sf: StoredFile, page_count: int | None = None) -> FileOut:
    """Build the API representation of a stored file."""
    if page_count is None and sf.name.lower().endswith(".pdf"):
        try:
            page_count = pdf_page_count(sf.fs_path)
        except Exception:  # noqa: BLE001
            page_count = None
    return FileOut(
        file_id=sf.file_id,
        name=sf.name,
        size=sf.size,
        content_type=sf.content_type,
        download_url=f"/api/files/{sf.file_id}/download",
        page_count=page_count,
    )


def pdf_page_count(path: Path) -> int:
    with fitz.open(path) as doc:
        return doc.page_count


def require_pdf(file_id: str) -> StoredFile:
    """Fetch a stored file and make sure it is a PDF."""
    sf = store.get(file_id)
    with sf.fs_path.open("rb") as f:
        head = f.read(1024)
    if b"%PDF" not in head:
        raise HTTPException(status_code=400, detail=f"{sf.name} is not a PDF")
    return sf


def open_pdf(file_id: str, password: str | None = None) -> fitz.Document:
    """Open a stored PDF with PyMuPDF, handling encryption."""
    sf = require_pdf(file_id)
    doc = fitz.open(sf.fs_path)
    if doc.needs_pass:
        if not password or not doc.authenticate(password):
            doc.close()
            raise HTTPException(status_code=401, detail="PDF is password protected")
    return doc


def with_suffix(name: str, suffix: str, new_ext: str | None = None) -> str:
    """``report.pdf`` + ``-compressed`` -> ``report-compressed.pdf``."""
    p = Path(name)
    ext = new_ext if new_ext is not None else p.suffix
    if ext and not ext.startswith("."):
        ext = "." + ext
    return f"{p.stem}{suffix}{ext}"


def save_doc(doc: fitz.Document, name: str, **save_kwargs) -> StoredFile:
    """Save a PyMuPDF document into the store and return the StoredFile."""
    file_id, path = store.output_path(name)
    kwargs = {"garbage": 3, "deflate": True}
    kwargs.update(save_kwargs)
    doc.save(path, **kwargs)
    return store.register_output(file_id, path, "application/pdf")


# ---- external binaries ------------------------------------------------------

def find_binary(configured: str, *candidates: str) -> str | None:
    if configured:
        return configured if Path(configured).exists() or shutil.which(configured) else None
    for c in candidates:
        found = shutil.which(c)
        if found:
            return found
    # Common Windows LibreOffice location
    for c in candidates:
        for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", "")):
            if not base:
                continue
            p = Path(base) / "LibreOffice" / "program" / f"{c}.exe"
            if p.exists():
                return str(p)
    return None


def soffice() -> str:
    bin_ = find_binary(settings.soffice_bin, "soffice", "libreoffice")
    if not bin_:
        raise HTTPException(
            status_code=501,
            detail=(
                "LibreOffice is not installed. Office conversions need LibreOffice "
                "(use the Docker image or set FOLIO_SOFFICE_BIN)."
            ),
        )
    return bin_


def tesseract() -> str:
    bin_ = find_binary(settings.tesseract_bin, "tesseract")
    if not bin_:
        raise HTTPException(
            status_code=501,
            detail="Tesseract is not installed. OCR needs Tesseract (use the Docker image or set FOLIO_TESSERACT_BIN).",
        )
    return bin_


def run(cmd: list[str], timeout: int = 600, cwd: Path | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd, check=False)
    except subprocess.TimeoutExpired as e:
        raise HTTPException(status_code=504, detail=f"{cmd[0]} timed out") from e
