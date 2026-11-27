"""Security tools: protect, unlock, redact (with preview), sanitize, permissions."""

from __future__ import annotations

import re
from collections import defaultdict

import pymupdf
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..pdfutil import file_out, open_pdf, save_doc, with_suffix
from ..schemas import ToolResult, parse_page_spec
from ..storage import store

router = APIRouter(prefix="/api/security", tags=["security"])


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


# ---- protect ----------------------------------------------------------------------


class ProtectRequest(_Base):
    user_password: str | None = None
    owner_password: str | None = None
    allow_print: bool = True
    allow_copy: bool = True
    allow_modify: bool = False
    allow_annotate: bool = True
    allow_accessibility: bool = True


def _permissions(req: ProtectRequest) -> int:
    perm = 0
    if req.allow_print:
        perm |= pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ
    if req.allow_copy:
        perm |= pymupdf.PDF_PERM_COPY
    if req.allow_modify:
        perm |= pymupdf.PDF_PERM_MODIFY | pymupdf.PDF_PERM_ASSEMBLE
    if req.allow_annotate:
        perm |= pymupdf.PDF_PERM_ANNOTATE | pymupdf.PDF_PERM_FORM
    if req.allow_accessibility:
        perm |= pymupdf.PDF_PERM_ACCESSIBILITY
    return perm


@router.post("/protect", response_model=ToolResult)
def protect(req: ProtectRequest):
    if not req.user_password and not req.owner_password:
        raise HTTPException(status_code=400, detail="Provide an open password, a permissions password, or both")
    user_pw = req.user_password or ""
    owner_pw = req.owner_password or req.user_password or ""
    outputs = []
    for fid in req.ids():
        doc = open_pdf(fid, req.password)
        sf = save_doc(
            doc,
            with_suffix(store.get(fid).name, "-protected"),
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            owner_pw=owner_pw,
            user_pw=user_pw,
            permissions=_permissions(req),
        )
        outputs.append(file_out(sf, doc.page_count))
        doc.close()
    return ToolResult(outputs=outputs, data={"encryption": "AES-256", "needs_password": bool(user_pw)})


def _encryption_method(doc: pymupdf.Document) -> str | None:
    """Encryption description ("Standard V5 R6 256-bit AES") or None.

    Deliberately avoids ``doc.needs_pass``/``doc.is_encrypted``: ``is_encrypted`` flips to False once
    authenticated, and reading ``needs_pass`` after ``authenticate()`` breaks a later decrypted save
    (PyMuPDF 2.2 produces "aes padding out of range" streams).
    """
    return (doc.metadata or {}).get("encryption") or None


# ---- unlock -----------------------------------------------------------------------


@router.post("/unlock", response_model=ToolResult)
def unlock(req: _Base):
    outputs = []
    was_encrypted = []
    for fid in req.ids():
        doc = open_pdf(fid, req.password)  # 401 when a user password is needed and missing/wrong
        was_encrypted.append(_encryption_method(doc) is not None)
        sf = save_doc(doc, with_suffix(store.get(fid).name, "-unlocked"), encryption=pymupdf.PDF_ENCRYPT_NONE)
        outputs.append(file_out(sf, doc.page_count))
        doc.close()
    return ToolResult(outputs=outputs, data={"was_encrypted": was_encrypted})


# ---- permissions ------------------------------------------------------------------


@router.get("/permissions/{file_id}")
def permissions(file_id: str, password: str | None = None):
    sf = store.get(file_id)
    doc = pymupdf.open(sf.fs_path)
    needs_pass = bool(doc.needs_pass)
    if needs_pass and not (password and doc.authenticate(password)):
        doc.close()
        return {"encrypted": True, "needs_password": True, "permissions": {}, "encryption_method": None}
    p = doc.permissions
    enc = _encryption_method(doc)
    result = {
        "encrypted": enc is not None,
        "needs_password": needs_pass,
        "encryption_method": enc,
        "permissions": {
            "print": bool(p & pymupdf.PDF_PERM_PRINT),
            "print_hq": bool(p & pymupdf.PDF_PERM_PRINT_HQ),
            "copy": bool(p & pymupdf.PDF_PERM_COPY),
            "modify": bool(p & pymupdf.PDF_PERM_MODIFY),
            "annotate": bool(p & pymupdf.PDF_PERM_ANNOTATE),
            "form": bool(p & pymupdf.PDF_PERM_FORM),
            "accessibility": bool(p & pymupdf.PDF_PERM_ACCESSIBILITY),
            "assemble": bool(p & pymupdf.PDF_PERM_ASSEMBLE),
        },
    }
    doc.close()
    return result


# ---- redact -----------------------------------------------------------------------

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(
    r"(?<!\w)(?<!\d[\s.-])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,5}(?!\w)(?![\s.-]?\d)"
)
SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b")


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def _phone_ok(m: str) -> bool:
    return 7 <= sum(c.isdigit() for c in m) <= 15


def _card_ok(m: str) -> bool:
    digits = re.sub(r"\D", "", m)
    return 13 <= len(digits) <= 19 and _luhn(digits)


class Region(BaseModel):
    page: int = Field(ge=1)
    rects: list[list[float]]


class RedactOptions(BaseModel):
    terms: str | list[str] | None = None
    emails: bool = False
    phones: bool = False
    ssn: bool = False
    credit_cards: bool = False
    iban: bool = False
    regex: str | None = None
    case_sensitive: bool = False
    whole_words: bool = False
    pages: str = "all"


class RedactRequest(_Base, RedactOptions):
    fill_color: str = "#000000"
    regions: list[Region] | None = None


def _term_list(terms: str | list[str] | None) -> list[str]:
    if not terms:
        return []
    items = terms if isinstance(terms, list) else [terms]
    out: list[str] = []
    for t in items:
        out += [s.strip() for s in t.splitlines() if s.strip()]
    return out


def _patterns(opts: RedactOptions) -> list[tuple[re.Pattern, object]]:
    pats: list[tuple[re.Pattern, object]] = []
    if opts.emails:
        pats.append((EMAIL_RE, None))
    if opts.phones:
        pats.append((PHONE_RE, _phone_ok))
    if opts.ssn:
        pats.append((SSN_RE, None))
    if opts.credit_cards:
        pats.append((CARD_RE, _card_ok))
    if opts.iban:
        pats.append((IBAN_RE, None))
    if opts.regex:
        try:
            pats.append((re.compile(opts.regex, 0 if opts.case_sensitive else re.IGNORECASE), None))
        except re.error as e:
            raise HTTPException(status_code=400, detail=f"Invalid regular expression: {e}") from e
    return pats


def _term_patterns(opts: RedactOptions) -> list[re.Pattern]:
    flags = 0 if opts.case_sensitive else re.IGNORECASE
    out = []
    for t in _term_list(opts.terms):
        pat = re.escape(t)
        if opts.whole_words:
            pat = rf"(?<!\w){pat}(?!\w)"
        out.append(re.compile(pat, flags))
    return out


def _line_rects(page: pymupdf.Page, patterns: list[tuple[re.Pattern, object]]) -> list[pymupdf.Rect]:
    """Run regexes over reconstructed text lines; map matches back to word bboxes."""
    if not patterns:
        return []
    lines: dict[tuple[int, int], list[tuple]] = defaultdict(list)
    for w in page.get_text("words"):
        lines[(w[5], w[6])].append(w)
    rects: list[pymupdf.Rect] = []
    for words in lines.values():
        words.sort(key=lambda w: w[7])
        text = ""
        spans = []  # (start, end, rect)
        for w in words:
            if text:
                text += " "
            start = len(text)
            text += w[4]
            spans.append((start, len(text), pymupdf.Rect(w[:4])))
        for pat, check in patterns:
            for m in pat.finditer(text):
                if m.end() == m.start() or (check and not check(m.group(0))):
                    continue
                r = _span_rect(spans, m.start(), m.end())
                if r is not None:
                    rects.append(r)
    return rects


def _span_rect(spans: list[tuple], s: int, e: int) -> pymupdf.Rect | None:
    out: pymupdf.Rect | None = None
    for ws, we, rect in spans:
        if we <= s or ws >= e:
            continue
        n = max(we - ws, 1)
        frac0 = max(0, s - ws) / n
        frac1 = min(we, e) - ws
        frac1 = frac1 / n
        part = pymupdf.Rect(rect.x0 + rect.width * frac0, rect.y0, rect.x0 + rect.width * frac1, rect.y1)
        out = part if out is None else out | part
    return out


def find_matches(doc: pymupdf.Document, opts: RedactOptions) -> dict[int, list[pymupdf.Rect]]:
    """Return {0-based page index: [rects]} for every term/pattern match."""
    try:
        idx = parse_page_spec(opts.pages or "all", doc.page_count)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid page selection: {e}") from e
    patterns = _patterns(opts)
    simple_terms = [] if (opts.case_sensitive or opts.whole_words) else _term_list(opts.terms)
    term_pats = _term_patterns(opts) if (opts.case_sensitive or opts.whole_words) else []
    all_pats = patterns + [(p, None) for p in term_pats]
    found: dict[int, list[pymupdf.Rect]] = {}
    for i in idx:
        page = doc[i]
        rects: list[pymupdf.Rect] = []
        for term in simple_terms:
            rects += page.search_for(term)
        rects += _line_rects(page, all_pats)
        if rects:
            found[i] = rects
    return found


def _hex_color(value: str) -> tuple[float, float, float]:
    v = (value or "#000000").lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6:
        raise HTTPException(status_code=400, detail="fill_color must be a hex colour like #000000")
    try:
        return tuple(int(v[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError as e:
        raise HTTPException(status_code=400, detail="fill_color must be a hex colour like #000000") from e


@router.post("/redact", response_model=ToolResult)
def redact(req: RedactRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    color = _hex_color(req.fill_color)
    found = find_matches(doc, req)
    for region in req.regions or []:
        if region.page > doc.page_count:
            doc.close()
            raise HTTPException(status_code=400, detail=f"Region page {region.page} does not exist")
        for r in region.rects:
            if len(r) != 4:
                doc.close()
                raise HTTPException(status_code=400, detail="Each region rect needs four numbers")
            found.setdefault(region.page - 1, []).append(pymupdf.Rect(r))
    per_page: dict[str, int] = {}
    total = 0
    for i, rects in found.items():
        page = doc[i]
        n = 0
        for r in rects:
            if r.is_empty or r.is_infinite:
                continue
            page.add_redact_annot(r, fill=color)
            n += 1
        if n:
            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS)
            per_page[str(i + 1)] = n
            total += n
    sf = save_doc(doc, with_suffix(store.get(fid).name, "-redacted"), garbage=4)
    n_pages = doc.page_count
    doc.close()
    return ToolResult(outputs=[file_out(sf, n_pages)], data={"matches": total, "per_page": per_page})


@router.get("/redact/preview/{file_id}")
def redact_preview(
    file_id: str,
    terms: list[str] | None = Query(default=None),
    emails: bool = False,
    phones: bool = False,
    ssn: bool = False,
    credit_cards: bool = False,
    iban: bool = False,
    regex: str | None = None,
    case_sensitive: bool = False,
    whole_words: bool = False,
    pages: str = "all",
    password: str | None = None,
):
    opts = RedactOptions(
        terms=terms,
        emails=emails,
        phones=phones,
        ssn=ssn,
        credit_cards=credit_cards,
        iban=iban,
        regex=regex,
        case_sensitive=case_sensitive,
        whole_words=whole_words,
        pages=pages,
    )
    doc = open_pdf(file_id, password)
    found = find_matches(doc, opts)
    doc.close()
    matches = [{"page": i + 1, "rect": [r.x0, r.y0, r.x1, r.y1]} for i, rects in sorted(found.items()) for r in rects]
    per_page = {str(i + 1): len(r) for i, r in sorted(found.items())}
    return {"count": len(matches), "per_page": per_page, "matches": matches}


# ---- sanitize ---------------------------------------------------------------------


class SanitizeRequest(_Base):
    metadata: bool = True
    javascript: bool = True
    attachments: bool = True
    annotations: bool = False
    forms: bool = False
    links: bool = False
    hidden_layers: bool = False


@router.post("/sanitize", response_model=ToolResult)
def sanitize(req: SanitizeRequest):
    fid = req.ids()[0]
    doc = open_pdf(fid, req.password)
    counts = {
        "embedded_files": doc.embfile_count() if req.attachments else 0,
        "annotations": 0,
        "widgets": 0,
        "links": 0,
        "layers": 0,
    }
    if req.attachments:
        counts["file_attachments"] = sum(
            1 for p in doc for a in p.annots() if a.type[0] == pymupdf.PDF_ANNOT_FILE_ATTACHMENT
        )
    if req.links:
        counts["links"] = sum(len(p.get_links()) for p in doc)
    doc.scrub(
        attached_files=req.attachments,
        clean_pages=False,
        embedded_files=req.attachments,
        hidden_text=False,
        javascript=req.javascript,
        metadata=req.metadata,
        redactions=False,
        remove_links=req.links,
        reset_fields=req.forms,
        reset_responses=req.annotations,
        thumbnails=True,
        xml_metadata=req.metadata,
    )
    if req.annotations or req.forms:
        for page in doc:
            if req.annotations:
                for a in list(page.annots()):
                    page.delete_annot(a)
                    counts["annotations"] += 1
            if req.forms:
                for w in list(page.widgets()):
                    page.delete_widget(w)
                    counts["widgets"] += 1
    warnings: list[str] = []
    if req.hidden_layers:
        try:
            hidden = [xref for xref, info in doc.get_ocgs().items() if not info.get("on", True)]
            if hidden:
                # Turn hidden layers permanently off in the default configuration and lock them.
                doc.set_layer(-1, off=hidden, locked=hidden)
                counts["layers"] = len(hidden)
                warnings.append("Hidden layers were locked off; their content is still in the file.")
        except Exception:  # noqa: BLE001
            pass
    sf = save_doc(doc, with_suffix(store.get(fid).name, "-sanitized"), garbage=4)
    n = doc.page_count
    doc.close()
    return ToolResult(outputs=[file_out(sf, n)], data=counts, warnings=warnings)
