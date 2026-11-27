"""Review tools: compare, accessibility audit, inspect, word count, attachments, measure."""

from __future__ import annotations

import difflib
import json
import math
import re
from pathlib import Path
from typing import Any, Literal

import pymupdf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..pdfutil import file_out, open_pdf, save_doc
from ..schemas import ToolResult
from ..storage import store
from .edit import disp_list, get_page, pages_of, show_page_upright, to_page_space

router = APIRouter(prefix="/api/review", tags=["review"])

RED = (1, 0.2, 0.2)
GREEN = (0.2, 0.75, 0.2)


# ---- low-level structure access (pypdf; pikepdf is optional and may be unavailable) --------


def _pypdf_reader(path: Path, password: str | None):
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    if reader.is_encrypted:
        try:
            reader.decrypt(password or "")
        except Exception:  # noqa: BLE001
            return None
    return reader


def _root(reader) -> dict | None:
    try:
        return reader.trailer["/Root"].get_object()
    except Exception:  # noqa: BLE001
        return None


def _resolve(o):
    try:
        return o.get_object()
    except Exception:  # noqa: BLE001
        return o


def _walk_struct(node, visit, depth=0, seen=None, budget=None):
    """Depth-first walk of a structure tree, calling ``visit(dict)`` for each element."""
    seen = seen if seen is not None else set()
    budget = budget if budget is not None else [20000]
    node = _resolve(node)
    if budget[0] <= 0 or depth > 60:
        return
    if isinstance(node, list):
        for k in node:
            _walk_struct(k, visit, depth + 1, seen, budget)
        return
    if not hasattr(node, "get"):
        return
    ident = id(node)
    try:
        ident = node.indirect_reference.idnum if node.indirect_reference is not None else id(node)
    except Exception:  # noqa: BLE001
        pass
    if ident in seen:
        return
    seen.add(ident)
    budget[0] -= 1
    visit(node)
    kids = node.get("/K")
    if kids is not None:
        _walk_struct(kids, visit, depth + 1, seen, budget)


# ---- compare -----------------------------------------------------------------------


class CompareRequest(BaseModel):
    file_ids: list[str] = Field(min_length=2, max_length=2)
    password: str | None = None
    text: bool = True
    visual: bool = True
    dpi: int = Field(default=72, ge=24, le=300)
    pages: str = "all"
    threshold: int = Field(default=40, ge=1, le=255)


def _words(page: pymupdf.Page) -> list[tuple]:
    """Words in reading order by geometry (line bucket, then x) so a replaced word stays a 'replace'."""
    return sorted(page.get_text("words"), key=lambda w: (round((w[1] + w[3]) / 2 / 4), w[0]))


def _rects(page: pymupdf.Page, words: list[tuple], i: int, j: int) -> list[list[float]]:
    return [disp_list(page, w[:4]) for w in words[i:j]]


def text_diff_page(pa: pymupdf.Page, pb: pymupdf.Page, pno: int) -> list[dict[str, Any]]:
    wa, wb = _words(pa), _words(pb)
    sm = difflib.SequenceMatcher(None, [w[4] for w in wa], [w[4] for w in wb], autojunk=False)
    changes = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        changes.append(
            {
                "page": pno,
                "kind": tag,
                "a_text": " ".join(w[4] for w in wa[i1:i2]),
                "b_text": " ".join(w[4] for w in wb[j1:j2]),
                "a_rects": _rects(pa, wa, i1, i2),
                "b_rects": _rects(pb, wb, j1, j2),
            }
        )
    return changes


def _pix_to_image(pix: pymupdf.Pixmap):
    from PIL import Image

    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def visual_diff_page(pa: pymupdf.Page, pb: pymupdf.Page, dpi: int, threshold: int) -> dict[str, Any]:
    from PIL import Image, ImageChops

    zoom = dpi / 72
    m = pymupdf.Matrix(zoom, zoom)
    ia = _pix_to_image(pa.get_pixmap(matrix=m, alpha=False))
    ib = _pix_to_image(pb.get_pixmap(matrix=m, alpha=False))
    w, h = max(ia.width, ib.width), max(ia.height, ib.height)
    if ia.size != (w, h):
        c = Image.new("RGB", (w, h), "white")
        c.paste(ia, (0, 0))
        ia = c
    if ib.size != (w, h):
        c = Image.new("RGB", (w, h), "white")
        c.paste(ib, (0, 0))
        ib = c
    diff = ImageChops.difference(ia, ib).convert("L").point(lambda v: 255 if v > threshold else 0)
    bbox = diff.getbbox()
    changed = sum(1 for v in diff.getdata() if v) if bbox else 0
    pct = 100.0 * changed / (w * h) if w * h else 0.0
    return {
        "changed_percent": round(pct, 3),
        "bbox": [c / zoom for c in bbox] if bbox else None,
        "size_differs": pa.rect.round() != pb.rect.round(),
    }


def _highlight(page: pymupdf.Page, rects: list[list[float]], color) -> None:
    """Highlight displayed-space rects on ``page``."""
    rr = [pymupdf.Rect(r) for r in rects]
    quads = [to_page_space(page, r.quad) for r in rr if r.is_valid and not r.is_empty]
    if quads:
        a = page.add_highlight_annot(quads=quads)
        a.set_colors(stroke=color)
        a.update()


def build_compare_report(
    da: pymupdf.Document, db: pymupdf.Document, pairs: list[int], changes: list[dict], names: tuple[str, str]
) -> pymupdf.Document:
    """Side-by-side report: old page (deletions red) | new page (insertions green)."""
    ca = pymupdf.open("pdf", da.tobytes())
    cb = pymupdf.open("pdf", db.tobytes())
    by_page: dict[int, list[dict]] = {}
    for ch in changes:
        by_page.setdefault(ch["page"], []).append(ch)
    for pno, chs in by_page.items():
        pa, pb = ca[pno - 1], cb[pno - 1]
        for ch in chs:
            if ch["a_rects"]:
                _highlight(pa, ch["a_rects"], RED)
            if ch["b_rects"]:
                _highlight(pb, ch["b_rects"], GREEN)
    # bake highlights so show_pdf_page carries them
    ca.bake(annots=True, widgets=False)
    cb.bake(annots=True, widgets=False)
    report = pymupdf.open()
    header, gutter, margin = 40, 20, 20
    for i in pairs:
        ra, rb = ca[i].rect, cb[i].rect
        width = ra.width + rb.width + gutter + 2 * margin
        height = max(ra.height, rb.height) + header + 2 * margin
        pg = report.new_page(width=width, height=height)
        n = len(by_page.get(i + 1, []))
        pg.insert_text((margin, 24), f"Page {i + 1}  -  {n} text change(s)", fontsize=12, fontname="hebo")
        pg.insert_text((margin, 36), f"OLD: {names[0]}", fontsize=8, color=(0.6, 0, 0))
        pg.insert_text((margin + ra.width + gutter, 36), f"NEW: {names[1]}", fontsize=8, color=(0, 0.5, 0))
        left = pymupdf.Rect(margin, header + margin, margin + ra.width, header + margin + ra.height)
        right = pymupdf.Rect(
            left.x1 + gutter, header + margin, left.x1 + gutter + rb.width, header + margin + rb.height
        )
        show_page_upright(pg, left, ca, i)
        show_page_upright(pg, right, cb, i)
        pg.draw_rect(left, color=(0.7, 0.7, 0.7), width=0.5)
        pg.draw_rect(right, color=(0.7, 0.7, 0.7), width=0.5)
    ca.close()
    cb.close()
    return report


@router.post("/compare", response_model=ToolResult)
def compare(req: CompareRequest):
    sa, sb = store.get(req.file_ids[0]), store.get(req.file_ids[1])
    da = open_pdf(req.file_ids[0], req.password)
    db = open_pdf(req.file_ids[1], req.password)
    warnings: list[str] = []
    try:
        n = min(da.page_count, db.page_count)
        if da.page_count != db.page_count:
            warnings.append(
                f"page counts differ ({da.page_count} vs {db.page_count}); compared the first {n} page(s) only"
            )
        try:
            pairs = [i for i in pages_of(da, req.pages) if i < n]
        except HTTPException:
            pairs = list(range(n))
        changes: list[dict] = []
        visual: list[dict] = []
        for i in pairs:
            pa, pb = da[i], db[i]
            if req.text:
                changes.extend(text_diff_page(pa, pb, i + 1))
            if req.visual:
                v = visual_diff_page(pa, pb, req.dpi, req.threshold)
                v["page"] = i + 1
                visual.append(v)
        kinds = [c["kind"] for c in changes]
        summary = {
            "inserted": kinds.count("insert"),
            "deleted": kinds.count("delete"),
            "replaced": kinds.count("replace"),
            "pages_changed": len(
                {c["page"] for c in changes} | {v["page"] for v in visual if v["changed_percent"] > 0}
            ),
            "pages_compared": len(pairs),
            "extra_pages_a": max(0, da.page_count - n),
            "extra_pages_b": max(0, db.page_count - n),
        }
        report = build_compare_report(da, db, pairs, changes, (sa.name, sb.name))
        try:
            pdf_out = save_doc(report, "comparison-report.pdf")
        finally:
            report.close()
        data = {"summary": summary, "changes": changes, "visual": visual, "files": [sa.name, sb.name]}
        json_out = store.save_bytes(
            json.dumps(data, indent=2).encode("utf-8"), "comparison-report.json", "application/json"
        )
    finally:
        da.close()
        db.close()
    return ToolResult(outputs=[file_out(pdf_out), file_out(json_out)], data=data, warnings=warnings)


# ---- accessibility -------------------------------------------------------------------


class FileRequest(BaseModel):
    file_id: str
    password: str | None = None


def _check(id_: str, label: str, status: str, detail: str = "") -> dict[str, str]:
    return {"id": id_, "label": label, "status": status, "detail": detail}


@router.post("/accessibility", response_model=ToolResult)
def accessibility(req: FileRequest):
    sf = store.get(req.file_id)
    doc = open_pdf(req.file_id, req.password)
    checks: list[dict[str, str]] = []
    try:
        reader = _pypdf_reader(sf.fs_path, req.password)
        root = _root(reader) if reader else None
        tagged = False
        lang = None
        struct_root = None
        if root is not None:
            mi = _resolve(root.get("/MarkInfo")) if root.get("/MarkInfo") is not None else None
            tagged = bool(mi and mi.get("/Marked"))
            lang = root.get("/Lang")
            struct_root = root.get("/StructTreeRoot")
            lang = str(lang) if lang is not None else None
        checks.append(
            _check(
                "tagged",
                "Tagged PDF",
                "pass" if tagged else "fail",
                "Document is marked as tagged"
                if tagged
                else "No /MarkInfo /Marked true; screen readers lack structure",
            )
        )
        checks.append(
            _check(
                "language",
                "Document language",
                "pass" if lang else "fail",
                f"/Lang = {lang}" if lang else "No /Lang entry in the catalog",
            )
        )
        title = (doc.metadata or {}).get("title") or ""
        checks.append(
            _check(
                "title",
                "Document title",
                "pass" if title.strip() else "fail",
                f"Title: {title}" if title.strip() else "Metadata title is empty",
            )
        )
        # figures without alt text
        if struct_root is not None:
            figures, no_alt = 0, 0

            def visit(node):
                nonlocal figures, no_alt
                if str(node.get("/S", "")) == "/Figure":
                    figures += 1
                    if not node.get("/Alt") and not node.get("/ActualText"):
                        no_alt += 1

            _walk_struct(struct_root.get("/K") if hasattr(struct_root, "get") else struct_root, visit)
            if figures == 0:
                checks.append(
                    _check("alt_text", "Image alternative text", "na", "No /Figure elements in the structure tree")
                )
            else:
                checks.append(
                    _check(
                        "alt_text",
                        "Image alternative text",
                        "pass" if no_alt == 0 else "fail",
                        f"{figures - no_alt}/{figures} figures have /Alt text",
                    )
                )
        else:
            n_img = sum(len(p.get_images()) for p in doc)
            checks.append(
                _check(
                    "alt_text",
                    "Image alternative text",
                    "warn" if n_img else "na",
                    f"Untagged document with {n_img} image(s): alt text cannot be determined" if n_img else "No images",
                )
            )
        scanned = [i + 1 for i, p in enumerate(doc) if p.get_images() and not p.get_text("text").strip()]
        checks.append(
            _check(
                "scanned",
                "Scanned pages without text",
                "pass" if not scanned else "fail",
                "All pages have text" if not scanned else f"Pages without text layer: {scanned[:20]}",
            )
        )
        toc = doc.get_toc(simple=True)
        if doc.page_count > 10:
            checks.append(
                _check(
                    "bookmarks",
                    "Bookmarks for long document",
                    "pass" if toc else "warn",
                    f"{len(toc)} bookmark(s)" if toc else "Documents over 10 pages should have an outline",
                )
            )
        else:
            checks.append(_check("bookmarks", "Bookmarks", "na", f"{doc.page_count} page(s); outline optional"))
        widgets = [w for p in doc for w in p.widgets()]
        if widgets:
            missing = [w.field_name for w in widgets if not (w.field_label or "").strip()]
            checks.append(
                _check(
                    "form_tooltips",
                    "Form field descriptions",
                    "pass" if not missing else "fail",
                    f"{len(widgets) - len(missing)}/{len(widgets)} fields have tooltips",
                )
            )
        else:
            checks.append(_check("form_tooltips", "Form field descriptions", "na", "No form fields"))
        links = [(p, ln) for p in doc for ln in p.get_links()]
        if links:
            bare = 0
            for p, ln in links:
                txt = p.get_textbox(to_page_space(p, pymupdf.Rect(ln["from"]))).strip()
                if not txt:
                    bare += 1
            checks.append(
                _check(
                    "link_text",
                    "Links have visible text",
                    "pass" if bare == 0 else "warn",
                    f"{len(links) - bare}/{len(links)} links overlap text",
                )
            )
        else:
            checks.append(_check("link_text", "Links have visible text", "na", "No links"))
        checks.append(_check("contrast", "Colour contrast", "na", "Not evaluated automatically"))
        checks.append(
            _check(
                "reading_order",
                "Reading order",
                "pass" if tagged else "warn",
                "Structure tree defines reading order" if tagged else "Untagged: reading order is inferred by layout",
            )
        )
    finally:
        doc.close()
    weights = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    scored = [c for c in checks if c["status"] in weights]
    score = round(100 * sum(weights[c["status"]] for c in scored) / len(scored)) if scored else 100
    return ToolResult(outputs=[], data={"score": score, "checks": checks, "tagged": tagged, "language": lang})


# ---- inspect -------------------------------------------------------------------------


_JS_RE = re.compile(rb"/(JavaScript|JS)\b")


def _scan_javascript(doc: pymupdf.Document, limit: int = 20000) -> bool:
    try:
        for xref in range(1, min(doc.xref_length(), limit)):
            try:
                obj = doc.xref_object(xref, compressed=True)
            except Exception:  # noqa: BLE001
                continue
            if "/JavaScript" in obj or "/JS" in obj:
                return True
    except Exception:  # noqa: BLE001
        pass
    return False


def _font_entry(f: tuple) -> dict[str, Any]:
    xref, ext, ftype, basefont, name, encoding = f[:6]
    subset = bool(re.match(r"^[A-Z]{6}\+", basefont or ""))
    return {
        "xref": xref,
        "name": basefont,
        "type": ftype,
        "encoding": encoding,
        "embedded": ext not in ("n/a", "", None),
        "subset": subset,
        "resource_name": name,
    }


@router.post("/inspect", response_model=ToolResult)
def inspect(req: FileRequest):
    sf = store.get(req.file_id)
    doc = open_pdf(req.file_id, req.password)
    try:
        fonts: dict[int, dict] = {}
        images: dict[int, dict] = {}
        pages = []
        for i, p in enumerate(doc):
            pages.append(
                {
                    "index": i,
                    "page": i + 1,
                    "width": p.rect.width,
                    "height": p.rect.height,
                    "rotation": p.rotation,
                    "has_text": bool(p.get_text("text").strip()),
                    "images": len(p.get_images()),
                    "annots": len(list(p.annots())),
                    "links": len(p.get_links()),
                    "widgets": len(list(p.widgets())),
                }
            )
            for f in p.get_fonts(full=True):
                if f[0] <= 0:
                    continue
                e = fonts.setdefault(f[0], {**_font_entry(f), "pages": []})
                if i + 1 not in e["pages"]:
                    e["pages"].append(i + 1)
            for im in p.get_images(full=True):
                xref = im[0]
                e = images.get(xref)
                if e is None:
                    size = None
                    try:
                        t, v = doc.xref_get_key(xref, "Length")
                        size = int(v) if t == "int" else None
                    except Exception:  # noqa: BLE001
                        pass
                    e = images[xref] = {
                        "xref": xref,
                        "width": im[2],
                        "height": im[3],
                        "bpc": im[4],
                        "colorspace": im[5],
                        "filter": im[8] if len(im) > 8 else "",
                        "has_mask": bool(im[1]),
                        "size_bytes": size,
                        "pages": [],
                    }
                if i + 1 not in e["pages"]:
                    e["pages"].append(i + 1)
        attachments = []
        for name in doc.embfile_names():
            try:
                info = doc.embfile_info(name)
                attachments.append(
                    {
                        "name": name,
                        "filename": info.get("filename"),
                        "size": info.get("size"),
                        "description": info.get("desc") or info.get("description", ""),
                    }
                )
            except Exception:  # noqa: BLE001
                attachments.append({"name": name})
        head = sf.fs_path.open("rb").read(2048)
        reader = _pypdf_reader(sf.fs_path, req.password)
        root = _root(reader) if reader else None
        tagged = False
        if root is not None and root.get("/MarkInfo") is not None:
            mi = _resolve(root.get("/MarkInfo"))
            tagged = bool(mi and mi.get("/Marked"))
        md = dict(doc.metadata or {})
        has_xml = False
        try:
            has_xml = doc.xref_xml_metadata() > 0
        except Exception:  # noqa: BLE001
            pass
        perms = doc.permissions
        data = {
            "file": {"name": sf.name, "size": sf.size},
            "file_size": sf.size,
            "metadata": md,
            "xml_metadata": has_xml,
            "pdf_version": md.get("format"),
            "page_count": doc.page_count,
            "pages": pages,
            "fonts": sorted(fonts.values(), key=lambda f: f["name"] or ""),
            "images": list(images.values()),
            "attachments": attachments,
            "javascript": _scan_javascript(doc),
            "encrypted": bool(doc.is_encrypted or doc.needs_pass or md.get("encryption")),
            "encryption": md.get("encryption"),
            "permissions": {
                "print": bool(perms & pymupdf.PDF_PERM_PRINT),
                "modify": bool(perms & pymupdf.PDF_PERM_MODIFY),
                "copy": bool(perms & pymupdf.PDF_PERM_COPY),
                "annotate": bool(perms & pymupdf.PDF_PERM_ANNOTATE),
                "form": bool(perms & pymupdf.PDF_PERM_FORM),
                "accessibility": bool(perms & pymupdf.PDF_PERM_ACCESSIBILITY),
                "assemble": bool(perms & pymupdf.PDF_PERM_ASSEMBLE),
                "print_hq": bool(perms & pymupdf.PDF_PERM_PRINT_HQ),
            },
            "is_form": bool(doc.is_form_pdf),
            "is_tagged": tagged,
            "linearized": b"/Linearized" in head,
            "is_pdf": doc.is_pdf,
            "toc_entries": len(doc.get_toc(simple=True)),
        }
    finally:
        doc.close()
    return ToolResult(outputs=[], data=data)


# ---- word count ---------------------------------------------------------------------


class WordCountRequest(BaseModel):
    file_id: str
    password: str | None = None
    pages: str = "all"


@router.post("/word-count", response_model=ToolResult)
def word_count(req: WordCountRequest):
    doc = open_pdf(req.file_id, req.password)
    try:
        idx = pages_of(doc, req.pages)
        per_page = []
        tot = {"words": 0, "characters": 0, "characters_no_spaces": 0, "lines": 0}
        for i in idx:
            p = doc[i]
            text = p.get_text("text")
            words = len(p.get_text("words"))
            chars = len(text.replace("\n", ""))
            no_sp = len(re.sub(r"\s", "", text))
            lines = sum(len(b.get("lines", [])) for b in p.get_text("dict").get("blocks", []) if b.get("type") == 0)
            entry = {"page": i + 1, "words": words, "characters": chars, "characters_no_spaces": no_sp, "lines": lines}
            per_page.append(entry)
            for k in tot:
                tot[k] += entry[k]
        data = {**tot, "pages": len(idx), "per_page": per_page}
    finally:
        doc.close()
    return ToolResult(outputs=[], data=data)


# ---- attachments ----------------------------------------------------------------------


@router.post("/extract-attachments", response_model=ToolResult)
def extract_attachments(req: FileRequest):
    doc = open_pdf(req.file_id, req.password)
    outputs = []
    warnings: list[str] = []
    try:
        for name in doc.embfile_names():
            try:
                info = doc.embfile_info(name)
                data = doc.embfile_get(name)
                fname = info.get("filename") or name
                outputs.append(file_out(store.save_bytes(data, fname)))
            except Exception as e:  # noqa: BLE001
                warnings.append(f"{name}: {e}")
        # file attachment annotations
        for p in doc:
            for a in p.annots(types=[pymupdf.PDF_ANNOT_FILE_ATTACHMENT]):
                try:
                    info = a.file_info
                    outputs.append(file_out(store.save_bytes(a.get_file(), info.get("filename") or "attachment")))
                except Exception as e:  # noqa: BLE001
                    warnings.append(f"annotation {a.xref}: {e}")
    finally:
        doc.close()
    if not outputs and not warnings:
        warnings.append("no embedded files found")
    return ToolResult(outputs=outputs, data={"count": len(outputs)}, warnings=warnings)


# ---- measure ---------------------------------------------------------------------------


UNIT_FACTORS = {"pt": 1.0, "in": 1 / 72, "mm": 25.4 / 72, "cm": 2.54 / 72}


class MeasureRequest(BaseModel):
    file_id: str
    password: str | None = None
    page: int = Field(ge=1)
    points: list[tuple[float, float]] = Field(min_length=2)
    unit: Literal["pt", "mm", "cm", "in"] = "pt"
    scale: float = Field(default=1.0, gt=0)


@router.post("/measure", response_model=ToolResult)
def measure(req: MeasureRequest):
    doc = open_pdf(req.file_id, req.password)
    try:
        page = get_page(doc, req.page)
        page_size = (page.rect.width, page.rect.height)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    finally:
        doc.close()
    f = UNIT_FACTORS[req.unit] * req.scale
    pts = req.points
    segs = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    data: dict[str, Any] = {
        "unit": req.unit,
        "scale": req.scale,
        "page_size": [page_size[0] * f, page_size[1] * f],
        "segments": [s * f for s in segs],
        "distance": sum(segs) * f,
    }
    if len(pts) >= 3:
        area = 0.0
        for i in range(len(pts)):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % len(pts)]
            area += x0 * y1 - x1 * y0
        data["perimeter"] = (sum(segs) + math.dist(pts[-1], pts[0])) * f
        data["area"] = abs(area) / 2 * f * f
    return ToolResult(outputs=[], data=data)
