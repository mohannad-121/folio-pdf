"""Upload, download, inspect and render files."""

from __future__ import annotations

import pymupdf as fitz
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from ..entitlements import UploadLimit, upload_limit
from ..jobs import jobs
from ..pdfutil import file_out, open_pdf
from ..schemas import FileOut, JobOut
from ..storage import store

router = APIRouter(prefix="/api", tags=["files"])


@router.post("/files", response_model=list[FileOut])
async def upload(files: list[UploadFile] = File(...), limit: UploadLimit | None = Depends(upload_limit)):
    out: list[FileOut] = []
    for f in files:
        if limit is None:
            sf = await store.save_upload(f)
        else:
            sf = await store.save_upload(f, max_bytes=limit.max_bytes, too_large_detail=limit.detail)
        out.append(file_out(sf))
    return out


@router.get("/files/{file_id}", response_model=FileOut)
def info(file_id: str):
    return file_out(store.get(file_id))


@router.get("/files/{file_id}/download")
def download(file_id: str, inline: bool = False):
    sf = store.get(file_id)
    return FileResponse(
        sf.fs_path,
        media_type=sf.content_type,
        filename=sf.name,
        content_disposition_type="inline" if inline else "attachment",
    )


@router.delete("/files/{file_id}", status_code=204)
def delete(file_id: str):
    store.delete(file_id)
    return Response(status_code=204)


# ---- PDF inspection ---------------------------------------------------------

class OutlineItem(BaseModel):
    level: int
    title: str
    page: int  # 1-based


class PdfInfo(BaseModel):
    file: FileOut
    page_count: int
    encrypted: bool
    metadata: dict[str, str | None]
    pages: list[dict]  # [{index, width, height, rotation}]
    outline: list[OutlineItem]
    has_forms: bool
    has_text: bool


@router.get("/files/{file_id}/pdf-info", response_model=PdfInfo)
def pdf_info(file_id: str, password: str | None = None):
    sf = store.get(file_id)
    with sf.fs_path.open("rb") as f:
        if b"%PDF" not in f.read(1024):
            raise HTTPException(status_code=400, detail="Not a PDF")
    doc = fitz.open(sf.fs_path)
    encrypted = doc.needs_pass
    if encrypted:
        if not password or not doc.authenticate(password):
            doc.close()
            return PdfInfo(
                file=file_out(sf, None),
                page_count=0,
                encrypted=True,
                metadata={},
                pages=[],
                outline=[],
                has_forms=False,
                has_text=False,
            )
    pages = [
        {"index": i, "width": p.rect.width, "height": p.rect.height, "rotation": p.rotation}
        for i, p in enumerate(doc)
    ]
    toc = doc.get_toc(simple=True)
    outline = [OutlineItem(level=lvl, title=title, page=max(1, pg)) for lvl, title, pg in toc]
    has_text = any(doc[i].get_text("text").strip() for i in range(min(doc.page_count, 5)))
    has_forms = bool(doc.is_form_pdf)
    meta = doc.metadata or {}
    info = PdfInfo(
        file=file_out(sf, doc.page_count),
        page_count=doc.page_count,
        encrypted=encrypted,
        metadata=meta,
        pages=pages,
        outline=outline,
        has_forms=has_forms,
        has_text=has_text,
    )
    doc.close()
    return info


@router.get("/files/{file_id}/pages/{page}/render")
def render_page(
    file_id: str,
    page: int,
    scale: float = Query(1.5, ge=0.1, le=6),
    fmt: str = Query("png", pattern="^(png|jpeg|webp)$"),
    password: str | None = None,
):
    """Render one page (1-based) to an image."""
    doc = open_pdf(file_id, password)
    if page < 1 or page > doc.page_count:
        doc.close()
        raise HTTPException(status_code=404, detail="Page out of range")
    pix = doc[page - 1].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    data = pix.tobytes(fmt if fmt != "jpeg" else "jpg")
    doc.close()
    return Response(content=data, media_type=f"image/{fmt}", headers={"Cache-Control": "max-age=3600"})


@router.get("/files/{file_id}/thumbnails")
def thumbnails(file_id: str, width: int = Query(160, ge=32, le=800), password: str | None = None):
    """Return a JSON list of data-URI thumbnails for all pages (small docs) ."""
    doc = open_pdf(file_id, password)
    out = []
    for p in doc:
        zoom = width / max(p.rect.width, 1)
        pix = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        buf = pix.tobytes("jpg")
        import base64

        out.append("data:image/jpeg;base64," + base64.b64encode(buf).decode())
    doc.close()
    return out


@router.get("/files/{file_id}/text")
def text(file_id: str, pages: str | None = None, password: str | None = None):
    """Plain text per page."""
    from ..schemas import parse_page_spec

    doc = open_pdf(file_id, password)
    idx = parse_page_spec(pages or "all", doc.page_count)
    result = [{"page": i + 1, "text": doc[i].get_text("text")} for i in idx]
    doc.close()
    return result


@router.get("/files/{file_id}/search")
def search(file_id: str, q: str, password: str | None = None):
    """Find all occurrences of ``q``; returns page + bounding boxes in PDF points."""
    doc = open_pdf(file_id, password)
    hits = []
    for i, p in enumerate(doc):
        for r in p.search_for(q):
            # search_for works in unrotated page space; report displayed-space boxes.
            r = r * p.rotation_matrix
            r.normalize()
            hits.append({"page": i + 1, "x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1})
    doc.close()
    return {"query": q, "count": len(hits), "hits": hits}


# ---- jobs -------------------------------------------------------------------

@router.get("/jobs/{job_id}", response_model=JobOut)
def job(job_id: str):
    return jobs.get(job_id)


@router.get("/health")
def health():
    from ..config import settings
    from ..pdfutil import find_binary

    return {
        "status": "ok",
        "libreoffice": bool(find_binary(settings.soffice_bin, "soffice", "libreoffice")),
        "tesseract": bool(find_binary(settings.tesseract_bin, "tesseract")),
        "pymupdf": fitz.VersionBind,
    }
