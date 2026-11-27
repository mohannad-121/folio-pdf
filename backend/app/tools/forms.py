"""Interactive form tools: list, fill, create, remove, export/import field data, flatten."""

from __future__ import annotations

import csv
import io
import json
import re
import xml.etree.ElementTree as ET
from typing import Any, Literal

import pymupdf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..pdfutil import file_out, open_pdf, save_doc, with_suffix
from ..schemas import ToolResult
from ..storage import store
from .edit import R, Rect4, disp_list, find_widget, get_page, hex_to_rgb, set_widget_value, to_page_space

router = APIRouter(prefix="/api/forms", tags=["forms"])

FieldType = Literal["text", "checkbox", "radio", "combobox", "listbox", "signature", "button", "date"]

_TYPE_NAMES = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "combobox",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "listbox",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "signature",
    pymupdf.PDF_WIDGET_TYPE_BUTTON: "button",
}
_TYPE_CODES = {v: k for k, v in _TYPE_NAMES.items()}
_TYPE_CODES["date"] = pymupdf.PDF_WIDGET_TYPE_TEXT

FLAG_READONLY = 1
FLAG_REQUIRED = 2
FLAG_MULTILINE = 1 << 12


def widget_info(w: pymupdf.Widget, page: int, pg: pymupdf.Page) -> dict[str, Any]:
    flags = int(w.field_flags or 0)
    info: dict[str, Any] = {
        "name": w.field_name,
        "type": _TYPE_NAMES.get(w.field_type, "unknown"),
        "page": page,
        "rect": disp_list(pg, w.rect),
        "value": w.field_value,
        "required": bool(flags & FLAG_REQUIRED),
        "readonly": bool(flags & FLAG_READONLY),
        "xref": w.xref,
        "tooltip": w.field_label or "",
    }
    if w.field_type in (pymupdf.PDF_WIDGET_TYPE_COMBOBOX, pymupdf.PDF_WIDGET_TYPE_LISTBOX):
        info["options"] = list(w.choice_values or [])
    if w.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON:
        info["on_state"] = w.on_state()
    if w.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT:
        info["max_len"] = w.text_maxlen or None
        info["multiline"] = bool(flags & FLAG_MULTILINE)
    return info


def collect_values(doc: pymupdf.Document) -> dict[str, Any]:
    """Field name -> value (radio groups collapse to the selected on-state)."""
    values: dict[str, Any] = {}
    for page in doc:
        for w in page.widgets():
            name = w.field_name
            if w.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON:
                if w.field_value not in (None, "Off", "", False):
                    values[name] = w.on_state()
                else:
                    values.setdefault(name, "Off")
            elif w.field_type == pymupdf.PDF_WIDGET_TYPE_CHECKBOX:
                values[name] = w.field_value not in (None, "Off", "", False)
            else:
                values[name] = w.field_value
    return values


def _xfa(doc: pymupdf.Document) -> bool:
    try:
        cat = doc.pdf_catalog()
        acro = doc.xref_get_key(cat, "AcroForm")
        if acro[0] == "xref":
            xref = int(acro[1].split()[0])
            return doc.xref_get_key(xref, "XFA")[0] != "null"
        return acro[0] == "dict" and "/XFA" in acro[1]
    except Exception:  # noqa: BLE001
        return False


@router.get("/fields/{file_id}")
def list_fields(file_id: str, password: str | None = None):
    doc = open_pdf(file_id, password)
    try:
        fields = [widget_info(w, pno, page) for pno, page in enumerate(doc, start=1) for w in page.widgets()]
        return {"fields": fields, "has_forms": bool(doc.is_form_pdf), "xfa": _xfa(doc), "count": len(fields)}
    finally:
        doc.close()


def fill_values(doc: pymupdf.Document, values: dict[str, Any]) -> tuple[int, list[str], list[str]]:
    filled, missing, warnings = 0, [], []
    for name, value in values.items():
        ws = find_widget(doc, name)
        if not ws:
            missing.append(name)
            continue
        try:
            set_widget_value(ws, value)
            filled += 1
        except Exception as e:  # noqa: BLE001
            warnings.append(f"{name}: {e}")
    if missing:
        warnings.append("unknown fields: " + ", ".join(missing))
    return filled, missing, warnings


class FillRequest(BaseModel):
    file_id: str
    password: str | None = None
    values: dict[str, Any]
    flatten: bool = False


@router.post("/fill", response_model=ToolResult)
def fill(req: FillRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    try:
        filled, missing, warnings = fill_values(doc, req.values)
        if req.flatten:
            doc.bake(annots=False, widgets=True)
        out = save_doc(doc, with_suffix(sf.name, "-filled"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data={"filled": filled, "missing": missing}, warnings=warnings)


# ---- add / remove fields ----------------------------------------------------------


class NewField(BaseModel):
    type: FieldType
    name: str
    page: int = Field(ge=1)
    rect: Rect4
    options: list[str] | None = None
    default: Any = None
    required: bool = False
    readonly: bool = False
    multiline: bool = False
    font_size: float = 11
    border_color: str | None = "#000000"
    fill_color: str | None = None
    text_color: str | None = "#000000"
    checked: bool = False
    max_len: int | None = None
    tooltip: str | None = None
    calc: str | None = None
    date_format: str = "yyyy-mm-dd"


class AddFieldsRequest(BaseModel):
    file_id: str
    password: str | None = None
    fields: list[NewField]


def _make_widget(f: NewField, rect: pymupdf.Rect, caption: str | None = None) -> pymupdf.Widget:
    w = pymupdf.Widget()
    w.field_type = _TYPE_CODES[f.type]
    w.field_name = f.name
    w.rect = rect
    w.text_fontsize = f.font_size
    flags = 0
    if f.required:
        flags |= FLAG_REQUIRED
    if f.readonly:
        flags |= FLAG_READONLY
    if f.multiline and f.type == "text":
        flags |= FLAG_MULTILINE
    w.field_flags = flags
    if f.border_color:
        w.border_color = hex_to_rgb(f.border_color)
        w.border_width = 1
    if f.fill_color:
        w.fill_color = hex_to_rgb(f.fill_color)
    if f.text_color:
        w.text_color = hex_to_rgb(f.text_color)
    if f.tooltip:
        w.field_label = f.tooltip
    if f.type in ("combobox", "listbox"):
        w.choice_values = list(f.options or [])
        if f.default is not None:
            w.field_value = str(f.default)
    elif f.type == "checkbox":
        w.field_value = bool(f.checked or f.default in (True, "Yes", "yes", "on", "true"))
    elif f.type == "radio":
        w.button_caption = caption or ""
    elif f.type in ("text", "date"):
        if f.max_len:
            w.text_maxlen = f.max_len
        if f.default is not None:
            w.field_value = str(f.default)
    elif f.type == "button":
        w.button_caption = str(f.default or f.name)
    return w


def _apply_scripts(doc: pymupdf.Document, xref: int, f: NewField) -> None:
    """Write the widget's /AA JavaScript actions directly (PyMuPDF 2.2 does not persist ``script_*``)."""
    actions: dict[str, str] = {}
    if f.type == "date":
        actions["F"] = f'AFDate_FormatEx("{f.date_format}");'
        actions["K"] = f'AFDate_KeystrokeEx("{f.date_format}");'
    if f.calc:
        actions["C"] = f.calc
    if not actions:
        return
    body = " ".join(f"/{k} << /S /JavaScript /JS {_pdf_string(v)} >>" for k, v in actions.items())
    doc.xref_set_key(xref, "AA", f"<< {body} >>")


@router.post("/add-fields", response_model=ToolResult)
def add_fields(req: AddFieldsRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    warnings: list[str] = []
    added = 0
    try:
        for f in req.fields:
            try:
                page = get_page(doc, f.page)
                rect = R(f.rect)
                if f.type == "radio":
                    opts = f.options or ["Yes"]
                    n = len(opts)
                    h = rect.height / n
                    for k, opt in enumerate(opts):
                        sub = pymupdf.Rect(
                            rect.x0, rect.y0 + k * h, rect.x0 + min(rect.width, h), rect.y0 + (k + 1) * h
                        )
                        page.add_widget(_make_widget(f, to_page_space(page, sub), caption=opt))
                    if n > 1:
                        warnings.append(
                            f"{f.name}: radio groups created by PyMuPDF share one name but on-states may read as 'None'"
                        )
                else:
                    annot = page.add_widget(_make_widget(f, to_page_space(page, rect)))
                    if f.type == "date" or f.calc:
                        _apply_scripts(doc, annot.xref, f)
                added += 1
            except Exception as e:  # noqa: BLE001
                warnings.append(f"{f.name}: {type(e).__name__}: {e}")
        out = save_doc(doc, with_suffix(sf.name, "-fields"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data={"added": added}, warnings=warnings)


class RemoveFieldsRequest(BaseModel):
    file_id: str
    password: str | None = None
    names: list[str] | None = None


@router.post("/remove-fields", response_model=ToolResult)
def remove_fields(req: RemoveFieldsRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    removed = 0
    try:
        wanted = set(req.names) if req.names else None
        for page in doc:
            for w in list(page.widgets()):
                if wanted is None or w.field_name in wanted:
                    page.delete_widget(w)
                    removed += 1
        out = save_doc(doc, with_suffix(sf.name, "-nofields"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data={"removed": removed})


# ---- export / import -------------------------------------------------------------


def _pdf_string(s: Any) -> str:
    """Encode a Python value as a PDF string literal (UTF-16BE hex when non-Latin-1)."""
    if isinstance(s, bool):
        s = "Yes" if s else "Off"
    s = "" if s is None else str(s)
    try:
        s.encode("latin-1")
    except UnicodeEncodeError:
        return "<FEFF" + s.encode("utf-16-be").hex().upper() + ">"
    esc = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("\r", "\\r").replace("\n", "\\n")
    return f"({esc})"


def build_fdf(values: dict[str, Any], pdf_name: str) -> bytes:
    fields = "".join(f"<< /T {_pdf_string(k)} /V {_pdf_string(v)} >>\n" for k, v in values.items())
    body = (
        "%FDF-1.2\n"
        "1 0 obj\n"
        f"<< /FDF << /Fields [\n{fields}] /F {_pdf_string(pdf_name)} >> >>\n"
        "endobj\n"
        "trailer\n"
        "<< /Root 1 0 R >>\n"
        "%%EOF\n"
    )
    return body.encode("latin-1", "replace")


def build_xfdf(values: dict[str, Any], pdf_name: str) -> bytes:
    root = ET.Element("xfdf", {"xmlns": "http://ns.adobe.com/xfdf/", "xml:space": "preserve"})
    ET.SubElement(root, "f", {"href": pdf_name})
    fields = ET.SubElement(root, "fields")
    for k, v in values.items():
        fe = ET.SubElement(fields, "field", {"name": k})
        vals = v if isinstance(v, list) else [v]
        for one in vals:
            ve = ET.SubElement(fe, "value")
            ve.text = ("Yes" if one else "Off") if isinstance(one, bool) else ("" if one is None else str(one))
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")


def build_csv(values: dict[str, Any]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(list(values.keys()))
    w.writerow(["" if v is None else ("Yes" if v is True else "Off" if v is False else v) for v in values.values()])
    return buf.getvalue().encode("utf-8-sig")


class ExportRequest(BaseModel):
    file_id: str
    password: str | None = None
    format: Literal["json", "csv", "fdf", "xfdf"] = "json"


@router.post("/export", response_model=ToolResult)
def export_data(req: ExportRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    try:
        values = collect_values(doc)
    finally:
        doc.close()
    if req.format == "json":
        data, ctype = json.dumps(values, indent=2, ensure_ascii=False).encode("utf-8"), "application/json"
    elif req.format == "csv":
        data, ctype = build_csv(values), "text/csv"
    elif req.format == "fdf":
        data, ctype = build_fdf(values, sf.name), "application/vnd.fdf"
    else:
        data, ctype = build_xfdf(values, sf.name), "application/vnd.adobe.xfdf"
    out = store.save_bytes(data, with_suffix(sf.name, "-data", "." + req.format), ctype)
    return ToolResult(outputs=[file_out(out)], data={"fields": values, "count": len(values)})


_FDF_FIELD = re.compile(
    rb"/T\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)\s*/V\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|/[^\s/>\]]+)"
)
_FDF_FIELD_VT = re.compile(
    rb"/V\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|/[^\s/>\]]+)\s*/T\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)"
)


def _decode_pdf_string(tok: bytes) -> str:
    if tok.startswith(b"/"):
        return tok[1:].decode("latin-1")
    if tok.startswith(b"<"):
        raw = bytes.fromhex(re.sub(rb"\s", b"", tok[1:-1]).decode("ascii"))
        if raw.startswith(b"\xfe\xff"):
            return raw[2:].decode("utf-16-be", "replace")
        return raw.decode("latin-1", "replace")
    body = tok[1:-1]
    out = bytearray()
    i = 0
    while i < len(body):
        c = body[i]
        if c == 0x5C and i + 1 < len(body):  # backslash
            n = body[i + 1]
            mapping = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}
            if n in mapping:
                out.append(mapping[n])
                i += 2
                continue
            if 48 <= n <= 55:  # octal
                j = i + 1
                oct_digits = b""
                while j < len(body) and len(oct_digits) < 3 and 48 <= body[j] <= 55:
                    oct_digits += bytes([body[j]])
                    j += 1
                out.append(int(oct_digits, 8) & 0xFF)
                i = j
                continue
            out.append(n)
            i += 2
            continue
        out.append(c)
        i += 1
    raw = bytes(out)
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", "replace")
    return raw.decode("latin-1", "replace")


def parse_fdf(data: bytes) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for m in _FDF_FIELD.finditer(data):
        values[_decode_pdf_string(m.group(1))] = _decode_pdf_string(m.group(2))
    for m in _FDF_FIELD_VT.finditer(data):
        values.setdefault(_decode_pdf_string(m.group(2)), _decode_pdf_string(m.group(1)))
    return values


def parse_xfdf(data: bytes) -> dict[str, Any]:
    root = ET.fromstring(data)
    values: dict[str, Any] = {}

    def walk(el, prefix=""):
        for child in el:
            tag = child.tag.split("}")[-1]
            if tag == "field":
                name = prefix + child.get("name", "")
                vals = [v.text or "" for v in child if v.tag.split("}")[-1] == "value"]
                if vals:
                    values[name] = vals[0] if len(vals) == 1 else vals
                walk(child, name + ".")
            elif tag == "fields":
                walk(child, prefix)

    walk(root)
    return values


def parse_csv(text: str) -> dict[str, Any]:
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if not rows:
        return {}
    if len(rows) >= 2 and len(rows[0]) == len(rows[1]) and len(rows[0]) > 2:
        return dict(zip(rows[0], rows[1], strict=False))
    if all(len(r) >= 2 for r in rows):
        start = 1 if rows[0][0].strip().lower() in ("name", "field") else 0
        return {r[0]: r[1] for r in rows[start:]}
    return dict(zip(rows[0], rows[1], strict=False)) if len(rows) >= 2 else {}


def parse_form_data(data: bytes, name: str) -> dict[str, Any]:
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    head = data.lstrip()[:64]
    if ext == "json" or head.startswith(b"{"):
        obj = json.loads(data.decode("utf-8-sig"))
        if isinstance(obj, dict) and isinstance(obj.get("fields"), dict):
            obj = obj["fields"]
        if not isinstance(obj, dict):
            raise HTTPException(status_code=422, detail="JSON must be an object of field values")
        return obj
    if ext == "fdf" or head.startswith(b"%FDF"):
        return parse_fdf(data)
    if ext == "xfdf" or head.startswith(b"<"):
        return parse_xfdf(data)
    return parse_csv(data.decode("utf-8-sig", "replace"))


class ImportRequest(BaseModel):
    file_id: str
    password: str | None = None
    data_file_id: str
    flatten: bool = False


@router.post("/import", response_model=ToolResult)
def import_data(req: ImportRequest):
    dsf = store.get(req.data_file_id)
    values = parse_form_data(dsf.fs_path.read_bytes(), dsf.name)
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    try:
        filled, missing, warnings = fill_values(doc, values)
        if req.flatten:
            doc.bake(annots=False, widgets=True)
        out = save_doc(doc, with_suffix(sf.name, "-filled"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data={"filled": filled, "missing": missing}, warnings=warnings)


class FlattenRequest(BaseModel):
    file_id: str
    password: str | None = None


@router.post("/flatten", response_model=ToolResult)
def flatten(req: FlattenRequest):
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    try:
        doc.bake(annots=False, widgets=True)
        out = save_doc(doc, with_suffix(sf.name, "-flat"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)])
