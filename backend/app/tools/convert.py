"""Conversion tools: PDF -> (docx, xlsx, pptx, images, html, text, PDF/A) and X -> PDF.

Everything here is pure Python except:

* Office -> PDF (LibreOffice, ``pdfutil.soffice()``)
* PDF -> PDF/A (Ghostscript via ocrmypdf, ``ghostscript()``)
* HTML -> PDF (WeasyPrint, which needs the GTK/Pango native libraries at runtime)

Those raise HTTP 501 with a clear message when the binary is missing.
"""

from __future__ import annotations

import csv
import html
import io
import ipaddress
import json
import shutil
import socket
import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import pymupdf
from fastapi import APIRouter, HTTPException
from PIL import Image, ImageOps, ImageSequence
from pydantic import BaseModel, Field

from .. import pdfutil
from ..jobs import ProgressFn, jobs
from ..pdfutil import file_out, open_pdf, with_suffix
from ..schemas import JobOut, ToolResult, parse_page_spec
from ..storage import StoredFile, store

router = APIRouter(prefix="/api/convert", tags=["convert"])

OFFICE_EXTS = {
    ".doc",
    ".docx",
    ".odt",
    ".rtf",
    ".xlsx",
    ".xls",
    ".ods",
    ".pptx",
    ".ppt",
    ".odp",
    ".docm",
    ".dotx",
    ".xlsm",
    ".pptm",
    ".wpd",
    ".epub",
    ".pages",
    ".numbers",
    ".key",
}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".heic", ".heif", ".jp2"}
TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".log"}
HTML_EXTS = {".html", ".htm", ".xhtml"}
PAGE_SIZES = {"a4": "a4", "letter": "letter", "legal": "legal", "a3": "a3", "a5": "a5"}


# ---- request models ----------------------------------------------------------


class PdfRequest(BaseModel):
    """Base for PDF-input tools: ``file_id`` or ``file_ids`` (at least one), optional password + page spec."""

    file_id: str | None = None
    file_ids: list[str] | None = None
    password: str | None = None
    pages: str | None = "all"

    def ids(self) -> list[str]:
        ids = list(self.file_ids or [])
        if self.file_id and self.file_id not in ids:
            ids.insert(0, self.file_id)
        if not ids:
            raise HTTPException(status_code=400, detail="file_id or file_ids is required")
        return ids


class PptxRequest(PdfRequest):
    mode: Literal["image", "text"] = "image"


class ImagesRequest(PdfRequest):
    format: Literal["jpeg", "jpg", "png", "webp", "tiff"] = "jpeg"
    dpi: int = Field(150, ge=18, le=1200)
    extract_embedded: bool = False


class HtmlOutRequest(PdfRequest):
    mode: Literal["layout", "flow"] = "layout"


class TextRequest(PdfRequest):
    format: Literal["txt", "md", "json"] = "txt"


class PdfaRequest(PdfRequest):
    level: Literal["1b", "2b", "3b", "1", "2", "3"] = "2b"


class FilesRequest(BaseModel):
    file_id: str | None = None
    file_ids: list[str] | None = None

    def ids(self) -> list[str]:
        ids = list(self.file_ids or [])
        if self.file_id and self.file_id not in ids:
            ids.insert(0, self.file_id)
        if not ids:
            raise HTTPException(status_code=400, detail="file_id or file_ids is required")
        return ids


class ImagesToPdfRequest(FilesRequest):
    page_size: Literal["fit", "A4", "Letter", "a4", "letter"] = "fit"
    margin: float = Field(0, ge=0)
    orientation: Literal["auto", "portrait", "landscape"] = "auto"


class HtmlToPdfRequest(BaseModel):
    file_id: str | None = None
    url: str | None = None
    html: str | None = None
    page_size: Literal["A4", "Letter", "a4", "letter"] = "A4"
    landscape: bool = False


class TextToPdfRequest(BaseModel):
    file_id: str | None = None
    text: str | None = None
    markdown: bool | None = None
    font_size: float = Field(11, ge=4, le=72)
    page_size: str = "A4"


class AnyToPdfRequest(BaseModel):
    file_id: str


# ---- shared helpers ----------------------------------------------------------


def _page_indexes(doc: pymupdf.Document, spec: str | None) -> list[int]:
    try:
        return parse_page_spec(spec or "all", doc.page_count)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _subset(doc: pymupdf.Document, idx: list[int]) -> pymupdf.Document:
    """New in-memory document containing only ``idx`` (0-based) pages, in that order."""
    out = pymupdf.open()
    for i in idx:
        out.insert_pdf(doc, from_page=i, to_page=i)
    return out


def _save_bytes(name: str, data: bytes, content_type: str | None = None) -> StoredFile:
    file_id, path = store.output_path(name)
    path.write_bytes(data)
    return store.register_output(file_id, path, content_type)


def _zip_files(name: str, files: list[StoredFile]) -> StoredFile:
    file_id, path = store.output_path(name)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for sf in files:
            zf.write(sf.fs_path, arcname=sf.name)
    return store.register_output(file_id, path, "application/zip")


def _with_zip(stem: str, files: list[StoredFile]) -> list[StoredFile]:
    if len(files) > 1:
        files = files + [_zip_files(f"{stem}.zip", files)]
    return files


def _stem(sf: StoredFile) -> str:
    return Path(sf.name).stem


def _sub_progress(progress: ProgressFn, n: int, total: int) -> ProgressFn:
    """Progress callback for item ``n`` of ``total`` mapped onto the overall 0..1 range."""

    def sub(frac: float, message: str = "") -> None:
        progress((n + frac) / total, message)

    return sub


def ghostscript() -> str:
    """Path to the Ghostscript binary or HTTP 501."""
    for c in ("gs", "gswin64c", "gswin32c"):
        found = shutil.which(c)
        if found:
            return found
    raise HTTPException(
        status_code=501,
        detail="Ghostscript is not installed. PDF/A conversion and OCR need Ghostscript (use the Docker image).",
    )


def have_ghostscript() -> bool:
    return any(shutil.which(c) for c in ("gs", "gswin64c", "gswin32c"))


def pdf_to_markdown(doc: pymupdf.Document, idx: list[int], embed_images: bool = False) -> str:
    """Markdown via pymupdf4llm; falls back to the classic (non-layout) engine if the layout
    extension is unavailable (e.g. its native library is blocked on the host)."""
    import pymupdf4llm

    kwargs = {"pages": idx, "embed_images": embed_images, "show_progress": False}
    try:
        return pymupdf4llm.to_markdown(doc, **kwargs)
    except Exception:  # noqa: BLE001 - layout engine missing/broken -> legacy path
        from pymupdf4llm.helpers import pymupdf_rag

        return pymupdf_rag.to_markdown(doc, **kwargs)


def _pix_to_pil(pix: pymupdf.Pixmap) -> Image.Image:
    if pix.n - pix.alpha >= 4:  # CMYK or similar
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    mode = "RGBA" if pix.alpha else ("L" if pix.n == 1 else "RGB")
    return Image.frombytes(mode, (pix.width, pix.height), pix.samples)


def _encode_pix(pix: pymupdf.Pixmap, fmt: str) -> tuple[bytes, str]:
    """Encode a pixmap as (bytes, extension) in jpeg/png/webp/tiff."""
    fmt = "jpeg" if fmt == "jpg" else fmt
    if fmt in ("jpeg", "png") and pix.n - pix.alpha < 4:
        if fmt == "jpeg" and pix.alpha:
            pix = pymupdf.Pixmap(pix, 0)
        return pix.tobytes("jpg" if fmt == "jpeg" else "png"), (".jpg" if fmt == "jpeg" else ".png")
    img = _pix_to_pil(pix)
    buf = io.BytesIO()
    if fmt == "jpeg":
        img.convert("RGB").save(buf, "JPEG", quality=90)
        return buf.getvalue(), ".jpg"
    if fmt == "png":
        img.save(buf, "PNG")
        return buf.getvalue(), ".png"
    if fmt == "webp":
        img.save(buf, "WEBP", quality=90)
        return buf.getvalue(), ".webp"
    img.save(buf, "TIFF", compression="tiff_lzw")
    return buf.getvalue(), ".tiff"


# =============================================================================
# From PDF
# =============================================================================


def _docx_fallback(doc: pymupdf.Document, idx: list[int], out: Path) -> None:
    """Very plain DOCX from text blocks when pdf2docx chokes."""
    import docx

    d = docx.Document()
    for n, i in enumerate(idx):
        page = doc[i]
        for b in page.get_text("blocks"):
            if b[6] != 0:  # image block
                continue
            text = " ".join(b[4].split())
            if text:
                d.add_paragraph(text)
        if n < len(idx) - 1:
            d.add_page_break()
    d.save(str(out))


def pdf_to_docx_file(file_id: str, pages: str | None, password: str | None, progress: ProgressFn) -> ToolResult:
    doc = open_pdf(file_id, password)
    sf = store.get(file_id)
    idx = _page_indexes(doc, pages)
    warnings: list[str] = []
    out_id, out_path = store.output_path(with_suffix(sf.name, "", new_ext=".docx"))
    with tempfile.TemporaryDirectory(prefix="folio-docx-") as tmp:
        src = Path(tmp) / "input.pdf"
        sub = _subset(doc, idx)
        sub.save(src, garbage=1)
        sub.close()
        progress(0.1, "Converting with pdf2docx")
        try:
            from pdf2docx import Converter

            cv = Converter(str(src))
            try:
                cv.convert(str(out_path), start=0, end=len(idx))
            finally:
                cv.close()
            if not out_path.exists() or out_path.stat().st_size == 0:
                raise RuntimeError("pdf2docx produced no output")
        except Exception as e:  # noqa: BLE001 - fall back to a plain text docx
            warnings.append(f"Layout conversion failed ({type(e).__name__}); produced a text-only DOCX instead.")
            progress(0.6, "Falling back to text extraction")
            _docx_fallback(doc, idx, out_path)
    doc.close()
    progress(0.95, "Saving")
    out = store.register_output(
        out_id, out_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return ToolResult(outputs=[file_out(out)], data={"pages": len(idx)}, warnings=warnings)


@router.post("/pdf-to-docx", response_model=JobOut)
def pdf_to_docx(req: PdfRequest):
    ids = req.ids()
    for fid in ids:  # validate up-front so bad ids/passwords/page specs fail synchronously
        d = open_pdf(fid, req.password)
        try:
            _page_indexes(d, req.pages)
        finally:
            d.close()

    def work(progress: ProgressFn) -> ToolResult:
        result = ToolResult()
        for n, fid in enumerate(ids):
            sub_progress = _sub_progress(progress, n, len(ids))
            r = pdf_to_docx_file(fid, req.pages, req.password, sub_progress)
            result.outputs += r.outputs
            result.warnings += r.warnings
            result.data.setdefault("pages", 0)
            result.data["pages"] += r.data.get("pages", 0)
        return result

    return jobs.submit(work)


# ---- xlsx -------------------------------------------------------------------


def _clean_cell(v):
    if v is None:
        return None
    s = str(v).replace("\n", " ").strip()
    if s == "":
        return None
    try:
        if s.replace(",", "").replace(".", "", 1).lstrip("-").isdigit():
            return float(s.replace(",", "")) if "." in s else int(s.replace(",", ""))
    except ValueError:
        pass
    return s


def _plumber_tables(path: Path, password: str | None, idx: list[int]) -> dict[int, list[list[list]]]:
    try:
        import pdfplumber
    except ImportError:
        return {}
    out: dict[int, list[list[list]]] = {}
    try:
        with pdfplumber.open(str(path), password=password) as pdf:
            for i in idx:
                try:
                    tables = pdf.pages[i].extract_tables() or []
                except Exception:  # noqa: BLE001
                    tables = []
                tables = [t for t in tables if t and any(any(c for c in row) for row in t)]
                if tables:
                    out[i] = tables
    except Exception:  # noqa: BLE001 - pdfplumber is a best-effort fallback
        return {}
    return out


@router.post("/pdf-to-xlsx", response_model=ToolResult)
def pdf_to_xlsx(req: PdfRequest):
    from openpyxl import Workbook
    from openpyxl.utils import get_column_letter

    result = ToolResult()
    for fid in req.ids():
        sf = store.get(fid)
        doc = open_pdf(fid, req.password)
        idx = _page_indexes(doc, req.pages)
        wb = Workbook()
        wb.remove(wb.active)
        tables_found = 0
        text_pages = 0
        plumber: dict[int, list] | None = None
        for i in idx:
            page = doc[i]
            rows_sets: list[list[list]] = []
            try:
                for t in page.find_tables().tables:
                    rows = t.extract()
                    if rows and any(any(c for c in r) for r in rows):
                        rows_sets.append(rows)
            except Exception:  # noqa: BLE001
                rows_sets = []
            if not rows_sets:
                if plumber is None:
                    plumber = _plumber_tables(sf.fs_path, req.password, idx)
                rows_sets = plumber.get(i, [])
            if rows_sets:
                for k, rows in enumerate(rows_sets, 1):
                    tables_found += 1
                    ws = wb.create_sheet(f"Table_p{i + 1}_{k}"[:31])
                    for row in rows:
                        ws.append([_clean_cell(c) for c in row])
                    for col in range(1, ws.max_column + 1):
                        ws.column_dimensions[get_column_letter(col)].width = 18
            else:
                text_pages += 1
                ws = wb.create_sheet(f"Page_{i + 1}"[:31])
                for line in page.get_text("text").splitlines():
                    if line.strip():
                        ws.append([line.rstrip()])
                ws.column_dimensions["A"].width = 100
        doc.close()
        if not wb.sheetnames:
            wb.create_sheet("Empty")
        buf = io.BytesIO()
        wb.save(buf)
        out = _save_bytes(
            with_suffix(sf.name, "", new_ext=".xlsx"),
            buf.getvalue(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        result.outputs.append(file_out(out))
        result.data["tables_found"] = result.data.get("tables_found", 0) + tables_found
        if tables_found == 0:
            result.warnings.append(f"{sf.name}: no tables detected; page text was written line by line instead.")
        elif text_pages:
            result.warnings.append(f"{sf.name}: {text_pages} page(s) had no tables and were exported as text.")
    return result


# ---- pptx -------------------------------------------------------------------

_EMU_PER_PT = 12700
_MAX_SLIDE_EMU = 56 * 914400  # python-pptx hard limit


def _pptx_from_pdf(doc: pymupdf.Document, idx: list[int], mode: str) -> bytes:
    from pptx import Presentation
    from pptx.util import Emu, Pt

    prs = Presentation()
    first = doc[idx[0]].rect
    scale = min(1.0, _MAX_SLIDE_EMU / (max(first.width, first.height) * _EMU_PER_PT))
    prs.slide_width = Emu(int(first.width * _EMU_PER_PT * scale))
    prs.slide_height = Emu(int(first.height * _EMU_PER_PT * scale))
    blank = prs.slide_layouts[6]
    sw, sh = prs.slide_width, prs.slide_height

    for i in idx:
        page = doc[i]
        slide = prs.slides.add_slide(blank)
        # Per-page scale so differently sized pages still fit the (single) slide size.
        s = min(sw / (page.rect.width * _EMU_PER_PT), sh / (page.rect.height * _EMU_PER_PT))
        pw, ph = int(page.rect.width * _EMU_PER_PT * s), int(page.rect.height * _EMU_PER_PT * s)
        ox, oy = (sw - pw) // 2, (sh - ph) // 2

        def to_emu(r: pymupdf.Rect, s=s, ox=ox, oy=oy) -> tuple[int, int, int, int]:
            return (
                int(ox + r.x0 * _EMU_PER_PT * s),
                int(oy + r.y0 * _EMU_PER_PT * s),
                max(1, int(r.width * _EMU_PER_PT * s)),
                max(1, int(r.height * _EMU_PER_PT * s)),
            )

        if mode == "image":
            pix = page.get_pixmap(dpi=150, alpha=False)
            slide.shapes.add_picture(io.BytesIO(pix.tobytes("png")), Emu(ox), Emu(oy), Emu(pw), Emu(ph))
            continue

        # text mode: images first (behind text), then text boxes
        for info in page.get_images(full=True):
            xref = info[0]
            try:
                rects = page.get_image_rects(xref)
                if not rects:
                    continue
                pix = pymupdf.Pixmap(doc, xref)
                if pix.n - pix.alpha >= 4:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                data = pix.tobytes("png")
            except Exception:  # noqa: BLE001 - skip undecodable images
                continue
            for r in rects:
                r = r & page.rect
                if r.is_empty:
                    continue
                x, y, w, h = to_emu(r)
                slide.shapes.add_picture(io.BytesIO(data), Emu(x), Emu(y), Emu(w), Emu(h))

        d = page.get_text("dict")
        for block in d.get("blocks", []):
            if block.get("type") != 0:
                continue
            lines = block.get("lines", [])
            spans = [sp for ln in lines for sp in ln.get("spans", []) if sp.get("text", "").strip()]
            if not spans:
                continue
            x, y, w, h = to_emu(pymupdf.Rect(block["bbox"]))
            tb = slide.shapes.add_textbox(Emu(x), Emu(y), Emu(w), Emu(h))
            tf = tb.text_frame
            tf.word_wrap = True
            tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
            first_par = True
            for ln in lines:
                lspans = [sp for sp in ln.get("spans", []) if sp.get("text", "")]
                if not lspans:
                    continue
                p = tf.paragraphs[0] if first_par else tf.add_paragraph()
                first_par = False
                for sp in lspans:
                    run = p.add_run()
                    run.text = sp["text"]
                    run.font.size = Pt(max(4, sp.get("size", 11) * s))
                    flags = sp.get("flags", 0)
                    run.font.bold = bool(flags & 16)
                    run.font.italic = bool(flags & 2)
                    color = sp.get("color", 0)
                    if color:
                        from pptx.dml.color import RGBColor

                        run.font.color.rgb = RGBColor((color >> 16) & 255, (color >> 8) & 255, color & 255)
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


@router.post("/pdf-to-pptx", response_model=ToolResult)
def pdf_to_pptx(req: PptxRequest):
    result = ToolResult()
    for fid in req.ids():
        sf = store.get(fid)
        doc = open_pdf(fid, req.password)
        idx = _page_indexes(doc, req.pages)
        data = _pptx_from_pdf(doc, idx, req.mode)
        doc.close()
        out = _save_bytes(
            with_suffix(sf.name, "", new_ext=".pptx"),
            data,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        result.outputs.append(file_out(out))
        result.data["slides"] = result.data.get("slides", 0) + len(idx)
    return result


# ---- images -----------------------------------------------------------------


@router.post("/pdf-to-images", response_model=ToolResult)
def pdf_to_images(req: ImagesRequest):
    result = ToolResult()
    fmt = "jpeg" if req.format == "jpg" else req.format
    for fid in req.ids():
        sf = store.get(fid)
        stem = _stem(sf)
        doc = open_pdf(fid, req.password)
        idx = _page_indexes(doc, req.pages)
        files: list[StoredFile] = []
        if req.extract_embedded:
            seen: set[int] = set()
            n = 0
            for i in idx:
                for info in doc[i].get_images(full=True):
                    xref = info[0]
                    if xref in seen:
                        continue
                    seen.add(xref)
                    try:
                        pix = pymupdf.Pixmap(doc, xref)
                        if pix.n - pix.alpha >= 4:
                            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                        data, ext = _encode_pix(pix, fmt)
                    except Exception as e:  # noqa: BLE001
                        result.warnings.append(f"Image xref {xref} on page {i + 1} could not be decoded: {e}")
                        continue
                    n += 1
                    files.append(_save_bytes(f"{stem}-image-{n:03d}{ext}", data))
            if not files:
                result.warnings.append(f"{sf.name}: no embedded images found on the selected pages.")
            result.data["images"] = result.data.get("images", 0) + len(files)
        else:
            for i in idx:
                pix = doc[i].get_pixmap(dpi=req.dpi, alpha=False)
                data, ext = _encode_pix(pix, fmt)
                files.append(_save_bytes(f"{stem}-page-{i + 1:03d}{ext}", data))
            result.data["pages"] = result.data.get("pages", 0) + len(files)
        doc.close()
        result.outputs += [file_out(f) for f in _with_zip(f"{stem}-images", files)]
    return result


# ---- html -------------------------------------------------------------------

_HTML_CSS = """
body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#f3f4f6;color:#111}
main{max-width:900px;margin:0 auto;padding:24px 16px}
section.page{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15);padding:40px 48px;margin:0 0 24px;border-radius:4px}
section.page h6.pageno{color:#888;font-weight:normal;font-size:12px;margin:0 0 12px}
img{max-width:100%;height:auto}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}
pre,code{font-family:ui-monospace,Consolas,monospace;background:#f6f8fa}
"""


def _html_document(title: str, body: str) -> str:
    return (
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8">'
        f"<title>{html.escape(title)}</title><style>{_HTML_CSS}</style></head>\n<body><main>\n{body}\n</main></body></html>"
    )


@router.post("/pdf-to-html", response_model=ToolResult)
def pdf_to_html(req: HtmlOutRequest):
    result = ToolResult()
    for fid in req.ids():
        sf = store.get(fid)
        doc = open_pdf(fid, req.password)
        idx = _page_indexes(doc, req.pages)
        title = (doc.metadata or {}).get("title") or _stem(sf)
        if req.mode == "flow":
            md = pdf_to_markdown(doc, idx, embed_images=True)
            import markdown as mdlib

            body = mdlib.markdown(md, extensions=["tables", "fenced_code", "sane_lists"])
            body = f'<section class="page">{body}</section>'
        else:
            parts = []
            for i in idx:
                xhtml = doc[i].get_text("xhtml")  # images are base64-embedded by PyMuPDF
                parts.append(
                    f'<section class="page" id="page-{i + 1}"><h6 class="pageno">Page {i + 1}</h6>{xhtml}</section>'
                )
            body = "\n".join(parts)
        doc.close()
        page_html = _html_document(title, body).encode("utf-8")
        out = _save_bytes(with_suffix(sf.name, "", new_ext=".html"), page_html, "text/html")
        result.outputs.append(file_out(out))
        result.data["pages"] = result.data.get("pages", 0) + len(idx)
    return result


# ---- text -------------------------------------------------------------------


def _text_json(doc: pymupdf.Document, idx: list[int]) -> dict:
    pages = []
    for i in idx:
        page = doc[i]
        d = page.get_text("dict")
        blocks = []
        for b in d.get("blocks", []):
            if b.get("type") != 0:
                blocks.append({"type": "image", "bbox": [round(v, 2) for v in b["bbox"]]})
                continue
            lines = []
            for ln in b.get("lines", []):
                spans = [
                    {
                        "text": sp.get("text", ""),
                        "bbox": [round(v, 2) for v in sp["bbox"]],
                        "font": sp.get("font"),
                        "size": round(sp.get("size", 0), 2),
                        "color": f"#{sp.get('color', 0):06x}",
                        "bold": bool(sp.get("flags", 0) & 16),
                        "italic": bool(sp.get("flags", 0) & 2),
                    }
                    for sp in ln.get("spans", [])
                ]
                lines.append({"bbox": [round(v, 2) for v in ln["bbox"]], "spans": spans})
            blocks.append({"type": "text", "bbox": [round(v, 2) for v in b["bbox"]], "lines": lines})
        pages.append({"page": i + 1, "width": page.rect.width, "height": page.rect.height, "blocks": blocks})
    return {"pages": pages}


def _pdf_to_text(req: TextRequest, fmt: str) -> ToolResult:
    result = ToolResult()
    for fid in req.ids():
        sf = store.get(fid)
        doc = open_pdf(fid, req.password)
        idx = _page_indexes(doc, req.pages)
        if fmt == "txt":
            text = "\f".join(doc[i].get_text("text") for i in idx)
            out = _save_bytes(with_suffix(sf.name, "", new_ext=".txt"), text.encode("utf-8"), "text/plain")
            chars = len(text)
        elif fmt == "md":
            text = pdf_to_markdown(doc, idx)
            out = _save_bytes(with_suffix(sf.name, "", new_ext=".md"), text.encode("utf-8"), "text/markdown")
            chars = len(text)
        else:
            payload = _text_json(doc, idx)
            data = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
            out = _save_bytes(with_suffix(sf.name, "", new_ext=".json"), data, "application/json")
            chars = sum(
                len(sp["text"])
                for p in payload["pages"]
                for b in p["blocks"]
                if b["type"] == "text"
                for ln in b["lines"]
                for sp in ln["spans"]
            )
        doc.close()
        result.outputs.append(file_out(out))
        result.data["pages"] = result.data.get("pages", 0) + len(idx)
        result.data["characters"] = result.data.get("characters", 0) + chars
    return result


@router.post("/pdf-to-text", response_model=ToolResult)
def pdf_to_text(req: TextRequest):
    return _pdf_to_text(req, req.format)


@router.post("/pdf-to-markdown", response_model=ToolResult)
def pdf_to_markdown_endpoint(req: PdfRequest):
    return _pdf_to_text(TextRequest(**req.model_dump(), format="md"), "md")


# ---- PDF/A ------------------------------------------------------------------


def _pdfa_with_gs(gs: str, src: Path, dst: Path, level: str) -> None:
    """Ghostscript-only PDF/A conversion (used when tesseract/ocrmypdf is unavailable)."""
    cmd = [
        gs,
        "-dBATCH",
        "-dNOPAUSE",
        "-dQUIET",
        "-dNOSAFER",
        f"-dPDFA={level}",
        "-dPDFACompatibilityPolicy=1",
        "-sColorConversionStrategy=RGB",
        "-sDEVICE=pdfwrite",
        f"-sOutputFile={dst}",
        str(src),
    ]
    cp = pdfutil.run(cmd, timeout=600)
    if cp.returncode != 0 or not dst.exists():
        raise HTTPException(status_code=500, detail=f"Ghostscript failed: {cp.stderr[-800:]}")


@router.post("/pdf-to-pdfa", response_model=JobOut)
def pdf_to_pdfa(req: PdfaRequest):
    ids = req.ids()
    gs = ghostscript()
    level = req.level.rstrip("b")
    for fid in ids:
        open_pdf(fid, req.password).close()
    have_tess = pdfutil.find_binary(pdfutil.settings.tesseract_bin, "tesseract") is not None

    def work(progress: ProgressFn) -> ToolResult:
        result = ToolResult()
        for n, fid in enumerate(ids):
            sf = store.get(fid)
            progress(n / len(ids) + 0.05, f"Converting {sf.name} to PDF/A-{level}b")
            out_id, out_path = store.output_path(with_suffix(sf.name, "-pdfa"))
            with tempfile.TemporaryDirectory(prefix="folio-pdfa-") as tmp:
                src = sf.fs_path
                if req.password:
                    d = open_pdf(fid, req.password)
                    src = Path(tmp) / "decrypted.pdf"
                    d.save(src)
                    d.close()
                done = False
                if have_tess:
                    try:
                        import ocrmypdf

                        ocrmypdf.ocr(
                            str(src),
                            str(out_path),
                            skip_text=True,
                            output_type=f"pdfa-{level}",
                            progress_bar=False,
                            optimize=0,
                        )
                        done = out_path.exists()
                    except Exception as e:  # noqa: BLE001 - fall back to plain Ghostscript
                        result.warnings.append(
                            f"{sf.name}: ocrmypdf failed ({type(e).__name__}), used Ghostscript directly."
                        )
                if not done:
                    _pdfa_with_gs(gs, src, out_path, level)
            result.outputs.append(file_out(store.register_output(out_id, out_path, "application/pdf")))
        result.data["level"] = f"{level}b"
        return result

    return jobs.submit(work)


# =============================================================================
# To PDF
# =============================================================================

# ---- office -----------------------------------------------------------------


def office_to_pdf_file(file_id: str, progress: ProgressFn | None = None) -> StoredFile:
    """Convert one Office document with LibreOffice headless (synchronous)."""
    soffice = pdfutil.soffice()
    sf = store.get(file_id)
    with tempfile.TemporaryDirectory(prefix="folio-soffice-") as tmp:
        tmp_p = Path(tmp)
        profile = tmp_p / "profile"
        outdir = tmp_p / "out"
        outdir.mkdir()
        src = tmp_p / sf.name
        shutil.copyfile(sf.fs_path, src)
        cmd = [
            soffice,
            f"-env:UserInstallation={profile.resolve().as_uri()}",
            "--headless",
            "--norestore",
            "--nologo",
            "--convert-to",
            "pdf",
            "--outdir",
            str(outdir),
            str(src),
        ]
        if progress:
            progress(0.2, f"LibreOffice: {sf.name}")
        cp = pdfutil.run(cmd, timeout=300)
        produced = list(outdir.glob("*.pdf"))
        if cp.returncode != 0 or not produced:
            msg = (cp.stderr or cp.stdout or "").strip()[-600:]
            detail = f"LibreOffice could not convert {sf.name}: {msg or 'no output'}"
            raise HTTPException(status_code=500, detail=detail)
        out_id, out_path = store.output_path(with_suffix(sf.name, "", new_ext=".pdf"))
        shutil.move(str(produced[0]), out_path)
    return store.register_output(out_id, out_path, "application/pdf")


def _office_job(req: FilesRequest) -> JobOut:
    ids = req.ids()
    pdfutil.soffice()  # 501 early
    for fid in ids:
        store.get(fid)

    def work(progress: ProgressFn) -> ToolResult:
        result = ToolResult()
        for n, fid in enumerate(ids):
            out = office_to_pdf_file(fid, _sub_progress(progress, n, len(ids)))
            result.outputs.append(file_out(out))
        return result

    return jobs.submit(work)


@router.post("/office-to-pdf", response_model=JobOut)
def office_to_pdf(req: FilesRequest):
    return _office_job(req)


@router.post("/word-to-pdf", response_model=JobOut)
def word_to_pdf(req: FilesRequest):
    return _office_job(req)


@router.post("/excel-to-pdf", response_model=JobOut)
def excel_to_pdf(req: FilesRequest):
    return _office_job(req)


@router.post("/powerpoint-to-pdf", response_model=JobOut)
def powerpoint_to_pdf(req: FilesRequest):
    return _office_job(req)


# ---- images -----------------------------------------------------------------

_MAX_PAGE_PT = 14400.0  # PDF implementation limit (200 in)


def _image_frames(path: Path) -> list[Image.Image]:
    """All frames of an image file (multi-page TIFF -> several), EXIF-rotated, loaded in memory."""
    frames: list[Image.Image] = []
    with Image.open(path) as im:
        n = getattr(im, "n_frames", 1)
        if n > 1:
            for frame in ImageSequence.Iterator(im):
                f = frame.copy()
                f.info["dpi"] = im.info.get("dpi")
                frames.append(f)
        else:
            f = ImageOps.exif_transpose(im) or im
            f = f.copy()
            f.info["dpi"] = im.info.get("dpi")
            frames.append(f)
    return frames


def _normalize(img: Image.Image) -> tuple[bytes, float, float]:
    """Return (encoded bytes, width_pt, height_pt) for one image."""
    dpi = img.info.get("dpi") or (72, 72)
    try:
        dx, dy = float(dpi[0]) or 72.0, float(dpi[1]) or 72.0
    except (TypeError, ValueError, IndexError):
        dx = dy = 72.0
    dx, dy = (dx if 10 <= dx <= 2400 else 72.0), (dy if 10 <= dy <= 2400 else 72.0)
    w_pt, h_pt = img.width * 72.0 / dx, img.height * 72.0 / dy
    if img.mode in ("1", "L", "LA", "I;16", "I"):
        img = img.convert("L")
    elif img.mode != "RGB":
        if img.mode in ("RGBA", "LA", "P", "PA"):
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[-1])
            img = bg
        else:
            img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92, optimize=True)
    return buf.getvalue(), w_pt, h_pt


def images_to_pdf(
    file_ids: list[str],
    page_size: str = "fit",
    margin: float = 0.0,
    orientation: str = "auto",
    preprocess: Callable[[Image.Image], Image.Image] | None = None,
    out_name: str | None = None,
) -> tuple[StoredFile, list[str]]:
    """Build a PDF (one page per image/frame) from stored image files. Returns (file, warnings)."""
    warnings: list[str] = []
    doc = pymupdf.open()
    names: list[str] = []
    for fid in file_ids:
        sf = store.get(fid)
        names.append(sf.name)
        try:
            frames = _image_frames(sf.fs_path)
        except Exception as e:  # noqa: BLE001
            doc.close()
            raise HTTPException(status_code=400, detail=f"{sf.name} is not a readable image: {e}") from e
        for img in frames:
            if preprocess:
                dpi = img.info.get("dpi")
                img = preprocess(img)
                img.info["dpi"] = dpi
            data, w_pt, h_pt = _normalize(img)
            if page_size.lower() == "fit":
                pw, ph = w_pt + 2 * margin, h_pt + 2 * margin
                k = min(1.0, _MAX_PAGE_PT / max(pw, ph))
                pw, ph = pw * k, ph * k
            else:
                rect = pymupdf.paper_rect(page_size.lower())
                pw, ph = rect.width, rect.height
                want_landscape = (orientation == "landscape") or (orientation == "auto" and w_pt > h_pt)
                if want_landscape != (pw > ph):
                    pw, ph = ph, pw
            page = doc.new_page(width=pw, height=ph)
            box = pymupdf.Rect(margin, margin, pw - margin, ph - margin)
            if box.is_empty or box.width <= 0 or box.height <= 0:
                box = page.rect
            page.insert_image(box, stream=data, keep_proportion=True)
    if doc.page_count == 0:
        doc.close()
        raise HTTPException(status_code=400, detail="No images to convert")
    if out_name is None:
        out_name = with_suffix(names[0], "", new_ext=".pdf") if len(names) == 1 else "images.pdf"
    sf_out = pdfutil.save_doc(doc, out_name)
    doc.close()
    return sf_out, warnings


@router.post("/images-to-pdf", response_model=ToolResult)
def images_to_pdf_endpoint(req: ImagesToPdfRequest):
    out, warnings = images_to_pdf(req.ids(), req.page_size, req.margin, req.orientation)
    return ToolResult(outputs=[file_out(out)], warnings=warnings)


# ---- html -------------------------------------------------------------------


def _weasyprint():
    """Import WeasyPrint lazily: on Windows the GTK/Pango native libs are often missing."""
    try:
        import weasyprint

        return weasyprint
    except (ImportError, OSError) as e:
        raise HTTPException(
            status_code=501,
            detail=(
                "HTML to PDF needs WeasyPrint's native libraries (Pango/GObject), which are not available here. "
                f"Use the Docker image. ({type(e).__name__}: {str(e)[:120]})"
            ),
        ) from e


def _check_url(url: str) -> str:
    """SSRF guard: only http(s) to public hosts."""
    try:
        p = urlparse(url.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid URL") from e
    if p.scheme not in ("http", "https") or not p.hostname:
        raise HTTPException(status_code=400, detail="Only http:// and https:// URLs are allowed")
    host = p.hostname.lower().strip("[]")
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local") or host.endswith(".internal"):
        raise HTTPException(status_code=400, detail="URLs pointing at local or private hosts are not allowed")
    addrs: list[str] = []
    try:
        addrs.append(str(ipaddress.ip_address(host)))
    except ValueError:
        try:
            addrs = [ai[4][0] for ai in socket.getaddrinfo(host, p.port or 80, proto=socket.IPPROTO_TCP)]
        except OSError as e:
            raise HTTPException(status_code=400, detail=f"Could not resolve host {host}") from e
    for a in addrs:
        try:
            ip = ipaddress.ip_address(a.split("%")[0])
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
            or (ip.version == 6 and ip.ipv4_mapped and _is_private4(ip.ipv4_mapped))
        ):
            raise HTTPException(status_code=400, detail="URLs pointing at local or private hosts are not allowed")
    return p.geturl()


def _is_private4(ip: ipaddress.IPv4Address) -> bool:
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified


def html_to_pdf_bytes(html_src: str, base_url: str | None, page_size: str = "A4", landscape: bool = False) -> bytes:
    wp = _weasyprint()
    size = page_size.upper() if page_size.lower() == "a4" else page_size.capitalize()
    css = wp.CSS(string=f"@page{{size:{size}{' landscape' if landscape else ''};margin:16mm}}")
    try:
        return wp.HTML(string=html_src, base_url=base_url).write_pdf(stylesheets=[css])
    except OSError as e:  # native lib failure at render time
        raise HTTPException(status_code=501, detail=f"WeasyPrint rendering failed: {e}") from e


def _fetch_url(url: str) -> tuple[str, str]:
    import httpx

    try:
        with httpx.Client(follow_redirects=True, timeout=20.0, headers={"User-Agent": "Folio PDF"}) as c:
            r = c.get(url)
            r.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch URL: {e}") from e
    final = str(r.url)
    _check_url(final)  # redirects must stay public too
    return r.text, final


def html_file_to_pdf(file_id: str, page_size: str = "A4", landscape: bool = False) -> StoredFile:
    sf = store.get(file_id)
    src = sf.fs_path.read_text(encoding="utf-8", errors="replace")
    pdf = html_to_pdf_bytes(src, sf.fs_path.parent.as_uri() + "/", page_size, landscape)
    return _save_bytes(with_suffix(sf.name, "", new_ext=".pdf"), pdf, "application/pdf")


@router.post("/html-to-pdf", response_model=JobOut)
def html_to_pdf(req: HtmlToPdfRequest):
    if not (req.file_id or req.url or req.html):
        raise HTTPException(status_code=400, detail="Provide file_id, url or html")
    url = _check_url(req.url) if req.url else None
    if req.file_id:
        store.get(req.file_id)
    _weasyprint()  # 501 early if the runtime is missing

    def work(progress: ProgressFn) -> ToolResult:
        progress(0.1, "Preparing HTML")
        if req.file_id:
            out = html_file_to_pdf(req.file_id, req.page_size, req.landscape)
        elif url:
            progress(0.2, "Fetching page")
            text, final = _fetch_url(url)
            progress(0.5, "Rendering")
            name = (urlparse(final).hostname or "page").replace(".", "-") + ".pdf"
            out = _save_bytes(name, html_to_pdf_bytes(text, final, req.page_size, req.landscape), "application/pdf")
        else:
            progress(0.3, "Rendering")
            out = _save_bytes(
                "document.pdf", html_to_pdf_bytes(req.html or "", None, req.page_size, req.landscape), "application/pdf"
            )
        return ToolResult(outputs=[file_out(out)])

    return jobs.submit(work)


# ---- text / markdown ---------------------------------------------------------

_STORY_CSS = """
body{font-family:sans-serif;line-height:1.35}
h1{font-size:1.8em;margin:0.6em 0 0.3em}h2{font-size:1.45em;margin:0.6em 0 0.3em}
h3{font-size:1.2em;margin:0.5em 0 0.25em}
p{margin:0 0 0.55em}pre{font-family:monospace;font-size:0.9em;background:#f3f3f3;padding:6px}
code{font-family:monospace;font-size:0.9em}
table{border-collapse:collapse;margin:0.4em 0}td,th{border:1px solid #999;padding:3px 6px}th{background:#eee}
blockquote{border-left:3px solid #bbb;margin:0.4em 0;padding-left:10px;color:#444}
ul,ol{margin:0 0 0.5em}
"""


def _csv_to_html(text: str) -> str:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return "<p></p>"
    out = ["<table>"]
    for n, row in enumerate(rows):
        tag = "th" if n == 0 else "td"
        out.append("<tr>" + "".join(f"<{tag}>{html.escape(c)}</{tag}>" for c in row) + "</tr>")
    out.append("</table>")
    return "\n".join(out)


def _plain_to_html(text: str) -> str:
    parts = []
    for line in text.replace("\r\n", "\n").split("\n"):
        parts.append(f"<p>{html.escape(line) if line.strip() else '&nbsp;'}</p>")
    return "\n".join(parts)


def story_to_pdf(body_html: str, font_size: float = 11, page_size: str = "A4", margin_pt: float = 54) -> bytes:
    """Lay out HTML into a paginated PDF using PyMuPDF's Story (no external deps)."""
    rect = pymupdf.paper_rect(PAGE_SIZES.get(page_size.lower(), "a4"))
    where = rect + (margin_pt, margin_pt, -margin_pt, -margin_pt)
    story = pymupdf.Story(html=f"<html><body>{body_html}</body></html>", user_css=_STORY_CSS, em=font_size)
    buf = io.BytesIO()
    writer = pymupdf.DocumentWriter(buf)
    more = True
    pages = 0
    while more and pages < 5000:
        dev = writer.begin_page(rect)
        more, filled = story.place(where)
        story.draw(dev)
        writer.end_page()
        pages += 1
        if pymupdf.Rect(filled).is_empty and more:  # nothing fits (oversized element): stop rather than spin
            break
    writer.close()
    return buf.getvalue()


def text_to_pdf_bytes(text: str, kind: str, font_size: float = 11, page_size: str = "A4") -> bytes:
    if kind == "md":
        import markdown as mdlib

        body = mdlib.markdown(text, extensions=["tables", "fenced_code", "sane_lists", "nl2br"])
    elif kind == "csv":
        body = _csv_to_html(text)
    else:
        body = _plain_to_html(text)
    return story_to_pdf(body, font_size, page_size)


def text_file_to_pdf(
    file_id: str, markdown: bool | None = None, font_size: float = 11, page_size: str = "A4"
) -> StoredFile:
    sf = store.get(file_id)
    ext = Path(sf.name).suffix.lower()
    text = sf.fs_path.read_bytes().decode("utf-8-sig", errors="replace")
    if ext == ".csv":
        kind = "csv"
    elif markdown is True or (markdown is None and ext in (".md", ".markdown")):
        kind = "md"
    else:
        kind = "txt"
    data = text_to_pdf_bytes(text, kind, font_size, page_size)
    return _save_bytes(with_suffix(sf.name, "", new_ext=".pdf"), data, "application/pdf")


@router.post("/text-to-pdf", response_model=ToolResult)
def text_to_pdf(req: TextToPdfRequest):
    if req.file_id:
        out = text_file_to_pdf(req.file_id, req.markdown, req.font_size, req.page_size)
    elif req.text is not None:
        data = text_to_pdf_bytes(req.text, "md" if req.markdown else "txt", req.font_size, req.page_size)
        out = _save_bytes("text.pdf", data, "application/pdf")
    else:
        raise HTTPException(status_code=400, detail="Provide file_id or text")
    return ToolResult(outputs=[file_out(out)])


# ---- any -> pdf dispatcher ---------------------------------------------------


def _sniff_kind(sf: StoredFile) -> str:
    ext = Path(sf.name).suffix.lower()
    with sf.fs_path.open("rb") as f:
        head = f.read(2048)
    if head.startswith(b"%PDF") or ext == ".pdf":
        return "pdf"
    if ext in IMAGE_EXTS or sf.content_type.startswith("image/"):
        return "image"
    if ext in OFFICE_EXTS:
        return "office"
    if ext in HTML_EXTS or sf.content_type in ("text/html", "application/xhtml+xml"):
        return "html"
    if ext in TEXT_EXTS or sf.content_type.startswith("text/"):
        return "text"
    low = head.lower()
    if b"<html" in low or b"<!doctype html" in low:
        return "html"
    try:
        with Image.open(sf.fs_path) as im:
            im.verify()
        return "image"
    except Exception:  # noqa: BLE001
        pass
    if head.startswith(b"PK\x03\x04") or head.startswith(b"\xd0\xcf\x11\xe0") or head.startswith(b"{\\rtf"):
        return "office"
    try:
        head.decode("utf-8")
        return "text"
    except UnicodeDecodeError:
        return "unknown"


def to_pdf(file_id: str, progress: ProgressFn | None = None) -> StoredFile:
    """Convert any supported stored file to a PDF (synchronously; Office/HTML may be slow).

    PDFs are returned as-is (same StoredFile).
    """
    sf = store.get(file_id)
    kind = _sniff_kind(sf)
    if kind == "pdf":
        return sf
    if kind == "image":
        return images_to_pdf([file_id])[0]
    if kind == "office":
        return office_to_pdf_file(file_id, progress)
    if kind == "html":
        return html_file_to_pdf(file_id)
    if kind == "text":
        return text_file_to_pdf(file_id)
    raise HTTPException(status_code=400, detail=f"Don't know how to convert {sf.name} to PDF")


@router.post("/any-to-pdf", response_model=JobOut)
def any_to_pdf(req: AnyToPdfRequest):
    sf = store.get(req.file_id)
    kind = _sniff_kind(sf)
    if kind == "office":
        pdfutil.soffice()
    elif kind == "html":
        _weasyprint()
    elif kind == "unknown":
        raise HTTPException(status_code=400, detail=f"Don't know how to convert {sf.name} to PDF")

    def work(progress: ProgressFn) -> ToolResult:
        progress(0.05, f"Converting {sf.name}")
        out = to_pdf(req.file_id, progress)
        return ToolResult(outputs=[file_out(out)], data={"kind": kind})

    return jobs.submit(work)
