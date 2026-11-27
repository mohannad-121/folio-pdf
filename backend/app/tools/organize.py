"""Organize tools: merge, split, extract, delete, rotate, insert, reorder, replace, duplicate, n-up, booklet."""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Literal

import pymupdf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..pdfutil import file_out, open_pdf, save_doc, with_suffix
from ..schemas import ToolResult, parse_page_spec
from ..storage import store

router = APIRouter(prefix="/api/organize", tags=["organize"])

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".pnm", ".pgm", ".ppm", ".jxr", ".jpx"}


# ---- helpers ------------------------------------------------------------------


class _Base(BaseModel):
    file_id: str | None = None
    file_ids: list[str] | None = None
    password: str | None = None

    def ids(self) -> list[str]:
        ids = list(self.file_ids or [])
        if self.file_id and self.file_id not in ids:
            ids.insert(0, self.file_id)
        if not ids:
            raise HTTPException(status_code=400, detail="Provide file_id or file_ids")
        return ids


def _pages(spec: str | None, page_count: int) -> list[int]:
    try:
        return parse_page_spec(spec or "all", page_count)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid page selection: {e}") from e


def _is_pdf(path: Path) -> bool:
    with path.open("rb") as f:
        return b"%PDF" in f.read(1024)


def _open_any(file_id: str, password: str | None) -> tuple[pymupdf.Document, str]:
    """Open a stored file as a PDF document; images are converted to one-page PDFs."""
    sf = store.get(file_id)
    if _is_pdf(sf.fs_path):
        return open_pdf(file_id, password), sf.name
    ext = sf.fs_path.suffix.lower()
    if ext in IMAGE_EXTS or sf.content_type.startswith("image/"):
        try:
            img = pymupdf.open(sf.fs_path)
            pdf_bytes = img.convert_to_pdf()
            img.close()
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Could not read image {sf.name}: {e}") from e
        return pymupdf.open("pdf", pdf_bytes), sf.name
    raise HTTPException(
        status_code=400,
        detail=f"{sf.name} is not a PDF or image. Convert Office documents to PDF first, then merge.",
    )


# ---- merge --------------------------------------------------------------------


@router.post("/merge", response_model=ToolResult)
def merge(req: _Base):
    ids = req.ids()
    out = pymupdf.open()
    toc: list[list] = []
    sources = []
    for fid in ids:
        src, name = _open_any(fid, req.password)
        start = out.page_count
        out.insert_pdf(src)
        toc.append([1, Path(name).stem, start + 1])
        for lvl, title, pg, *_rest in src.get_toc(simple=True):
            if pg < 1:
                pg = 1
            toc.append([lvl + 1, title, start + pg])
        sources.append({"name": name, "pages": src.page_count})
        src.close()
    if out.page_count == 0:
        out.close()
        raise HTTPException(status_code=400, detail="Nothing to merge")
    try:
        out.set_toc(toc)
    except Exception:  # noqa: BLE001 - a malformed source outline must not fail the merge
        pass
    sf = save_doc(out, "merged.pdf")
    page_count = out.page_count
    out.close()
    return ToolResult(outputs=[file_out(sf, page_count)], data={"page_count": page_count, "sources": sources})


# ---- split --------------------------------------------------------------------


class SplitRequest(_Base):
    mode: Literal["ranges", "every", "single", "bookmarks"] = "ranges"
    ranges: str | None = None
    every: int | None = Field(default=None, ge=1)


def _chunks_from_ranges(spec: str, page_count: int) -> list[list[int]]:
    chunks = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        chunks.append(_pages(part, page_count))
    if not chunks:
        raise HTTPException(status_code=400, detail="Provide at least one page range")
    return chunks


def _chunks_from_bookmarks(doc: pymupdf.Document) -> list[list[int]]:
    tops = sorted({max(1, pg) - 1 for lvl, _t, pg in doc.get_toc(simple=True) if lvl == 1})
    if not tops:
        raise HTTPException(status_code=400, detail="This PDF has no bookmarks to split by")
    if tops[0] != 0:
        tops.insert(0, 0)
    chunks = []
    for i, start in enumerate(tops):
        end = tops[i + 1] if i + 1 < len(tops) else doc.page_count
        if end > start:
            chunks.append(list(range(start, end)))
    return chunks


@router.post("/split", response_model=ToolResult)
def split(req: SplitRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    name = store.get(fid).name
    n = doc.page_count
    if req.mode == "ranges":
        if not req.ranges:
            raise HTTPException(status_code=400, detail="Provide page ranges, e.g. 1-3, 4-6, 7-")
        chunks = _chunks_from_ranges(req.ranges, n)
    elif req.mode == "every":
        step = req.every or 1
        chunks = [list(range(i, min(i + step, n))) for i in range(0, n, step)]
    elif req.mode == "single":
        chunks = [[i] for i in range(n)]
    else:
        chunks = _chunks_from_bookmarks(doc)

    outputs = []
    stem = Path(name).stem
    width = max(2, len(str(len(chunks))))
    for i, chunk in enumerate(chunks, start=1):
        part = pymupdf.open()
        for p in chunk:
            part.insert_pdf(doc, from_page=p, to_page=p)
        sf = save_doc(part, f"{stem}-part-{i:0{width}d}.pdf")
        part.close()
        outputs.append(file_out(sf, len(chunk)))
    doc.close()

    if len(outputs) > 1:
        zid, zpath = store.output_path(f"{stem}-split.zip")
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
            for o in outputs:
                zf.write(store.path(o.file_id), arcname=o.name)
        outputs.append(file_out(store.register_output(zid, zpath, "application/zip")))
    return ToolResult(outputs=outputs, data={"parts": len(chunks), "pages": [len(c) for c in chunks]})


# ---- extract / delete ------------------------------------------------------------


class PagesRequest(_Base):
    pages: str = "all"


@router.post("/extract", response_model=ToolResult)
def extract(req: PagesRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    idx = _pages(req.pages, doc.page_count)
    doc.select(idx)
    sf = save_doc(doc, with_suffix(store.get(fid).name, "-extracted"))
    doc.close()
    return ToolResult(outputs=[file_out(sf, len(idx))], data={"page_count": len(idx)})


@router.post("/delete", response_model=ToolResult)
def delete(req: PagesRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    idx = _pages(req.pages, doc.page_count)
    if len(idx) >= doc.page_count:
        doc.close()
        raise HTTPException(status_code=400, detail="Cannot delete every page of the document")
    doc.delete_pages(idx)
    sf = save_doc(doc, with_suffix(store.get(fid).name, "-pages-removed"))
    n = doc.page_count
    doc.close()
    return ToolResult(outputs=[file_out(sf, n)], data={"page_count": n, "deleted": len(idx)})


# ---- rotate -----------------------------------------------------------------------


class RotateRequest(_Base):
    angle: Literal[90, 180, 270] = 90
    pages: str = "all"


@router.post("/rotate", response_model=ToolResult)
def rotate(req: RotateRequest):
    outputs = []
    for fid in req.ids():
        doc = open_pdf(fid, req.password)
        for i in _pages(req.pages, doc.page_count):
            page = doc[i]
            page.set_rotation((page.rotation + req.angle) % 360)
        sf = save_doc(doc, with_suffix(store.get(fid).name, "-rotated"))
        outputs.append(file_out(sf, doc.page_count))
        doc.close()
    return ToolResult(outputs=outputs, data={"angle": req.angle})


# ---- insert -----------------------------------------------------------------------


class InsertRequest(_Base):
    at: int = Field(default=0, ge=0, description="Insert after this 1-based page; 0 = beginning")
    insert_file_id: str | None = None
    blank_count: int = Field(default=1, ge=0)
    insert_password: str | None = None


@router.post("/insert", response_model=ToolResult)
def insert(req: InsertRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    at = min(req.at, doc.page_count)
    inserted = 0
    if req.insert_file_id:
        src, _ = _open_any(req.insert_file_id, req.insert_password)
        inserted = src.page_count
        doc.insert_pdf(src, start_at=at)
        src.close()
    else:
        if req.blank_count < 1:
            doc.close()
            raise HTTPException(status_code=400, detail="Provide a PDF to insert or a number of blank pages")
        ref = doc[max(0, min(at - 1 if at > 0 else 0, doc.page_count - 1))].rect
        for _ in range(req.blank_count):
            doc.new_page(pno=at, width=ref.width, height=ref.height)
        inserted = req.blank_count
    sf = save_doc(doc, with_suffix(store.get(fid).name, "-inserted"))
    n = doc.page_count
    doc.close()
    return ToolResult(outputs=[file_out(sf, n)], data={"page_count": n, "inserted": inserted})


# ---- reorder ----------------------------------------------------------------------


class ReorderPage(BaseModel):
    source_page: int = Field(ge=1)
    rotation: int | None = None


class ReorderRequest(_Base):
    pages: list[ReorderPage]


@router.post("/reorder", response_model=ToolResult)
def reorder(req: ReorderRequest):
    fid = req.ids()[0]
    if not req.pages:
        raise HTTPException(status_code=400, detail="The resulting document would have no pages")
    doc = open_pdf(fid, req.password)
    out = pymupdf.open()
    for item in req.pages:
        if item.source_page > doc.page_count:
            doc.close()
            out.close()
            raise HTTPException(status_code=400, detail=f"Page {item.source_page} does not exist")
        src = item.source_page - 1
        out.insert_pdf(doc, from_page=src, to_page=src)
        if item.rotation is not None:
            if item.rotation % 90:
                raise HTTPException(status_code=400, detail="Rotation must be a multiple of 90")
            out[-1].set_rotation(item.rotation % 360)
    sf = save_doc(out, with_suffix(store.get(fid).name, "-organized"))
    n = out.page_count
    out.close()
    doc.close()
    return ToolResult(outputs=[file_out(sf, n)], data={"page_count": n})


# ---- replace ----------------------------------------------------------------------


class ReplaceRequest(_Base):
    pages: str
    replacement_file_id: str
    replacement_pages: str = "all"
    replacement_password: str | None = None


@router.post("/replace", response_model=ToolResult)
def replace(req: ReplaceRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    repl = open_pdf(req.replacement_file_id, req.replacement_password)
    targets = _pages(req.pages, doc.page_count)
    repl_idx = _pages(req.replacement_pages, repl.page_count)
    repl.select(repl_idx)
    first = targets[0]
    doc.delete_pages(targets)
    doc.insert_pdf(repl, start_at=min(first, doc.page_count))
    repl.close()
    sf = save_doc(doc, with_suffix(store.get(fid).name, "-replaced"))
    n = doc.page_count
    doc.close()
    return ToolResult(outputs=[file_out(sf, n)], data={"page_count": n, "replaced": len(targets)})


# ---- duplicate ----------------------------------------------------------------------


@router.post("/duplicate", response_model=ToolResult)
def duplicate(req: PagesRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    idx = set(_pages(req.pages, doc.page_count))
    order: list[int] = []
    for i in range(doc.page_count):
        order.append(i)
        if i in idx:
            order.append(i)
    doc.select(order)
    sf = save_doc(doc, with_suffix(store.get(fid).name, "-duplicated"))
    n = doc.page_count
    doc.close()
    return ToolResult(outputs=[file_out(sf, n)], data={"page_count": n, "duplicated": len(idx)})


# ---- n-up / booklet ----------------------------------------------------------------

_GRID = {2: (2, 1), 4: (2, 2), 6: (3, 2), 9: (3, 3)}


class NUpRequest(_Base):
    per_page: Literal[2, 4, 6, 9] = 2
    orientation: Literal["auto", "portrait", "landscape"] = "auto"
    margin: float = Field(default=18.0, ge=0)


def _sheet_size(req_orientation: str, src_rect: pymupdf.Rect, cols: int, rows: int) -> tuple[float, float]:
    w, h = src_rect.width, src_rect.height
    if req_orientation == "auto":
        landscape = cols > rows
    else:
        landscape = req_orientation == "landscape"
    if landscape:
        return (max(w, h), min(w, h))
    return (min(w, h), max(w, h))


def _place(
    out: pymupdf.Document,
    src: pymupdf.Document,
    order: list[int | None],
    cols: int,
    rows: int,
    sheet: tuple[float, float],
    margin: float,
) -> None:
    sw, sh = sheet
    cell_w = (sw - margin * (cols + 1)) / cols
    cell_h = (sh - margin * (rows + 1)) / rows
    per = cols * rows
    for s in range(0, len(order), per):
        page = out.new_page(width=sw, height=sh)
        for k, src_idx in enumerate(order[s : s + per]):
            if src_idx is None or src_idx >= src.page_count:
                continue
            c, r = k % cols, k // cols
            x0 = margin + c * (cell_w + margin)
            y0 = margin + r * (cell_h + margin)
            page.show_pdf_page(pymupdf.Rect(x0, y0, x0 + cell_w, y0 + cell_h), src, src_idx)


@router.post("/n-up", response_model=ToolResult)
def n_up(req: NUpRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    cols, rows = _GRID[req.per_page]
    sheet = _sheet_size(req.orientation, doc[0].rect, cols, rows)
    out = pymupdf.open()
    _place(out, doc, list(range(doc.page_count)), cols, rows, sheet, req.margin)
    sf = save_doc(out, with_suffix(store.get(fid).name, f"-{req.per_page}up"))
    n = out.page_count
    out.close()
    doc.close()
    return ToolResult(outputs=[file_out(sf, n)], data={"page_count": n, "per_page": req.per_page})


@router.post("/booklet", response_model=ToolResult)
def booklet(req: _Base):
    """Saddle-stitch imposition: 2-up sheets ordered so folding the stack yields the book."""
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    n = doc.page_count
    total = ((n + 3) // 4) * 4
    seq: list[int | None] = [i if i < n else None for i in range(total)]
    order: list[int | None] = []
    lo, hi = 0, total - 1
    while lo < hi:
        # front of sheet: last | first ; back of sheet: first+1 | last-1
        order += [seq[hi], seq[lo], seq[lo + 1], seq[hi - 1]]
        lo += 2
        hi -= 2
    r = doc[0].rect
    sheet = (max(r.width, r.height), min(r.width, r.height))
    out = pymupdf.open()
    _place(out, doc, order, 2, 1, sheet, 0.0)
    sf = save_doc(out, with_suffix(store.get(fid).name, "-booklet"))
    pages = out.page_count
    out.close()
    doc.close()
    return ToolResult(outputs=[file_out(sf, pages)], data={"page_count": pages, "sheets": pages // 2})
