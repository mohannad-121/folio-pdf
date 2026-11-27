"""Optimize tools: compress, repair, flatten, grayscale, linearize, remove blank pages."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Literal

import pikepdf
import pymupdf
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from ..jobs import ProgressFn, jobs
from ..pdfutil import file_out, open_pdf, save_doc, with_suffix
from ..schemas import JobOut, ToolResult
from ..storage import StoredFile, store

router = APIRouter(prefix="/api/optimize", tags=["optimize"])

LOSSLESS_SAVE = {"garbage": 4, "deflate": True, "deflate_images": True, "deflate_fonts": True, "clean": True}


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


def _pikepdf_pass(path: Path, linearize: bool = False) -> None:
    """Rewrite ``path`` in place with object streams + recompressed flate streams."""
    tmp = path.with_suffix(".tmp.pdf")
    try:
        with pikepdf.open(path) as pdf:
            pdf.save(
                tmp,
                object_stream_mode=pikepdf.ObjectStreamMode.generate,
                compress_streams=True,
                recompress_flate=True,
                linearize=linearize,
            )
        tmp.replace(path)
    except Exception:  # noqa: BLE001 - pikepdf is a bonus pass; keep the pymupdf output
        tmp.unlink(missing_ok=True)


# ---- compress -------------------------------------------------------------------

_LEVELS: dict[str, tuple[int | None, int, bool]] = {
    # level: (target dpi or None for lossless only, jpeg quality, grayscale)
    "low": (None, 85, False),
    "medium": (150, 80, False),
    "high": (110, 65, False),
    "extreme": (72, 50, True),
}


class CompressRequest(_Base):
    level: Literal["low", "medium", "high", "extreme"] = "medium"
    remove_metadata: bool = False


def _recompress_images(doc: pymupdf.Document, dpi: int, quality: int, gray: bool, progress: ProgressFn) -> int:
    """Downsample/recompress page images in place. Returns the number of images replaced."""
    done: set[int] = set()
    replaced = 0
    for pno, page in enumerate(doc):
        progress(0.1 + 0.7 * pno / max(doc.page_count, 1), f"Optimizing images on page {pno + 1}")
        infos = page.get_image_info(xrefs=True)
        for info in infos:
            xref = info.get("xref", 0)
            if not xref or xref in done:
                continue
            done.add(xref)
            try:
                _recompress_one(doc, page, info, xref, dpi, quality, gray)
                replaced += 1
            except Exception:  # noqa: BLE001 - skip images we cannot handle
                continue
    return replaced


def _recompress_one(doc, page, info, xref, dpi, quality, gray) -> None:
    w, h = info.get("width", 0), info.get("height", 0)
    if w < 64 or h < 64:
        raise ValueError("tiny")
    if info.get("bpc", 8) == 1:
        raise ValueError("stencil")
    if doc.xref_get_key(xref, "SMask")[0] != "null" or doc.xref_get_key(xref, "ImageMask")[1] == "true":
        raise ValueError("mask")
    bbox = pymupdf.Rect(info["bbox"])
    if bbox.is_empty:
        raise ValueError("no bbox")
    # Effective resolution: image pixels per inch of displayed page area.
    eff_dpi = min(w / (bbox.width / 72.0), h / (bbox.height / 72.0))
    scale = min(1.0, dpi / eff_dpi) if eff_dpi > dpi else 1.0
    extracted = doc.extract_image(xref)
    if not extracted:
        raise ValueError("no stream")
    img = Image.open(io.BytesIO(extracted["image"]))
    if img.mode in ("P", "LA", "RGBA", "CMYK", "I;16", "I"):
        img = img.convert("L" if gray else "RGB")
    if gray and img.mode != "L":
        img = img.convert("L")
    elif img.mode not in ("L", "RGB"):
        img = img.convert("RGB")
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    elif extracted.get("ext") == "jpeg" and not gray and quality >= 80:
        raise ValueError("already small jpeg")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=False)
    if len(buf.getvalue()) >= len(extracted["image"]) and scale >= 1.0:
        raise ValueError("not smaller")
    page.replace_image(xref, stream=buf.getvalue())


def _compress_one(fid: str, req: CompressRequest, progress: ProgressFn) -> tuple[StoredFile, dict, list[str]]:
    src = store.get(fid)
    doc = open_pdf(fid, req.password)
    original_size = src.size
    warnings: list[str] = []
    dpi, quality, gray = _LEVELS[req.level]
    out_name = with_suffix(src.name, "-compressed")

    if req.remove_metadata:
        doc.scrub(
            attached_files=False,
            embedded_files=False,
            hidden_text=False,
            javascript=False,
            redactions=False,
            remove_links=False,
            reset_fields=False,
            reset_responses=False,
            clean_pages=False,
            thumbnails=True,
            metadata=True,
            xml_metadata=True,
        )
    if dpi is not None:
        _recompress_images(doc, dpi, quality, gray, progress)
    progress(0.85, "Subsetting fonts")
    try:
        doc.subset_fonts()
    except Exception:  # noqa: BLE001
        pass
    progress(0.9, "Writing")
    sf = save_doc(doc, out_name, **LOSSLESS_SAVE)
    doc.close()
    _pikepdf_pass(sf.fs_path)
    sf = store.register_output(sf.file_id, sf.fs_path, "application/pdf")

    if sf.size >= original_size:
        # Lossless fallback: re-save the original without image changes.
        warnings.append("Compression did not reduce the file; returning a losslessly optimized copy instead.")
        doc = open_pdf(fid, req.password)
        if req.remove_metadata:
            doc.scrub(
                attached_files=False,
                embedded_files=False,
                hidden_text=False,
                javascript=False,
                redactions=False,
                remove_links=False,
                reset_fields=False,
                reset_responses=False,
                clean_pages=False,
            )
        doc.save(sf.fs_path, **LOSSLESS_SAVE)
        doc.close()
        _pikepdf_pass(sf.fs_path)
        sf = store.register_output(sf.file_id, sf.fs_path, "application/pdf")
        if sf.size > original_size:
            # Still bigger (already optimal): return the original bytes.
            sf.fs_path.write_bytes(src.fs_path.read_bytes())
            sf = store.register_output(sf.file_id, sf.fs_path, "application/pdf")
            warnings[-1] = "The file is already optimized; returned unchanged."
    saved = round(100.0 * (original_size - sf.size) / original_size, 2) if original_size else 0.0
    data = {"original_size": original_size, "compressed_size": sf.size, "saved_percent": max(0.0, saved)}
    return sf, data, warnings


@router.post("/compress", response_model=JobOut)
def compress(req: CompressRequest):
    ids = req.ids()
    for fid in ids:  # validate up-front so bad input fails fast (400/401/404)
        open_pdf(fid, req.password).close()

    def work(progress: ProgressFn) -> ToolResult:
        outputs, per_file, warnings = [], [], []
        for i, fid in enumerate(ids):

            def sub(frac: float, msg: str = "", _i=i) -> None:
                progress((_i + frac) / len(ids), msg)

            sf, data, warn = _compress_one(fid, req, sub)
            outputs.append(file_out(sf))
            per_file.append({"file_id": sf.file_id, **data})
            warnings += [f"{store.get(fid).name}: {w}" for w in warn]
        data = dict(per_file[0]) if len(per_file) == 1 else {}
        data["files"] = per_file
        data["original_size"] = sum(p["original_size"] for p in per_file)
        data["compressed_size"] = sum(p["compressed_size"] for p in per_file)
        tot = data["original_size"]
        data["saved_percent"] = round(100.0 * (tot - data["compressed_size"]) / tot, 2) if tot else 0.0
        return ToolResult(outputs=outputs, data=data, warnings=warnings)

    return jobs.submit(work)


# ---- repair ------------------------------------------------------------------------


class FileRequest(_Base):
    pass


@router.post("/repair", response_model=JobOut)
def repair(req: FileRequest):
    fid = req.ids()[0]
    src = store.get(fid)

    def work(progress: ProgressFn) -> ToolResult:
        progress(0.1, "Rebuilding cross-reference table")
        out_id, out_path = store.output_path(with_suffix(src.name, "-repaired"))
        warnings: list[str] = []
        repaired_with = None
        try:
            with pikepdf.open(src.fs_path, password=req.password or "") as pdf:
                pdf.save(out_path, fix_metadata_version=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
            with pymupdf.open(out_path) as check:  # make sure the result is readable
                _ = check.page_count
            repaired_with = "pikepdf"
        except Exception as e:  # noqa: BLE001
            warnings.append(f"pikepdf could not rebuild the file ({type(e).__name__}); trying MuPDF")
            progress(0.5, "Reparsing with MuPDF")
            try:
                doc = pymupdf.open(stream=src.fs_path.read_bytes(), filetype="pdf")
                if doc.needs_pass and not (req.password and doc.authenticate(req.password)):
                    raise HTTPException(status_code=401, detail="PDF is password protected")
                doc.save(out_path, garbage=4, deflate=True, clean=True)
                doc.close()
                repaired_with = "pymupdf"
            except HTTPException:
                raise
            except Exception as e2:  # noqa: BLE001
                raise HTTPException(status_code=422, detail=f"The PDF could not be repaired: {e2}") from e2
        sf = store.register_output(out_id, out_path, "application/pdf")
        return ToolResult(outputs=[file_out(sf)], data={"repaired_with": repaired_with}, warnings=warnings)

    return jobs.submit(work)


# ---- flatten -----------------------------------------------------------------------


@router.post("/flatten", response_model=ToolResult)
def flatten(req: FileRequest):
    fid = req.ids()[0]
    src = store.get(fid)
    doc = open_pdf(fid, req.password)
    warnings: list[str] = []
    annots = sum(len(list(p.annots())) for p in doc)
    widgets = sum(len(list(p.widgets())) for p in doc)
    try:
        doc.bake(annots=True, widgets=True)
        method = "bake"
    except Exception as e:  # noqa: BLE001
        warnings.append(f"Vector flattening failed ({e}); pages were rasterized at 200 dpi instead.")
        doc = _rasterize(doc, 200)
        method = "raster"
    sf = save_doc(doc, with_suffix(src.name, "-flattened"))
    n = doc.page_count
    doc.close()
    return ToolResult(
        outputs=[file_out(sf, n)],
        data={"method": method, "annotations": annots, "widgets": widgets},
        warnings=warnings,
    )


def _rasterize(doc: pymupdf.Document, dpi: int, gray: bool = False) -> pymupdf.Document:
    out = pymupdf.open()
    zoom = dpi / 72.0
    cs = pymupdf.csGRAY if gray else pymupdf.csRGB
    for page in doc:
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=cs, alpha=False)
        new = out.new_page(width=page.rect.width, height=page.rect.height)
        new.insert_image(new.rect, pixmap=pix)
    doc.close()
    return out


# ---- grayscale ----------------------------------------------------------------------


@router.post("/grayscale", response_model=ToolResult)
def grayscale(req: FileRequest):
    fid = req.ids()[0]
    src = store.get(fid)
    doc = open_pdf(fid, req.password)
    warnings: list[str] = []
    method = "recolor"
    try:
        for page in doc:
            page.recolor(components=1)
    except Exception as e:  # noqa: BLE001
        warnings.append(f"Vector recolor failed ({e}); pages were rasterized to grayscale at 200 dpi.")
        doc = _rasterize(doc, 200, gray=True)
        method = "raster"
    sf = save_doc(doc, with_suffix(src.name, "-grayscale"), **LOSSLESS_SAVE)
    n = doc.page_count
    doc.close()
    return ToolResult(outputs=[file_out(sf, n)], data={"method": method}, warnings=warnings)


# ---- linearize ---------------------------------------------------------------------


@router.post("/linearize", response_model=ToolResult)
def linearize(req: FileRequest):
    fid = req.ids()[0]
    src = store.get(fid)
    open_pdf(fid, req.password).close()  # validates + checks password
    out_id, out_path = store.output_path(with_suffix(src.name, "-web"))
    try:
        with pikepdf.open(src.fs_path, password=req.password or "") as pdf:
            pdf.save(out_path, linearize=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not linearize: {e}") from e
    sf = store.register_output(out_id, out_path, "application/pdf")
    return ToolResult(outputs=[file_out(sf)], data={"linearized": True})


# ---- remove blank pages ----------------------------------------------------------------


class BlankRequest(_Base):
    threshold: float = Field(default=0.995, ge=0.5, le=1.0)


def _is_blank(page: pymupdf.Page, threshold: float) -> bool:
    if page.get_text("text").strip():
        return False
    pix = page.get_pixmap(matrix=pymupdf.Matrix(0.3, 0.3), colorspace=pymupdf.csGRAY, alpha=False)
    samples = pix.samples
    if not samples:
        return True
    white = sum(1 for b in samples if b >= 245)
    return white / len(samples) >= threshold


@router.post("/remove-blank-pages", response_model=ToolResult)
def remove_blank_pages(req: BlankRequest):
    fid = req.ids()[0]
    src = store.get(fid)
    doc = open_pdf(fid, req.password)
    blank = [i for i, p in enumerate(doc) if _is_blank(p, req.threshold)]
    if len(blank) >= doc.page_count:
        doc.close()
        raise HTTPException(status_code=400, detail="Every page looks blank; nothing would be left")
    if blank:
        doc.delete_pages(blank)
    sf = save_doc(doc, with_suffix(src.name, "-noblank"))
    n = doc.page_count
    doc.close()
    return ToolResult(
        outputs=[file_out(sf, n)],
        data={"removed": len(blank), "removed_pages": [i + 1 for i in blank], "page_count": n},
    )
