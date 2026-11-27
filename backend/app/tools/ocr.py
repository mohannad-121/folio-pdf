"""OCR tools built on Tesseract (via ocrmypdf / PyMuPDF / pytesseract).

Everything that actually recognises text needs the Tesseract binary (and ocrmypdf also
needs Ghostscript). Those endpoints raise HTTP 501 when the binaries are missing;
``/detect`` and ``/languages`` always work.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path

import pymupdf
from fastapi import APIRouter, HTTPException
from PIL import Image, ImageFilter, ImageOps
from pydantic import BaseModel, Field

from .. import pdfutil
from ..config import settings
from ..jobs import ProgressFn, jobs
from ..pdfutil import file_out, open_pdf, with_suffix
from ..schemas import JobOut, ToolResult, parse_page_spec
from ..storage import store
from .convert import PdfRequest, _save_bytes, have_ghostscript, images_to_pdf

router = APIRouter(prefix="/api/ocr", tags=["ocr"])


# ---- models -----------------------------------------------------------------


class OcrRequest(PdfRequest):
    language: str = settings.ocr_languages or "eng"
    deskew: bool = True
    rotate: bool = True
    force: bool = False
    clean: bool = False
    optimize: int = Field(1, ge=0, le=3)


class ScanRequest(BaseModel):
    file_id: str | None = None
    file_ids: list[str] | None = None
    ocr: bool = True
    deskew: bool = True
    language: str = settings.ocr_languages or "eng"
    enhance: bool = True

    def ids(self) -> list[str]:
        ids = list(self.file_ids or [])
        if self.file_id and self.file_id not in ids:
            ids.insert(0, self.file_id)
        if not ids:
            raise HTTPException(status_code=400, detail="file_id or file_ids is required")
        return ids


class ExtractTextRequest(PdfRequest):
    language: str = settings.ocr_languages or "eng"


class DetectRequest(BaseModel):
    file_id: str
    password: str | None = None


# ---- helpers ----------------------------------------------------------------


def _have_tesseract() -> bool:
    return pdfutil.find_binary(settings.tesseract_bin, "tesseract") is not None


def _languages(spec: str) -> list[str]:
    langs = [x.strip() for x in re.split(r"[+,\s]+", spec or "") if x.strip()]
    return langs or ["eng"]


def _tessdata_dir(tess_bin: str) -> str | None:
    """Locate the tessdata folder so PyMuPDF's built-in OCR can be used."""
    env = os.environ.get("TESSDATA_PREFIX")
    if env and Path(env).is_dir():
        return env
    candidates = [Path(tess_bin).resolve().parent / "tessdata"]
    for root in ("/usr/share/tesseract-ocr", "/usr/share", "/usr/local/share", "/opt/homebrew/share"):
        candidates += list(Path(root).glob("*/tessdata")) if Path(root).exists() else []
        candidates.append(Path(root) / "tessdata")
    for c in candidates:
        if c.is_dir() and any(c.glob("*.traineddata")):
            return str(c)
    try:
        return pymupdf.get_tessdata()
    except Exception:  # noqa: BLE001
        return None


def _require_ocr_stack() -> None:
    pdfutil.tesseract()
    if not have_ghostscript():
        raise HTTPException(
            status_code=501,
            detail="Ghostscript is not installed. OCR via ocrmypdf needs Ghostscript (use the Docker image).",
        )


def run_ocrmypdf(
    src: Path,
    dst: Path,
    *,
    language: str,
    deskew: bool,
    rotate: bool,
    force: bool,
    clean: bool,
    optimize: int,
) -> list[str]:
    """Run ocrmypdf; returns warnings. Copies the input when it already has text (and not forced)."""
    import ocrmypdf
    from ocrmypdf.exceptions import PriorOcrFoundError

    warnings: list[str] = []
    kwargs = dict(
        language=_languages(language),
        deskew=deskew,
        rotate_pages=rotate,
        force_ocr=force,
        skip_text=not force,
        clean=clean and shutil.which("unpaper") is not None,
        optimize=optimize,
        progress_bar=False,
    )
    if clean and not kwargs["clean"]:
        warnings.append("'clean' requested but unpaper is not installed; skipped.")
    try:
        ocrmypdf.ocr(str(src), str(dst), **kwargs)
    except PriorOcrFoundError:
        shutil.copyfile(src, dst)
        warnings.append("Document already contains text; returned unchanged (use force to re-OCR).")
    except Exception as e:  # noqa: BLE001
        from ocrmypdf import exceptions as oex

        if isinstance(e, oex.MissingDependencyError):
            raise HTTPException(status_code=501, detail=f"OCR dependency missing: {e}") from e
        if isinstance(e, oex.EncryptedPdfError):
            raise HTTPException(status_code=401, detail="PDF is password protected") from e
        raise HTTPException(status_code=500, detail=f"OCR failed: {type(e).__name__}: {str(e)[:400]}") from e
    return warnings


# ---- endpoints --------------------------------------------------------------


@router.post("/pdf", response_model=JobOut)
def ocr_pdf(req: OcrRequest):
    ids = req.ids()
    _require_ocr_stack()
    for fid in ids:
        open_pdf(fid, req.password).close()

    def work(progress: ProgressFn) -> ToolResult:
        result = ToolResult()
        total_pages = 0
        for n, fid in enumerate(ids):
            sf = store.get(fid)
            base = n / len(ids)
            progress(base + 0.1 / len(ids), f"OCR: {sf.name}")
            out_id, out_path = store.output_path(with_suffix(sf.name, "-ocr"))
            with tempfile.TemporaryDirectory(prefix="folio-ocr-") as tmp:
                src = sf.fs_path
                if req.password:
                    d = open_pdf(fid, req.password)
                    src = Path(tmp) / "decrypted.pdf"
                    d.save(src)
                    d.close()
                warns = run_ocrmypdf(
                    src,
                    out_path,
                    language=req.language,
                    deskew=req.deskew,
                    rotate=req.rotate,
                    force=req.force,
                    clean=req.clean,
                    optimize=req.optimize,
                )
            progress(base + 0.95 / len(ids), "Saving")
            result.warnings += [f"{sf.name}: {w}" for w in warns] if len(ids) > 1 else warns
            out = store.register_output(out_id, out_path, "application/pdf")
            total_pages += pdfutil.pdf_page_count(out.fs_path)
            result.outputs.append(file_out(out))
        result.data = {"pages": total_pages, "languages": _languages(req.language)}
        return result

    return jobs.submit(work)


def enhance_scan(img: Image.Image) -> Image.Image:
    """Grayscale + autocontrast + mild sharpen: cheap 'scanner' look for phone photos."""
    g = ImageOps.exif_transpose(img) or img
    g = g.convert("L")
    g = ImageOps.autocontrast(g, cutoff=1)
    g = g.filter(ImageFilter.UnsharpMask(radius=1.5, percent=120, threshold=3))
    return g


@router.post("/scan-to-pdf", response_model=JobOut)
def scan_to_pdf(req: ScanRequest):
    ids = req.ids()
    for fid in ids:
        store.get(fid)

    def work(progress: ProgressFn) -> ToolResult:
        progress(0.05, "Building PDF from images")
        name = with_suffix(store.get(ids[0]).name, "-scan", new_ext=".pdf") if len(ids) == 1 else "scan.pdf"
        pdf, warnings = images_to_pdf(
            ids, "fit", 0, "auto", preprocess=enhance_scan if req.enhance else None, out_name=name
        )
        data = {"pages": pdfutil.pdf_page_count(pdf.fs_path), "ocr": False}
        if not req.ocr:
            return ToolResult(outputs=[file_out(pdf)], data=data, warnings=warnings)
        if not (_have_tesseract() and have_ghostscript()):
            warnings.append(
                "OCR skipped: Tesseract/Ghostscript are not installed on this server; the PDF is not searchable."
            )
            return ToolResult(outputs=[file_out(pdf)], data=data, warnings=warnings)
        progress(0.3, "Recognising text")
        out_id, out_path = store.output_path(pdf.name)
        warnings += run_ocrmypdf(
            pdf.fs_path,
            out_path,
            language=req.language,
            deskew=req.deskew,
            rotate=req.deskew,
            force=True,
            clean=False,
            optimize=1,
        )
        progress(0.95, "Saving")
        out = store.register_output(out_id, out_path, "application/pdf")
        store.delete(pdf.file_id)
        data.update(ocr=True, languages=_languages(req.language))
        return ToolResult(outputs=[file_out(out)], data=data, warnings=warnings)

    return jobs.submit(work)


def ocr_page_text(page: pymupdf.Page, language: str, tess_bin: str, tessdata: str | None, dpi: int = 300) -> str:
    """OCR one page to text: PyMuPDF's Tesseract binding first, pytesseract as fallback."""
    lang = "+".join(_languages(language))
    if tessdata:
        try:
            tp = page.get_textpage_ocr(language=lang, dpi=dpi, full=True, tessdata=tessdata)
            return page.get_text("text", textpage=tp)
        except Exception:  # noqa: BLE001 - fall through to pytesseract
            pass
    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = tess_bin
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    img = Image.frombytes("RGB" if pix.n >= 3 else "L", (pix.width, pix.height), pix.samples)
    return pytesseract.image_to_string(img, lang=lang)


@router.post("/extract-text", response_model=ToolResult)
def extract_text(req: ExtractTextRequest):
    tess = pdfutil.tesseract()
    tessdata = _tessdata_dir(tess)
    result = ToolResult()
    texts: list[str] = []
    for fid in req.ids():
        sf = store.get(fid)
        doc = open_pdf(fid, req.password)
        try:
            idx = parse_page_spec(req.pages or "all", doc.page_count)
        except ValueError as e:
            doc.close()
            raise HTTPException(status_code=400, detail=str(e)) from e
        per_page = [ocr_page_text(doc[i], req.language, tess, tessdata) for i in idx]
        doc.close()
        texts += per_page
        txt = "\f".join(per_page).encode("utf-8")
        out = _save_bytes(with_suffix(sf.name, "-ocr", new_ext=".txt"), txt, "text/plain")
        result.outputs.append(file_out(out))
    result.data = {
        "text_per_page": texts,
        "languages": _languages(req.language),
        "engine": "pymupdf" if tessdata else "pytesseract",
    }
    return result


@router.get("/languages")
def languages():
    tess = pdfutil.find_binary(settings.tesseract_bin, "tesseract")
    if not tess:
        return {"available": False, "languages": []}
    cp = pdfutil.run([tess, "--list-langs"], timeout=30)
    out = (cp.stdout or "") + "\n" + (cp.stderr or "")
    langs = sorted({ln.strip() for ln in out.splitlines() if re.fullmatch(r"[a-z]{3}(_[A-Za-z]+)?", ln.strip())})
    return {"available": True, "languages": langs, "default": _languages(settings.ocr_languages)}


@router.post("/detect")
def detect(req: DetectRequest):
    doc = open_pdf(req.file_id, req.password)
    pages = []
    scanned = 0
    for i, page in enumerate(doc):
        has_text = bool(page.get_text("text").strip())
        area = page.rect.get_area() or 1.0
        coverage = 0.0
        try:
            for info in page.get_image_info():
                r = pymupdf.Rect(info["bbox"]) & page.rect
                coverage = max(coverage, r.get_area() / area)
        except Exception:  # noqa: BLE001
            pass
        likely = (not has_text) and coverage > 0.7
        scanned += likely
        pages.append(
            {"page": i + 1, "has_text": has_text, "image_coverage": round(coverage, 3), "likely_scanned": likely}
        )
    doc.close()
    return {"pages": pages, "page_count": len(pages), "scanned_pages": scanned, "needs_ocr": scanned > 0}
