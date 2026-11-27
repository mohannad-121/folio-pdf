"""Editing tools: interactive viewer endpoints (``/apply`` and the read-only
inspectors it needs) plus the form-based tools watermark, page numbers,
header/footer, background, metadata, bookmarks, crop, resize.

Coordinate contract
-------------------
Every coordinate the client sends or receives is in PDF points, top-left
origin, in the page's *displayed* (rotated) space -- the space of ``page.rect``
and of the rendered page images. Pages are 1-based.

PyMuPDF itself works in the *unrotated* page space for text insertion,
annotations, widgets, images, redactions, ``get_text()`` and ``search_for()``
(only ``page.rect``, pixmaps and ``get_links()`` are in displayed space). So
every rect/point crossing the API boundary goes through :func:`to_page_space`
(displayed -> unrotated) or :func:`from_page_space` (unrotated -> displayed),
and inserted text/images get ``rotate=page.rotation`` so they appear upright.
"""

from __future__ import annotations

import datetime as _dt
import io
import os
import statistics
from pathlib import Path
from typing import Annotated, Any, Literal

import pymupdf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..pdfutil import file_out, open_pdf, save_doc, with_suffix
from ..schemas import ToolResult, parse_page_spec
from ..storage import store

router = APIRouter(prefix="/api/edit", tags=["edit"])

Rect4 = tuple[float, float, float, float]
Point2 = tuple[float, float]

LATIN_LIMIT = 0x2FF  # chars above this need a fallback (CJK/Arabic/Cyrillic) font
UNICODE_TTF_CANDIDATES = [
    "arial.ttf",
    "segoeui.ttf",
    "DejaVuSans.ttf",
    "NotoSans-Regular.ttf",
    "LiberationSans-Regular.ttf",
    "FreeSans.ttf",
]
_FONT_DIRS = [
    Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts",
    Path("/usr/share/fonts"),
    Path("/usr/local/share/fonts"),
    Path.home() / ".fonts",
]


# ---- colour / geometry helpers ------------------------------------------------------


def hex_to_rgb(s: str | None) -> tuple[float, float, float] | None:
    """``"#rrggbb"`` (or ``"rgb"``) -> ``(r, g, b)`` floats in 0..1. ``None``/empty -> ``None``."""
    if not s:
        return None
    s = s.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        raise ValueError(f"Bad color: {s!r}")
    return tuple(int(s[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_to_hex(c) -> str | None:
    if not c:
        return None
    try:
        vals = [max(0, min(255, round(float(v) * 255))) for v in list(c)[:3]]
    except (TypeError, ValueError):
        return None
    if len(vals) == 1:
        vals = vals * 3
    if len(vals) != 3:
        return None
    return f"#{vals[0]:02x}{vals[1]:02x}{vals[2]:02x}"


def int_to_hex(c: int) -> str:
    return f"#{int(c) & 0xFFFFFF:06x}"


def _geo(obj):
    if isinstance(obj, (pymupdf.Rect, pymupdf.IRect, pymupdf.Point, pymupdf.Quad)):
        return obj
    if len(obj) == 4:
        return pymupdf.Rect(*obj)
    if len(obj) == 2:
        return pymupdf.Point(*obj)
    raise ValueError("Expected a rect [x0,y0,x1,y1] or point [x,y]")


def to_page_space(page: pymupdf.Page, obj):
    """Displayed (rotated, ``page.rect``) space -> PyMuPDF's unrotated page space.

    Accepts a ``Rect``/``Point``/``Quad`` or a plain sequence of 4 or 2 numbers. Rects come back normalized;
    quads keep their point order (so highlight quads follow the displayed text direction)."""
    geo = _geo(obj)
    if page.rotation == 0:
        return geo
    out = geo * page.derotation_matrix
    return out.normalize() if isinstance(out, pymupdf.Rect) else out


def from_page_space(page: pymupdf.Page, obj):
    """Unrotated page space -> displayed space (inverse of :func:`to_page_space`)."""
    geo = _geo(obj)
    if page.rotation == 0:
        return geo
    out = geo * page.rotation_matrix
    return out.normalize() if isinstance(out, pymupdf.Rect) else out


def disp_list(page: pymupdf.Page, rect) -> list[float]:
    return list(from_page_space(page, pymupdf.Rect(rect)))


def unrot_page_rect(page: pymupdf.Page) -> pymupdf.Rect:
    """The full page in unrotated coordinates (what ``page.rect`` is for an unrotated page)."""
    return to_page_space(page, page.rect)


def text_rotation(page: pymupdf.Page, extra: int = 0) -> int:
    """``rotate`` argument that makes inserted text/images appear upright on a rotated page."""
    return (page.rotation + int(extra)) % 360


def R(r) -> pymupdf.Rect:
    return pymupdf.Rect(*r).normalize()


def P(p) -> pymupdf.Point:
    return pymupdf.Point(*p)


def get_page(doc: pymupdf.Document, page: int) -> pymupdf.Page:
    if page < 1 or page > doc.page_count:
        raise ValueError(f"Page {page} out of range (1-{doc.page_count})")
    return doc[page - 1]


def pages_of(doc: pymupdf.Document, spec: str | None) -> list[int]:
    try:
        return parse_page_spec(spec or "all", doc.page_count)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


def align_code(a: str | int | None) -> int:
    if isinstance(a, int):
        return a
    return {"left": 0, "center": 1, "right": 2, "justify": 3}.get((a or "left").lower(), 0)


# ---- fonts -----------------------------------------------------------------------------


def find_font_file(names: list[str]) -> Path | None:
    """First existing font file among ``names`` in the usual system font folders."""
    for name in names:
        for base in _FONT_DIRS:
            if not base.exists():
                continue
            direct = base / name
            if direct.exists():
                return direct
            if base != _FONT_DIRS[0]:
                for hit in base.rglob(name):
                    return hit
    return None


def font_for(name: str | None) -> str:
    return (name or "helv").strip() or "helv"


def needs_fallback_font(text: str) -> bool:
    return any(ord(ch) > LATIN_LIMIT for ch in text)


def _has_rtl(text: str) -> bool:
    return any(0x0590 <= ord(ch) <= 0x08FF for ch in text)


def font_kwargs(text: str, fontname: str) -> dict[str, Any]:
    """``fontname``/``fontfile`` kwargs for ``insert_text``/``insert_textbox`` able to render ``text``."""
    if not needs_fallback_font(text):
        return {"fontname": font_for(fontname)}
    if _has_rtl(text):
        ttf = find_font_file(UNICODE_TTF_CANDIDATES)
        if ttf is not None:
            return {"fontname": "FolioUni", "fontfile": str(ttf)}
    return {"fontname": "china-s"}  # Droid Sans Fallback: CJK, Cyrillic, Greek, ...


def insert_fitted_text(
    page: pymupdf.Page,
    rect: pymupdf.Rect,
    text: str,
    size: float,
    fontname: str,
    rgb,
    align: int = 0,
    rotate: int = 0,
    min_size: float = 6.0,
    shrink: bool = False,
    overlay: bool = True,
) -> tuple[float, list[str]]:
    """Insert ``text`` into ``rect`` (displayed space), optionally shrinking until it fits.

    Returns ``(used_size, warnings)``. Falls back to an unclipped ``insert_text`` at the box origin when the
    text still does not fit (and says so in the warnings)."""
    warnings: list[str] = []
    fk = font_kwargs(text, fontname)
    if "fontfile" in fk or fk["fontname"] != font_for(fontname):
        warnings.append(f"used fallback font {fk['fontname']} for non-Latin text")
    ur = to_page_space(page, rect)
    rot = text_rotation(page, rotate)
    s = size
    while True:
        rc = page.insert_textbox(ur, text, fontsize=s, color=rgb, align=align, rotate=rot, overlay=overlay, **fk)
        if rc >= 0:
            return s, warnings
        if shrink and s - 1 >= min_size:
            s -= 1
            continue
        break
    start = to_page_space(page, pymupdf.Point(rect.x0, rect.y0 + s))
    page.insert_text(start, text, fontsize=s, color=rgb, rotate=rot, overlay=overlay, **fk)
    warnings.append("text overflowed its box; inserted unclipped at the box origin")
    return s, warnings


# ---- images ----------------------------------------------------------------------------


def image_bytes_with_opacity(path: Path, opacity: float, rotation: float = 0) -> bytes:
    """Load an image with Pillow, apply opacity (and optional rotation) and return PNG bytes."""
    from PIL import Image

    img = Image.open(path).convert("RGBA")
    if rotation:
        img = img.rotate(rotation, expand=True, resample=Image.BICUBIC)
    if opacity < 1:
        alpha = img.getchannel("A").point(lambda v: int(v * max(0.0, min(1.0, opacity))))
        img.putalpha(alpha)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def place_image(
    page: pymupdf.Page,
    rect: pymupdf.Rect,
    path: Path | None = None,
    *,
    stream: bytes | None = None,
    rotate: int = 0,
    keep: bool = True,
    overlay: bool = True,
) -> None:
    """Insert a raster or SVG image into ``rect`` given in displayed space, upright on rotated pages."""
    ur = to_page_space(page, rect)
    rot = text_rotation(page, rotate)
    if path is not None and path.suffix.lower() == ".svg":
        svg = pymupdf.open(path)
        pdf = pymupdf.open("pdf", svg.convert_to_pdf())
        page.show_pdf_page(ur, pdf, 0, keep_proportion=keep, overlay=overlay, rotate=rot)
        pdf.close()
        svg.close()
        return
    kw: dict[str, Any] = {"filename": str(path)} if path is not None else {"stream": stream}
    page.insert_image(ur, rotate=rot, keep_proportion=keep, overlay=overlay, **kw)


# ---- annotation / widget helpers -----------------------------------------------------------


def find_annot(page: pymupdf.Page, xref: int) -> pymupdf.Annot:
    for a in page.annots():
        if a.xref == xref:
            return a
    raise ValueError(f"No annotation with xref {xref} on page {page.number + 1}")


def find_widget(doc: pymupdf.Document, name: str) -> list[pymupdf.Widget]:
    """All widgets of a field. Each widget keeps a strong ref to its page (PyMuPDF only holds a weakref)."""
    out = []
    for page in doc:
        for w in page.widgets():
            if w.field_name == name:
                w._folio_page = page
                out.append(w)
    return out


def set_widget_value(widgets: list[pymupdf.Widget], value: Any) -> None:
    if not widgets:
        raise ValueError("field not found")
    kind = widgets[0].field_type
    if kind == pymupdf.PDF_WIDGET_TYPE_CHECKBOX:
        on = value is True or str(value).lower() in ("yes", "on", "true", "1", "checked")
        for w in widgets:
            w.field_value = w.on_state() if on else False
            w.update()
    elif kind == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON:
        sval = str(value)
        for w in widgets:
            w.field_value = w.on_state() == sval or (value is True and len(widgets) == 1)
            w.update()
    elif kind == pymupdf.PDF_WIDGET_TYPE_LISTBOX and isinstance(value, list):
        for w in widgets:
            w.field_value = [str(v) for v in value]
            w.update()
    else:
        for w in widgets:
            w.field_value = "" if value is None else str(value)
            w.update()


# ---- read-only inspectors used by the viewer -----------------------------------------------


def _disp_vertices(page: pymupdf.Page, verts):
    if verts and isinstance(verts[0], (list, tuple)) and verts[0] and isinstance(verts[0][0], (list, tuple)):
        return [[list(from_page_space(page, p)) for p in path] for path in verts]
    return [list(from_page_space(page, p)) for p in verts]


@router.get("/annotations/{file_id}")
def list_annotations(file_id: str, password: str | None = None):
    doc = open_pdf(file_id, password)
    out = []
    try:
        for pno, page in enumerate(doc, start=1):
            for a in page.annots():
                colors = a.colors or {}
                color = rgb_to_hex(colors.get("stroke")) or rgb_to_hex(colors.get("fill"))
                info = a.info or {}
                item = {
                    "page": pno,
                    "xref": a.xref,
                    "type": a.type[1],
                    "rect": disp_list(page, a.rect),
                    "contents": info.get("content", ""),
                    "author": info.get("title", ""),
                    "color": color,
                    "fill": rgb_to_hex(colors.get("fill")),
                    "opacity": 1.0 if a.opacity is None or a.opacity < 0 else a.opacity,
                    "created": info.get("creationDate", ""),
                    "modified": info.get("modDate", ""),
                    "has_popup": bool(a.has_popup),
                }
                verts = a.vertices
                if verts:
                    item["vertices"] = _disp_vertices(page, verts)
                out.append(item)
    finally:
        doc.close()
    return out


@router.get("/text-spans/{file_id}/{page}")
def text_spans(file_id: str, page: int, password: str | None = None):
    doc = open_pdf(file_id, password)
    try:
        pg = get_page(doc, page)
        d = pg.get_text("dict")
        blocks = []
        for b in d.get("blocks", []):
            if b.get("type") != 0:
                continue
            lines = []
            for ln in b.get("lines", []):
                spans = []
                for sp in ln.get("spans", []):
                    flags = int(sp.get("flags", 0))
                    spans.append(
                        {
                            "bbox": disp_list(pg, sp["bbox"]),
                            "text": sp.get("text", ""),
                            "font": sp.get("font", ""),
                            "size": sp.get("size", 0),
                            "color": int_to_hex(sp.get("color", 0)),
                            "flags": flags,
                            "bold": bool(flags & 16) or "bold" in sp.get("font", "").lower(),
                            "italic": bool(flags & 2) or "italic" in sp.get("font", "").lower(),
                        }
                    )
                lines.append({"bbox": disp_list(pg, ln["bbox"]), "spans": spans})
            blocks.append({"bbox": disp_list(pg, b["bbox"]), "lines": lines})
        return {"width": pg.rect.width, "height": pg.rect.height, "rotation": pg.rotation, "blocks": blocks}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    finally:
        doc.close()


@router.get("/images/{file_id}/{page}")
def page_images(file_id: str, page: int, password: str | None = None):
    doc = open_pdf(file_id, password)
    try:
        pg = get_page(doc, page)
        out = []
        for info in pg.get_image_info(xrefs=True):
            out.append(
                {
                    "xref": info.get("xref", 0),
                    "bbox": disp_list(pg, info["bbox"]),
                    "width": info.get("width"),
                    "height": info.get("height"),
                    "colorspace": info.get("cs-name"),
                    "bpc": info.get("bpc"),
                }
            )
        return out
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    finally:
        doc.close()


def _link_kind(kind: int) -> str:
    return {
        pymupdf.LINK_URI: "uri",
        pymupdf.LINK_GOTO: "goto",
        pymupdf.LINK_GOTOR: "gotor",
        pymupdf.LINK_LAUNCH: "launch",
        pymupdf.LINK_NAMED: "named",
    }.get(kind, "none")


@router.get("/links/{file_id}")
def list_links(file_id: str, password: str | None = None):
    doc = open_pdf(file_id, password)
    out = []
    try:
        for pno, page in enumerate(doc, start=1):
            for ln in page.get_links():  # get_links() already reports displayed-space rects
                item = {
                    "page": pno,
                    "xref": ln.get("xref", 0),
                    "rect": list(pymupdf.Rect(ln["from"]).normalize()),
                    "kind": _link_kind(ln.get("kind", 0)),
                }
                if "uri" in ln:
                    item["uri"] = ln["uri"]
                if "page" in ln and ln["page"] is not None and ln["page"] >= 0:
                    item["target_page"] = ln["page"] + 1
                if "file" in ln:
                    item["file"] = ln["file"]
                if "name" in ln:
                    item["name"] = ln["name"]
                out.append(item)
    finally:
        doc.close()
    return out


# ---- /apply -------------------------------------------------------------------------------


class _PageOp(BaseModel):
    page: int = Field(ge=1)


class MarkupOp(_PageOp):
    type: Literal["highlight", "underline", "strikeout", "squiggly"]
    rects: list[Rect4]
    color: str = "#ffff00"
    opacity: float = 1.0
    author: str | None = None
    contents: str | None = None


class InkOp(_PageOp):
    type: Literal["ink"]
    paths: list[list[Point2]]
    color: str = "#ff0000"
    width: float = 2.0
    opacity: float = 1.0
    author: str | None = None


class ShapeOp(_PageOp):
    type: Literal["rect", "ellipse"]
    rect: Rect4
    stroke: str | None = "#ff0000"
    fill: str | None = None
    width: float = 1.5
    opacity: float = 1.0
    author: str | None = None


class LineOp(_PageOp):
    type: Literal["line", "arrow"]
    from_: Point2 = Field(alias="from")
    to: Point2
    stroke: str = "#ff0000"
    width: float = 1.5
    opacity: float = 1.0

    model_config = {"populate_by_name": True}


class PolyOp(_PageOp):
    type: Literal["polygon", "polyline"]
    points: list[Point2]
    stroke: str = "#ff0000"
    fill: str | None = None
    width: float = 1.5
    opacity: float = 1.0


class NoteOp(_PageOp):
    type: Literal["note"]
    point: Point2
    contents: str
    author: str | None = None
    icon: str = "Note"


class FreeTextOp(_PageOp):
    type: Literal["freetext"]
    rect: Rect4
    text: str
    font_size: float = 12
    color: str = "#000000"
    font: str = "helv"
    align: str = "left"
    border_color: str | None = None
    fill_color: str | None = None
    opacity: float = 1.0


class TextOp(_PageOp):
    type: Literal["text"]
    rect: Rect4
    text: str
    font_size: float = 12
    color: str = "#000000"
    font: str = "helv"
    align: str = "left"
    rotate: int = 0


class ImageOp(_PageOp):
    type: Literal["image", "signature"]
    rect: Rect4
    image_file_id: str
    rotate: int = 0
    keep_proportion: bool = True


class StampOp(_PageOp):
    """A rubber stamp (e.g. APPROVED / PAID) baked into the page: rounded double border, bold label and
    an optional second line such as the date and name. ``rotate`` tilts it (degrees, clockwise)."""

    type: Literal["stamp"]
    rect: Rect4
    text: str = Field(min_length=1, max_length=60)
    subtext: str | None = Field(default=None, max_length=120)
    color: str = "#dc2626"
    opacity: float = Field(default=0.9, ge=0.05, le=1)
    rotate: float = Field(default=0, ge=-45, le=45)


class DeleteImageOp(_PageOp):
    type: Literal["delete_image"]
    xref: int


class ReplaceImageOp(_PageOp):
    type: Literal["replace_image"]
    xref: int
    image_file_id: str


class LinkOp(_PageOp):
    type: Literal["link"]
    rect: Rect4
    uri: str | None = None
    target_page: int | None = Field(default=None, ge=1)
    remove_xref: int | None = None


class DeleteLinkOp(_PageOp):
    type: Literal["delete_link"]
    xref: int


class RedactOp(_PageOp):
    type: Literal["redact"]
    rects: list[Rect4]
    fill: str = "#000000"
    text: str | None = None
    remove_images: bool = True


class EraseOp(_PageOp):
    type: Literal["erase"]
    rect: Rect4


class ReplaceTextOp(_PageOp):
    type: Literal["replace_text"]
    rect: Rect4
    text: str
    font_size: float | None = None
    color: str | None = None
    font: str = "helv"
    align: str = "left"
    background: str = "#ffffff"


class DeleteAnnotOp(_PageOp):
    type: Literal["delete_annot"]
    xref: int


class UpdateAnnotOp(_PageOp):
    type: Literal["update_annot"]
    xref: int
    contents: str | None = None
    color: str | None = None
    fill: str | None = None
    opacity: float | None = None
    rect: Rect4 | None = None
    author: str | None = None


class RotatePageOp(_PageOp):
    type: Literal["rotate_page"]
    angle: int


class DeletePageOp(_PageOp):
    type: Literal["delete_page"]


class InsertBlankPageOp(BaseModel):
    type: Literal["insert_blank_page"]
    after_page: int = Field(default=0, ge=0)
    width: float | None = None
    height: float | None = None


class MovePageOp(_PageOp):
    type: Literal["move_page"]
    to: int = Field(ge=1)


class FormValueOp(BaseModel):
    type: Literal["form_value"]
    field_name: str
    value: Any = None


class CropPageOp(_PageOp):
    type: Literal["crop_page"]
    rect: Rect4


class SetMetadataOp(BaseModel):
    type: Literal["set_metadata"]
    title: str | None = None
    author: str | None = None
    subject: str | None = None
    keywords: str | None = None


EditOp = Annotated[
    MarkupOp
    | InkOp
    | ShapeOp
    | LineOp
    | PolyOp
    | NoteOp
    | FreeTextOp
    | TextOp
    | ImageOp
    | StampOp
    | DeleteImageOp
    | ReplaceImageOp
    | LinkOp
    | DeleteLinkOp
    | RedactOp
    | EraseOp
    | ReplaceTextOp
    | DeleteAnnotOp
    | UpdateAnnotOp
    | RotatePageOp
    | DeletePageOp
    | InsertBlankPageOp
    | MovePageOp
    | FormValueOp
    | CropPageOp
    | SetMetadataOp,
    Field(discriminator="type"),
]


class ApplyRequest(BaseModel):
    file_id: str
    password: str | None = None
    ops: list[EditOp]
    flatten: bool = False
    strict: bool = False
    output_name: str | None = None


class _Ctx:
    def __init__(self, doc: pymupdf.Document) -> None:
        self.doc = doc
        self.warnings: list[str] = []
        self.pending_redact_pages: set[int] = set()
        self.redact_image_mode: dict[int, int] = {}
        self.deleted_pages: set[int] = set()
        self.signatures = 0

    def page(self, no: int) -> pymupdf.Page:
        return get_page(self.doc, no)

    def flush_redactions(self, pno: int) -> None:
        if pno in self.pending_redact_pages:
            self._apply_redactions(pno)

    def flush_all(self) -> None:
        for pno in sorted(self.pending_redact_pages):
            self._apply_redactions(pno)

    def _apply_redactions(self, pno: int) -> None:
        page = self.page(pno)
        images = self.redact_image_mode.get(pno, pymupdf.PDF_REDACT_IMAGE_PIXELS)
        page.apply_redactions(images=images, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
        self.pending_redact_pages.discard(pno)
        self.redact_image_mode.pop(pno, None)


def _finish_annot(
    a: pymupdf.Annot, stroke=None, fill=None, opacity: float = 1.0, author=None, contents=None, width=None
):
    if stroke is not None or fill is not None:
        kw = {}
        if stroke is not None:
            kw["stroke"] = stroke
        if fill is not None:
            kw["fill"] = fill
        a.set_colors(**kw)
    if width is not None:
        a.set_border(width=width)
    if opacity is not None and opacity < 1:
        a.set_opacity(opacity)
    info = {}
    if author:
        info["title"] = author
    if contents:
        info["content"] = contents
    if info:
        a.set_info(**info)
    a.update()
    return a


def _pt(page: pymupdf.Page, p) -> pymupdf.Point:
    return to_page_space(page, P(p))


def _op_markup(ctx: _Ctx, op: MarkupOp):
    page = ctx.page(op.page)
    quads = [to_page_space(page, R(r).quad) for r in op.rects]
    fn = {
        "highlight": page.add_highlight_annot,
        "underline": page.add_underline_annot,
        "strikeout": page.add_strikeout_annot,
        "squiggly": page.add_squiggly_annot,
    }[op.type]
    a = fn(quads=quads)
    _finish_annot(a, stroke=hex_to_rgb(op.color), opacity=op.opacity, author=op.author, contents=op.contents)


def _op_ink(ctx: _Ctx, op: InkOp):
    page = ctx.page(op.page)
    paths = [[tuple(_pt(page, p)) for p in path] for path in op.paths]
    a = page.add_ink_annot(paths)
    _finish_annot(a, stroke=hex_to_rgb(op.color), opacity=op.opacity, author=op.author, width=op.width)


def _op_shape(ctx: _Ctx, op: ShapeOp):
    page = ctx.page(op.page)
    fn = page.add_rect_annot if op.type == "rect" else page.add_circle_annot
    a = fn(to_page_space(page, R(op.rect)))
    _finish_annot(
        a,
        stroke=hex_to_rgb(op.stroke) or (),
        fill=hex_to_rgb(op.fill) or (),
        opacity=op.opacity,
        author=op.author,
        width=op.width,
    )


def _op_line(ctx: _Ctx, op: LineOp):
    page = ctx.page(op.page)
    a = page.add_line_annot(_pt(page, op.from_), _pt(page, op.to))
    if op.type == "arrow":
        a.set_line_ends(pymupdf.PDF_ANNOT_LE_NONE, pymupdf.PDF_ANNOT_LE_OPEN_ARROW)
    _finish_annot(a, stroke=hex_to_rgb(op.stroke), opacity=op.opacity, width=op.width)


def _op_poly(ctx: _Ctx, op: PolyOp):
    page = ctx.page(op.page)
    pts = [_pt(page, p) for p in op.points]
    a = page.add_polygon_annot(pts) if op.type == "polygon" else page.add_polyline_annot(pts)
    _finish_annot(a, stroke=hex_to_rgb(op.stroke), fill=hex_to_rgb(op.fill) or (), opacity=op.opacity, width=op.width)


def _op_note(ctx: _Ctx, op: NoteOp):
    page = ctx.page(op.page)
    a = page.add_text_annot(_pt(page, op.point), op.contents, icon=op.icon)
    _finish_annot(a, author=op.author)


def _op_freetext(ctx: _Ctx, op: FreeTextOp):
    page = ctx.page(op.page)
    a = page.add_freetext_annot(
        to_page_space(page, R(op.rect)),
        op.text,
        fontsize=op.font_size,
        fontname=font_for(op.font),
        text_color=hex_to_rgb(op.color),
        fill_color=hex_to_rgb(op.fill_color),
        border_color=hex_to_rgb(op.border_color),
        align=align_code(op.align),
        rotate=text_rotation(page),
    )
    if op.opacity < 1:
        a.set_opacity(op.opacity)
    a.update()


def _op_text(ctx: _Ctx, op: TextOp):
    ctx.flush_redactions(op.page)
    page = ctx.page(op.page)
    _, warns = insert_fitted_text(
        page,
        R(op.rect),
        op.text,
        op.font_size,
        font_for(op.font),
        hex_to_rgb(op.color),
        align_code(op.align),
        op.rotate,
    )
    ctx.warnings.extend(warns)


def _op_image(ctx: _Ctx, op: ImageOp):
    ctx.flush_redactions(op.page)
    page = ctx.page(op.page)
    place_image(page, R(op.rect), store.path(op.image_file_id), rotate=op.rotate, keep=op.keep_proportion)
    if op.type == "signature":
        ctx.signatures += 1


def _stamp_line(page: pymupdf.Page, text: str, cx: float, base: float, size: float, rgb, opacity: float) -> None:
    """One centred line of stamp text with its baseline at ``base``. Right-to-left scripts go through
    ``insert_htmlbox`` (HarfBuzz shaping + bidi); everything else through ``insert_text``."""
    if _has_rtl(text):
        from html import escape

        hexcol = "#" + "".join(f"{round(v * 255):02x}" for v in rgb)
        box = pymupdf.Rect(0, base - size * 1.05, page.rect.width, base + size * 0.45)
        css = f"margin:0;text-align:center;font-weight:bold;font-size:{size:.2f}px;color:{hexcol}"
        html = f'<p style="{css}">{escape(text)}</p>'
        page.insert_htmlbox(box, html, opacity=opacity)
        return
    fk = font_kwargs(text, "hebo")
    tl = _text_length(text, fk, size)
    page.insert_text((cx - tl / 2, base), text, fontsize=size, color=rgb, fill_opacity=opacity, **fk)


def _stamp_size(text: str, avail_w: float, cap_h: float) -> float:
    if _has_rtl(text):
        return min(cap_h, avail_w / max(len(text) * 0.55, 1))  # htmlbox shrinks it further if needed
    return min(cap_h, avail_w / max(_text_length(text, font_kwargs(text, "hebo"), 1), 0.01))


def draw_stamp(
    page: pymupdf.Page,
    rect: pymupdf.Rect,
    text: str,
    subtext: str | None = None,
    color: str = "#dc2626",
    opacity: float = 0.9,
    tilt: float = 0,
) -> None:
    """Draw a rubber stamp filling ``rect`` (displayed space), tilted ``tilt`` degrees clockwise.

    The stamp is drawn upright on a scratch page of the stamp's size, then placed with
    ``show_pdf_page``, which handles the tilt and the target page's rotation in one go. Text is sized
    to fit the box, so any label length works."""
    rgb = hex_to_rgb(color) or (0.86, 0.15, 0.15)
    w, h = rect.width, rect.height
    if w < 8 or h < 8:
        raise ValueError("stamp is too small")
    src = pymupdf.open()
    try:
        sp = src.new_page(width=w, height=h)
        bw = max(1.0, min(w, h) * 0.045)
        shape = sp.new_shape()
        shape.draw_rect(pymupdf.Rect(bw / 2, bw / 2, w - bw / 2, h - bw / 2), radius=0.18)
        shape.finish(color=rgb, width=bw, stroke_opacity=opacity)
        inner = pymupdf.Rect(bw * 2.4, bw * 2.4, w - bw * 2.4, h - bw * 2.4)
        if not inner.is_empty:
            shape.draw_rect(inner, radius=0.14)
            shape.finish(color=rgb, width=bw * 0.45, stroke_opacity=opacity)
        shape.commit()

        label = text.strip().upper()
        sub = (subtext or "").strip()
        pad = bw * 4.5
        avail_w, avail_h = max(4.0, w - 2 * pad), max(4.0, h - 2 * pad)
        size = _stamp_size(label, avail_w, avail_h * (0.58 if sub else 0.8))
        sub_size = min(size * 0.45, _stamp_size(sub, avail_w, avail_h * 0.24)) if sub else 0.0
        cap = 0.72  # cap height as a fraction of the font size
        gap = sub_size * 0.75
        block = size * cap + (gap + sub_size * cap if sub else 0)
        base = h / 2 - block / 2 + size * cap
        _stamp_line(sp, label, w / 2, base, size, rgb, opacity)
        if sub:
            _stamp_line(sp, sub, w / 2, base + gap + sub_size * cap, sub_size, rgb, opacity)

        # Target = the tilted stamp's bounding box, centred on the requested rect; show_pdf_page scales
        # the rotated source to fit it exactly. Its rotate is counter-clockwise, ours clockwise.
        import math

        a = math.radians(tilt)
        bw_, bh_ = w * abs(math.cos(a)) + h * abs(math.sin(a)), w * abs(math.sin(a)) + h * abs(math.cos(a))
        c = (rect.tl + rect.br) / 2
        target = pymupdf.Rect(c.x - bw_ / 2, c.y - bh_ / 2, c.x + bw_ / 2, c.y + bh_ / 2)
        page.show_pdf_page(to_page_space(page, target), src, 0, rotate=page.rotation - tilt, overlay=True)
    finally:
        src.close()


def _op_stamp(ctx: _Ctx, op: StampOp):
    ctx.flush_redactions(op.page)
    draw_stamp(ctx.page(op.page), R(op.rect), op.text, op.subtext, op.color, op.opacity, op.rotate)


def _op_delete_image(ctx: _Ctx, op: DeleteImageOp):
    ctx.page(op.page).delete_image(op.xref)


def _op_replace_image(ctx: _Ctx, op: ReplaceImageOp):
    ctx.page(op.page).replace_image(op.xref, filename=str(store.path(op.image_file_id)))


def _delete_link_xref(page: pymupdf.Page, xref: int) -> bool:
    for ln in page.get_links():
        if ln.get("xref") == xref:
            page.delete_link(ln)
            return True
    return False


def _op_link(ctx: _Ctx, op: LinkOp):
    page = ctx.page(op.page)
    if op.remove_xref is not None and not _delete_link_xref(page, op.remove_xref):
        ctx.warnings.append(f"link xref {op.remove_xref} not found on page {op.page}")
    link: dict[str, Any] = {"from": to_page_space(page, R(op.rect))}
    if op.uri:
        link.update(kind=pymupdf.LINK_URI, uri=op.uri)
    elif op.target_page:
        if op.target_page > ctx.doc.page_count:
            raise ValueError(f"target_page {op.target_page} out of range")
        link.update(kind=pymupdf.LINK_GOTO, page=op.target_page - 1)
    else:
        raise ValueError("link needs uri or target_page")
    page.insert_link(link)


def _op_delete_link(ctx: _Ctx, op: DeleteLinkOp):
    if not _delete_link_xref(ctx.page(op.page), op.xref):
        raise ValueError(f"link xref {op.xref} not found")


def _queue_redact(ctx: _Ctx, pno: int, rects, fill, text=None, remove_images=True):
    page = ctx.page(pno)
    for r in rects:
        kw: dict[str, Any] = {"fill": fill}
        if text:
            kw.update(text=text, text_color=(1, 1, 1) if fill != (1, 1, 1) else (0, 0, 0), fontsize=10)
        page.add_redact_annot(to_page_space(page, R(r)), **kw)
    mode = pymupdf.PDF_REDACT_IMAGE_PIXELS if remove_images else pymupdf.PDF_REDACT_IMAGE_NONE
    prev = ctx.redact_image_mode.get(pno)
    if prev is None or mode == pymupdf.PDF_REDACT_IMAGE_PIXELS:
        ctx.redact_image_mode[pno] = mode
    ctx.pending_redact_pages.add(pno)


def _op_redact(ctx: _Ctx, op: RedactOp):
    _queue_redact(ctx, op.page, op.rects, hex_to_rgb(op.fill) or (0, 0, 0), op.text, op.remove_images)


def _op_erase(ctx: _Ctx, op: EraseOp):
    _queue_redact(ctx, op.page, [op.rect], (1, 1, 1), None, True)


def _span_style_under(page: pymupdf.Page, rect: pymupdf.Rect) -> tuple[float | None, str | None]:
    """Font size and colour of the span that overlaps ``rect`` (unrotated space) the most."""
    best, best_area = None, 0.0
    for b in page.get_text("dict").get("blocks", []):
        for ln in b.get("lines", []):
            for sp in ln.get("spans", []):
                inter = pymupdf.Rect(sp["bbox"]) & rect
                if not inter.is_empty and inter.get_area() > best_area:
                    best, best_area = sp, inter.get_area()
    if best is None:
        return None, None
    return float(best.get("size", 0)) or None, int_to_hex(best.get("color", 0))


def _op_replace_text(ctx: _Ctx, op: ReplaceTextOp):
    page = ctx.page(op.page)
    rect = R(op.rect)
    size, color = op.font_size, op.color
    if size is None or color is None:
        s, c = _span_style_under(page, to_page_space(page, rect))
        size = size or s or min(12.0, max(6.0, rect.height * 0.8))
        color = color or c or "#000000"
    _queue_redact(ctx, op.page, [rect], hex_to_rgb(op.background) or (1, 1, 1), None, False)
    ctx.flush_redactions(op.page)
    page = ctx.page(op.page)
    # a little slack so descenders fit after the redaction removed the old glyphs
    box = pymupdf.Rect(rect.x0, rect.y0 - 1, rect.x1 + 2, rect.y1 + 2)
    _, warns = insert_fitted_text(
        page, box, op.text, size, font_for(op.font), hex_to_rgb(color), align_code(op.align), shrink=True
    )
    ctx.warnings.extend(warns)


def _op_delete_annot(ctx: _Ctx, op: DeleteAnnotOp):
    page = ctx.page(op.page)
    page.delete_annot(find_annot(page, op.xref))


def _op_update_annot(ctx: _Ctx, op: UpdateAnnotOp):
    page = ctx.page(op.page)
    a = find_annot(page, op.xref)
    if op.rect is not None:
        a.set_rect(to_page_space(page, R(op.rect)))
    kw = {}
    if op.color is not None:
        kw["stroke"] = hex_to_rgb(op.color)
    if op.fill is not None:
        kw["fill"] = hex_to_rgb(op.fill) or ()
    if kw:
        a.set_colors(**kw)
    if op.opacity is not None:
        a.set_opacity(op.opacity)
    info = {}
    if op.contents is not None:
        info["content"] = op.contents
    if op.author is not None:
        info["title"] = op.author
    if info:
        a.set_info(**info)
    a.update()


def _op_rotate_page(ctx: _Ctx, op: RotatePageOp):
    if op.angle % 90:
        raise ValueError("angle must be a multiple of 90")
    ctx.page(op.page).set_rotation(op.angle % 360)


def _op_delete_page(ctx: _Ctx, op: DeletePageOp):
    ctx.page(op.page)  # validate
    ctx.deleted_pages.add(op.page)


def _op_insert_blank(ctx: _Ctx, op: InsertBlankPageOp):
    doc = ctx.doc
    if op.after_page > doc.page_count:
        raise ValueError("after_page out of range")
    ref = doc[op.after_page - 1] if op.after_page >= 1 else (doc[0] if doc.page_count else None)
    w = op.width or (ref.rect.width if ref else 595)
    h = op.height or (ref.rect.height if ref else 842)
    doc.new_page(pno=op.after_page if op.after_page < doc.page_count else -1, width=w, height=h)


def _op_move_page(ctx: _Ctx, op: MovePageOp):
    doc = ctx.doc
    ctx.page(op.page)
    if op.to > doc.page_count:
        raise ValueError("target position out of range")
    src, dst = op.page - 1, op.to - 1
    if src == dst:
        return
    doc.move_page(src, dst if dst < src else dst + 1)


def _op_form_value(ctx: _Ctx, op: FormValueOp):
    ws = find_widget(ctx.doc, op.field_name)
    if not ws:
        raise ValueError(f"form field {op.field_name!r} not found")
    set_widget_value(ws, op.value)


def set_cropbox_unrotated(page: pymupdf.Page, unrot: pymupdf.Rect) -> None:
    """Set the crop box from a rect in unrotated page coordinates (``set_cropbox`` wants mediabox-relative)."""
    offset = page.cropbox.tl
    page.set_cropbox(pymupdf.Rect(unrot.x0 + offset.x, unrot.y0 + offset.y, unrot.x1 + offset.x, unrot.y1 + offset.y))


def set_cropbox_display(page: pymupdf.Page, rect: pymupdf.Rect) -> None:
    """Set the crop box from a rect given in displayed (rotated) coordinates."""
    rect = rect & page.rect
    if rect.is_empty:
        raise ValueError("crop rect is outside the page")
    set_cropbox_unrotated(page, to_page_space(page, rect))


def _op_crop_page(ctx: _Ctx, op: CropPageOp):
    set_cropbox_display(ctx.page(op.page), R(op.rect))


def _op_set_metadata(ctx: _Ctx, op: SetMetadataOp):
    md = dict(ctx.doc.metadata or {})
    for k in ("title", "author", "subject", "keywords"):
        v = getattr(op, k)
        if v is not None:
            md[k] = v
    ctx.doc.set_metadata(md)


_HANDLERS = {
    "highlight": _op_markup,
    "underline": _op_markup,
    "strikeout": _op_markup,
    "squiggly": _op_markup,
    "ink": _op_ink,
    "rect": _op_shape,
    "ellipse": _op_shape,
    "line": _op_line,
    "arrow": _op_line,
    "polygon": _op_poly,
    "polyline": _op_poly,
    "note": _op_note,
    "freetext": _op_freetext,
    "text": _op_text,
    "image": _op_image,
    "signature": _op_image,
    "stamp": _op_stamp,
    "delete_image": _op_delete_image,
    "replace_image": _op_replace_image,
    "link": _op_link,
    "delete_link": _op_delete_link,
    "redact": _op_redact,
    "erase": _op_erase,
    "replace_text": _op_replace_text,
    "delete_annot": _op_delete_annot,
    "update_annot": _op_update_annot,
    "rotate_page": _op_rotate_page,
    "delete_page": _op_delete_page,
    "insert_blank_page": _op_insert_blank,
    "move_page": _op_move_page,
    "form_value": _op_form_value,
    "crop_page": _op_crop_page,
    "set_metadata": _op_set_metadata,
}


@router.post("/apply", response_model=ToolResult)
def apply(req: ApplyRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    ctx = _Ctx(doc)
    applied = failed = 0
    try:
        for i, op in enumerate(req.ops, start=1):
            try:
                _HANDLERS[op.type](ctx, op)
                applied += 1
            except Exception as e:  # noqa: BLE001 - per-op isolation
                failed += 1
                msg = f"op #{i} ({op.type}): {type(e).__name__}: {e}"
                if req.strict:
                    raise HTTPException(status_code=422, detail=msg) from e
                ctx.warnings.append(msg)
        try:
            ctx.flush_all()
        except Exception as e:  # noqa: BLE001
            ctx.warnings.append(f"redaction failed: {e}")
        if ctx.deleted_pages:
            if len(ctx.deleted_pages) >= doc.page_count:
                ctx.warnings.append("refusing to delete every page")
            else:
                for pno in sorted(ctx.deleted_pages, reverse=True):
                    doc.delete_page(pno - 1)
        if req.flatten:
            doc.bake(annots=True, widgets=True)
        name = req.output_name or with_suffix(sf.name, "-edited")
        if not name.lower().endswith(".pdf"):
            name += ".pdf"
        out = save_doc(doc, name)
    finally:
        doc.close()
    data = {"applied": applied, "failed": failed, "signatures": ctx.signatures}
    return ToolResult(outputs=[file_out(out)], data=data, warnings=ctx.warnings)


# ---- watermark -------------------------------------------------------------------------


class WatermarkRequest(BaseModel):
    file_id: str | None = None
    file_ids: list[str] | None = None
    password: str | None = None
    text: str | None = None
    image_file_id: str | None = None
    opacity: float = Field(default=0.3, ge=0, le=1)
    rotation: float = 45
    font_size: float = 60
    color: str = "#ff0000"
    position: Literal["center", "tile", "top", "bottom"] = "center"
    under: bool = False
    pages: str = "all"
    font: str = "helv"
    image_scale: float = Field(default=0.5, gt=0, le=1)  # fraction of page width for image watermarks


def _ids(req) -> list[str]:
    ids = list(req.file_ids or [])
    if req.file_id and req.file_id not in ids:
        ids.insert(0, req.file_id)
    if not ids:
        raise HTTPException(status_code=422, detail="file_id or file_ids required")
    return ids


def _text_length(text: str, fk: dict[str, Any], size: float) -> float:
    if "fontfile" in fk:
        return pymupdf.Font(fontfile=fk["fontfile"]).text_length(text, fontsize=size)
    try:
        return pymupdf.get_text_length(text, fontname=fk["fontname"], fontsize=size)
    except Exception:  # noqa: BLE001
        return pymupdf.Font(fk["fontname"]).text_length(text, fontsize=size)


def _stamp_text(page: pymupdf.Page, text: str, cx: float, cy: float, size: float, angle: float, fk, rgb, opacity, ov):
    """Draw one line of text centred on displayed point (cx, cy), rotated by ``angle`` degrees.

    Uses ``insert_text`` at a computed baseline rather than ``insert_textbox``: a textbox silently draws
    nothing when the font's line height does not fit the box, which left watermarks blank."""
    tl = _text_length(text, fk, size)
    # Baseline sits ~0.35em below the centre so the cap height is vertically centred on (cx, cy).
    start = to_page_space(page, pymupdf.Point(cx - tl / 2, cy + size * 0.35))
    morph = (to_page_space(page, pymupdf.Point(cx, cy)), pymupdf.Matrix(angle)) if angle % 360 else None
    page.insert_text(
        start,
        text,
        fontsize=size,
        color=rgb,
        fill_opacity=opacity,
        rotate=text_rotation(page),
        morph=morph,
        overlay=ov,
        **fk,
    )


def _text_watermark(page: pymupdf.Page, req: WatermarkRequest) -> None:
    rgb = hex_to_rgb(req.color) or (1, 0, 0)
    fk = font_kwargs(req.text or "", req.font)
    size = req.font_size
    pr = page.rect
    ov = not req.under
    if req.position == "tile":
        tl = _text_length(req.text, fk, size)
        step_x, step_y = tl + size, size * 2.5
        y, row = step_y / 2, 0
        while y < pr.height + step_y / 2:
            x = step_x / 2 if row % 2 == 0 else 0
            while x < pr.width + step_x / 2:
                _stamp_text(page, req.text, x, y, size, req.rotation, fk, rgb, req.opacity, ov)
                x += step_x
            y += step_y
            row += 1
        return
    cx, cy = {
        "top": (pr.width / 2, size),
        "bottom": (pr.width / 2, pr.height - size),
        "center": (pr.width / 2, pr.height / 2),
    }[req.position]
    _stamp_text(page, req.text, cx, cy, size, req.rotation, fk, rgb, req.opacity, ov)


def _image_watermark(page: pymupdf.Page, req: WatermarkRequest, png: bytes, iw: int, ih: int) -> None:
    pr = page.rect
    w = pr.width * req.image_scale
    h = w * ih / iw
    if h > pr.height * 0.9:
        h = pr.height * 0.9
        w = h * iw / ih

    def rect_at(cx, cy):
        return pymupdf.Rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)

    if req.position == "tile":
        y = h / 2
        while y < pr.height + h:
            x = w / 2
            while x < pr.width + w:
                r = rect_at(x, y) & pr
                if not r.is_empty:
                    place_image(page, r, stream=png, overlay=not req.under)
                x += w * 1.5
            y += h * 1.5
        return
    cy = {"top": h / 2 + 20, "bottom": pr.height - h / 2 - 20, "center": pr.height / 2}[req.position]
    place_image(page, rect_at(pr.width / 2, cy), stream=png, overlay=not req.under)


@router.post("/watermark", response_model=ToolResult)
def watermark(req: WatermarkRequest):
    if not req.text and not req.image_file_id:
        raise HTTPException(status_code=422, detail="Provide watermark text or an image")
    png = None
    iw = ih = 0
    if req.image_file_id:
        from PIL import Image

        rotation = req.rotation if req.rotation % 360 else 0
        png = image_bytes_with_opacity(store.path(req.image_file_id), req.opacity, rotation)
        with Image.open(io.BytesIO(png)) as im:
            iw, ih = im.size
    outputs = []
    warnings: list[str] = []
    for fid in _ids(req):
        doc = open_pdf(fid, req.password)
        sf = store.get(fid)
        try:
            for i in pages_of(doc, req.pages):
                page = doc[i]
                if req.text:
                    _text_watermark(page, req)
                if png:
                    _image_watermark(page, req, png, iw, ih)
            outputs.append(file_out(save_doc(doc, with_suffix(sf.name, "-watermarked"))))
        finally:
            doc.close()
    return ToolResult(outputs=outputs, data={"count": len(outputs)}, warnings=warnings)


# ---- page numbers / header-footer ----------------------------------------------------------

_ROMAN = [
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"),
    (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
]  # fmt: skip


def to_roman(n: int) -> str:
    out = ""
    for v, s in _ROMAN:
        while n >= v:
            out += s
            n -= v
    return out


def to_alpha(n: int) -> str:
    out = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def fill_placeholders(fmt: str, n: int, total: int, extra: dict[str, str] | None = None) -> str:
    s = fmt.replace("{n}", str(n)).replace("{total}", str(total))
    s = s.replace("{roman}", to_roman(n).lower()).replace("{ROMAN}", to_roman(n)).replace("{alpha}", to_alpha(n))
    for k, v in (extra or {}).items():
        s = s.replace("{" + k + "}", v)
    return s


def draw_slot_text(page: pymupdf.Page, text: str, where: str, size: float, rgb, margin: float, fontname: str) -> None:
    """``where`` is ``"top-left"`` ... ``"bottom-right"`` (displayed space)."""
    if not text:
        return
    vert, horiz = where.split("-", 1)
    pr = page.rect
    fk = font_kwargs(text, fontname)
    tl = _text_length(text, fk, size)
    x = {"left": margin, "center": (pr.width - tl) / 2, "right": pr.width - margin - tl}[horiz]
    y = margin + size if vert == "top" else pr.height - margin
    page.insert_text(to_page_space(page, (x, y)), text, fontsize=size, color=rgb, rotate=text_rotation(page), **fk)


class PageNumbersRequest(BaseModel):
    file_id: str
    password: str | None = None
    position: str = "bottom-center"
    format: str = "{n}"
    start: int = 1
    font_size: float = 11
    pages: str = "all"
    color: str = "#000000"
    margin: float = 28
    font: str = "helv"


@router.post("/page-numbers", response_model=ToolResult)
def page_numbers(req: PageNumbersRequest):
    if req.position not in {f"{v}-{h}" for v in ("top", "bottom") for h in ("left", "center", "right")}:
        raise HTTPException(status_code=422, detail="Bad position")
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    try:
        idx = pages_of(doc, req.pages)
        total = len(idx)
        rgb = hex_to_rgb(req.color)
        for k, i in enumerate(idx):
            n = req.start + k
            text = fill_placeholders(req.format, n, total)
            draw_slot_text(doc[i], text, req.position, req.font_size, rgb, req.margin, font_for(req.font))
        out = save_doc(doc, with_suffix(sf.name, "-numbered"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data={"numbered": total})


class HeaderFooterRequest(BaseModel):
    file_id: str
    password: str | None = None
    header_left: str | None = None
    header_center: str | None = None
    header_right: str | None = None
    footer_left: str | None = None
    footer_center: str | None = None
    footer_right: str | None = None
    font_size: float = 10
    color: str = "#000000"
    margin: float = 28
    bates_start: int | None = None
    bates_digits: int = 6
    bates_prefix: str = ""
    pages: str = "all"
    font: str = "helv"


@router.post("/header-footer", response_model=ToolResult)
def header_footer(req: HeaderFooterRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    try:
        idx = pages_of(doc, req.pages)
        total = len(idx)
        rgb = hex_to_rgb(req.color)
        now = _dt.datetime.now()
        base = {
            "date": now.date().isoformat(),
            "datetime": now.strftime("%Y-%m-%d %H:%M"),
            "title": (doc.metadata or {}).get("title") or "",
            "filename": sf.name,
        }
        slots = {
            "top-left": req.header_left,
            "top-center": req.header_center,
            "top-right": req.header_right,
            "bottom-left": req.footer_left,
            "bottom-center": req.footer_center,
            "bottom-right": req.footer_right,
        }
        for k, i in enumerate(idx):
            extra = dict(base)
            if req.bates_start is not None:
                extra["bates"] = f"{req.bates_prefix}{req.bates_start + k:0{req.bates_digits}d}"
            else:
                extra["bates"] = ""
            for where, fmt in slots.items():
                if fmt:
                    text = fill_placeholders(fmt, k + 1, total, extra)
                    draw_slot_text(doc[i], text, where, req.font_size, rgb, req.margin, font_for(req.font))
        out = save_doc(doc, with_suffix(sf.name, "-stamped"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data={"pages": total})


# ---- background ------------------------------------------------------------------------


class BackgroundRequest(BaseModel):
    file_id: str
    password: str | None = None
    color: str | None = "#fff8e1"
    image_file_id: str | None = None
    opacity: float = Field(default=1.0, ge=0, le=1)
    pages: str = "all"
    fit: Literal["cover", "contain", "stretch"] = "cover"


def _fit_rect(pr: pymupdf.Rect, iw: int, ih: int, mode: str) -> tuple[pymupdf.Rect, bool]:
    if mode == "stretch":
        return pr, False
    if mode == "contain":
        return pr, True
    # cover: scale so the image covers the page, centred (overflow is clipped by the page)
    scale = max(pr.width / iw, pr.height / ih)
    w, h = iw * scale, ih * scale
    cx, cy = pr.width / 2, pr.height / 2
    return pymupdf.Rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), False


@router.post("/background", response_model=ToolResult)
def background(req: BackgroundRequest):
    if not req.color and not req.image_file_id:
        raise HTTPException(status_code=422, detail="Provide a colour or an image")
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    png = None
    iw = ih = 0
    if req.image_file_id:
        from PIL import Image

        png = image_bytes_with_opacity(store.path(req.image_file_id), req.opacity)
        with Image.open(io.BytesIO(png)) as im:
            iw, ih = im.size
    try:
        rgb = hex_to_rgb(req.color) if req.color else None
        for i in pages_of(doc, req.pages):
            page = doc[i]
            if rgb and not png:
                page.draw_rect(unrot_page_rect(page), color=None, fill=rgb, fill_opacity=req.opacity, overlay=False)
            if png:
                rect, keep = _fit_rect(page.rect, iw, ih, req.fit)
                place_image(page, rect, stream=png, keep=keep, overlay=False)
        out = save_doc(doc, with_suffix(sf.name, "-background"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)])


# ---- metadata --------------------------------------------------------------------------


class MetadataRequest(BaseModel):
    file_id: str
    password: str | None = None
    title: str | None = None
    author: str | None = None
    subject: str | None = None
    keywords: str | None = None
    creator: str | None = None
    producer: str | None = None
    strip: bool = False


def _metadata_payload(doc: pymupdf.Document) -> dict[str, Any]:
    has_xml = False
    try:
        has_xml = bool(doc.xref_xml_metadata() > 0)
    except Exception:  # noqa: BLE001
        pass
    return {"metadata": doc.metadata or {}, "xml_metadata": has_xml, "page_count": doc.page_count}


@router.post("/metadata", response_model=ToolResult)
def set_metadata(req: MetadataRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    try:
        if req.strip:
            doc.set_metadata({})
            try:
                doc.del_xml_metadata()
            except Exception:  # noqa: BLE001
                pass
        md = {} if req.strip else dict(doc.metadata or {})
        for k in ("title", "author", "subject", "keywords", "creator", "producer"):
            v = getattr(req, k)
            if v is not None:
                md[k] = v
        md.pop("format", None)
        md.pop("encryption", None)
        doc.set_metadata(md)
        data = _metadata_payload(doc)
        out = save_doc(doc, with_suffix(sf.name, "-metadata"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data=data)


@router.get("/metadata/{file_id}")
def get_metadata(file_id: str, password: str | None = None):
    doc = open_pdf(file_id, password)
    try:
        return _metadata_payload(doc)
    finally:
        doc.close()


# ---- bookmarks -------------------------------------------------------------------------


class OutlineItem(BaseModel):
    level: int = Field(ge=1)
    title: str
    page: int = Field(ge=1)


class BookmarksRequest(BaseModel):
    file_id: str
    password: str | None = None
    outline: str | list[OutlineItem] | None = None
    auto: bool = False


def parse_outline_text(text: str) -> list[list]:
    toc = []
    for raw in text.splitlines():
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip(" \t"))
        level = indent // 2 + 1 if raw.startswith(" ") else (indent + 1 if raw.startswith("\t") else 1)
        body = raw.strip()
        if "|" in body:
            title, pg = body.rsplit("|", 1)
            try:
                page = int(pg.strip())
            except ValueError as e:
                raise HTTPException(status_code=422, detail=f"Bad outline line: {raw!r}") from e
        else:
            title, page = body, 1
        toc.append([level, title.strip(), page])
    return toc


def normalize_toc(toc: list[list], page_count: int) -> list[list]:
    """Clamp pages and make levels strictly hierarchical (a level may only grow by one)."""
    out: list[list] = []
    prev = 0
    for level, title, page in toc:
        level = max(1, min(level, prev + 1))
        out.append([level, title, max(1, min(int(page), page_count))])
        prev = level
    return out


def detect_headings(doc: pymupdf.Document, max_levels: int = 3) -> list[list]:
    sizes: list[float] = []
    lines: list[tuple[int, float, str]] = []  # (page, size, text)
    for pno, page in enumerate(doc, start=1):
        for b in page.get_text("dict").get("blocks", []):
            if b.get("type") != 0:
                continue
            for ln in b.get("lines", []):
                spans = [s for s in ln.get("spans", []) if s.get("text", "").strip()]
                if not spans:
                    continue
                text = " ".join(s["text"].strip() for s in spans)
                size = max(s["size"] for s in spans)
                for s in spans:
                    sizes.extend([round(s["size"], 1)] * max(1, len(s["text"].strip())))
                lines.append((pno, round(size, 1), text))
    if not sizes:
        return []
    body = statistics.median(sizes)
    heads = [ln for ln in lines if ln[1] > body * 1.3 and 2 <= len(ln[2]) <= 120]
    if not heads:
        return []
    ranks = sorted({h[1] for h in heads}, reverse=True)[:max_levels]
    toc: list[list] = []
    seen: set[tuple[str, int]] = set()
    for pno, size, text in heads:
        if size not in ranks:
            continue
        key = (text.lower(), pno)
        if key in seen:
            continue
        seen.add(key)
        toc.append([ranks.index(size) + 1, text, pno])
    return toc


@router.post("/bookmarks", response_model=ToolResult)
def set_bookmarks(req: BookmarksRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    warnings: list[str] = []
    try:
        if isinstance(req.outline, str) and req.outline.strip():
            toc = parse_outline_text(req.outline)
        elif isinstance(req.outline, list) and req.outline:
            toc = [[o.level, o.title, o.page] for o in req.outline]
        else:
            toc = detect_headings(doc)
            if not toc:
                warnings.append("no headings detected; outline left unchanged")
                toc = doc.get_toc(simple=True)
        toc = normalize_toc(toc, doc.page_count)
        doc.set_toc(toc)
        out = save_doc(doc, with_suffix(sf.name, "-bookmarks"))
        data = {"toc": [{"level": lv, "title": t, "page": p} for lv, t, p in toc]}
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data=data, warnings=warnings)


@router.get("/bookmarks/{file_id}")
def get_bookmarks(file_id: str, password: str | None = None):
    doc = open_pdf(file_id, password)
    try:
        return [{"level": lv, "title": t, "page": max(1, p)} for lv, t, p in doc.get_toc(simple=True)]
    finally:
        doc.close()


# ---- crop --------------------------------------------------------------------------------


class CropRequest(BaseModel):
    file_id: str
    password: str | None = None
    pages: str = "all"
    top: float = 0
    right: float = 0
    bottom: float = 0
    left: float = 0
    auto: bool = False
    rect: Rect4 | None = None
    padding: float = 10


def content_bbox(page: pymupdf.Page) -> pymupdf.Rect:
    """Union of everything drawn on the page, in unrotated coordinates."""
    bbox = pymupdf.Rect()
    for _, r in page.get_bboxlog():
        rr = pymupdf.Rect(r)
        if not rr.is_empty and not rr.is_infinite:
            bbox |= rr
    for b in page.get_text("blocks"):
        bbox |= pymupdf.Rect(b[:4])
    for info in page.get_image_info():
        bbox |= pymupdf.Rect(info["bbox"])
    return bbox & unrot_page_rect(page)


@router.post("/crop", response_model=ToolResult)
def crop(req: CropRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    warnings: list[str] = []
    try:
        for i in pages_of(doc, req.pages):
            page = doc[i]
            pr = page.rect
            if req.rect is not None:
                rect = R(req.rect)
            elif req.auto:
                cb = content_bbox(page)
                if cb.is_empty:
                    warnings.append(f"page {i + 1}: no content found, left unchanged")
                    continue
                pad = req.padding
                cb = pymupdf.Rect(cb.x0 - pad, cb.y0 - pad, cb.x1 + pad, cb.y1 + pad) & unrot_page_rect(page)
                set_cropbox_unrotated(page, cb)
                continue
            else:
                rect = pymupdf.Rect(pr.x0 + req.left, pr.y0 + req.top, pr.x1 - req.right, pr.y1 - req.bottom)
            if rect.is_empty or rect.width < 1 or rect.height < 1:
                warnings.append(f"page {i + 1}: crop box would be empty, left unchanged")
                continue
            set_cropbox_display(page, rect)
        out = save_doc(doc, with_suffix(sf.name, "-cropped"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], warnings=warnings)


# ---- resize ---------------------------------------------------------------------------


class ResizeRequest(BaseModel):
    file_id: str
    password: str | None = None
    size: str = "A4"
    width: float | None = None
    height: float | None = None
    landscape: bool = False
    mode: Literal["fit", "fill", "stretch"] = "fit"
    pages: str = "all"


def show_page_upright(target: pymupdf.Page, rect: pymupdf.Rect, src: pymupdf.Document, pno: int, keep: bool = True):
    """``show_pdf_page`` that honours the *source* page's /Rotate (which PyMuPDF ignores)."""
    rot = (-src[pno].rotation) % 360
    target.show_pdf_page(rect, src, pno, keep_proportion=keep, rotate=rot)


@router.post("/resize", response_model=ToolResult)
def resize(req: ResizeRequest):
    if req.size.lower() == "custom":
        if not req.width or not req.height:
            raise HTTPException(status_code=422, detail="custom size needs width and height")
        tw, th = float(req.width), float(req.height)
    else:
        r = pymupdf.paper_rect(req.size)
        if r.is_empty or r.width <= 0:
            raise HTTPException(status_code=422, detail=f"Unknown paper size {req.size!r}")
        tw, th = r.width, r.height
    if req.landscape and tw < th:
        tw, th = th, tw
    src = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    out_doc = pymupdf.open()
    try:
        idx = set(pages_of(src, req.pages))
        for i in range(src.page_count):
            if i not in idx:
                out_doc.insert_pdf(src, from_page=i, to_page=i)
                continue
            sp = src[i]
            np_ = out_doc.new_page(width=tw, height=th)
            target = np_.rect
            if req.mode == "fill":
                scale = max(tw / sp.rect.width, th / sp.rect.height)
                w, h = sp.rect.width * scale, sp.rect.height * scale
                target = pymupdf.Rect((tw - w) / 2, (th - h) / 2, (tw + w) / 2, (th + h) / 2)
            show_page_upright(np_, target, src, i, keep=req.mode != "stretch")
        out = save_doc(out_doc, with_suffix(sf.name, "-resized"))
    finally:
        out_doc.close()
        src.close()
    return ToolResult(outputs=[file_out(out)], data={"width": tw, "height": th})


# ---- annotations: remove / flatten ---------------------------------------------------------


class RemoveAnnotsRequest(BaseModel):
    file_id: str
    password: str | None = None
    types: list[str] | None = None
    pages: str = "all"


@router.post("/remove-annotations", response_model=ToolResult)
def remove_annotations(req: RemoveAnnotsRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    removed = 0
    try:
        wanted = {t.lower() for t in req.types} if req.types else None
        for i in pages_of(doc, req.pages):
            page = doc[i]
            xrefs = [a.xref for a in page.annots() if wanted is None or a.type[1].lower() in wanted]
            for xref in xrefs:
                page.delete_annot(find_annot(page, xref))
                removed += 1
        out = save_doc(doc, with_suffix(sf.name, "-no-annots"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data={"removed": removed})


class FileRequest(BaseModel):
    file_id: str
    password: str | None = None


@router.post("/flatten-annotations", response_model=ToolResult)
def flatten_annotations(req: FileRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    try:
        doc.bake(annots=True, widgets=False)
        out = save_doc(doc, with_suffix(sf.name, "-flat"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)])
