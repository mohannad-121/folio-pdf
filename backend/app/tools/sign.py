"""Signing: signature images (draw/type), stamping them onto pages, digital
signatures with pyHanko (PKCS#12 or generated self-signed), verification."""

from __future__ import annotations

import datetime as _dt
import io
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

import pymupdf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..pdfutil import file_out, open_pdf, require_pdf, save_doc, with_suffix
from ..schemas import ToolResult
from ..storage import store
from .edit import R, Rect4, find_font_file, get_page, hex_to_rgb, insert_fitted_text, place_image, to_page_space

router = APIRouter(prefix="/api/sign", tags=["sign"])
log = logging.getLogger("folio.sign")

FONT_CANDIDATES: dict[str, list[str]] = {
    "cursive": [
        "segoesc.ttf",
        "ITCKRIST.TTF",
        "BRUSHSCI.TTF",
        "FRSCRIPT.TTF",
        "segoepr.ttf",
        "DejaVuSerif-Italic.ttf",
        "DejaVuSans-Oblique.ttf",
    ],
    "serif": ["georgiai.ttf", "times.ttf", "georgia.ttf", "DejaVuSerif.ttf", "LiberationSerif-Regular.ttf"],
    "sans": ["segoeui.ttf", "arial.ttf", "calibri.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"],
}


def resolve_font(style: str) -> tuple[Path | None, str]:
    p = find_font_file(FONT_CANDIDATES.get(style, FONT_CANDIDATES["cursive"]))
    return (p, p.name) if p else (None, "default")


@router.get("/fonts")
def fonts():
    out = []
    for style in FONT_CANDIDATES:
        path, name = resolve_font(style)
        out.append({"style": style, "available": path is not None, "font": name})
    return out


# ---- signature image --------------------------------------------------------------


class SignatureImageRequest(BaseModel):
    kind: Literal["draw", "type"]
    paths: list[list[tuple[float, float]]] | None = None
    text: str | None = None
    font: Literal["cursive", "serif", "sans"] = "cursive"
    color: str = "#000000"
    width: float = 3
    size: tuple[int, int] = (600, 200)
    box: tuple[int, int] = (600, 200)  # coordinate space of ``paths``


def render_signature(req: SignatureImageRequest) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    W, H = max(16, int(req.size[0])), max(16, int(req.size[1]))
    rgb = hex_to_rgb(req.color) or (0, 0, 0)
    fill = tuple(int(c * 255) for c in rgb) + (255,)
    scale = 2  # supersample for smoother edges
    img = Image.new("RGBA", (W * scale, H * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if req.kind == "draw":
        if not req.paths:
            raise HTTPException(status_code=422, detail="paths required for kind=draw")
        sx, sy = W * scale / max(1, req.box[0]), H * scale / max(1, req.box[1])
        lw = max(1, int(req.width * scale * min(sx, sy)))
        for path in req.paths:
            pts = [(x * sx, y * sy) for x, y in path]
            if len(pts) == 1:
                x, y = pts[0]
                draw.ellipse([x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2], fill=fill)
            else:
                draw.line(pts, fill=fill, width=lw, joint="curve")
                for x, y in (pts[0], pts[-1]):
                    draw.ellipse([x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2], fill=fill)
    else:
        text = (req.text or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="text required for kind=type")
        path, _ = resolve_font(req.font)
        target_w, target_h = W * scale * 0.9, H * scale * 0.7
        size = int(H * scale * 0.6)
        while size > 8:
            font = ImageFont.truetype(str(path), size) if path else ImageFont.load_default(size=size)
            lft, t, r, b = draw.textbbox((0, 0), text, font=font)
            if r - lft <= target_w and b - t <= target_h:
                break
            size = int(size * 0.9)
        x = (W * scale - (r - lft)) / 2 - lft
        y = (H * scale - (b - t)) / 2 - t
        draw.text((x, y), text, font=font, fill=fill)
    img = img.resize((W, H), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@router.post("/signature-image", response_model=ToolResult)
def signature_image(req: SignatureImageRequest):
    png = render_signature(req)
    sf = store.save_bytes(png, "signature.png", "image/png")
    return ToolResult(outputs=[file_out(sf)], data={"width": req.size[0], "height": req.size[1]})


# ---- stamp ----------------------------------------------------------------------


class Placement(BaseModel):
    page: int = Field(ge=1)
    rect: Rect4
    image_file_id: str | None = None
    text: str | None = None
    font_size: float = 14
    color: str = "#000000"
    font: str = "helv"


class StampRequest(BaseModel):
    file_id: str
    password: str | None = None
    placements: list[Placement]
    flatten: bool = True
    date_stamp: bool = False
    date_format: str = "%Y-%m-%d"


@router.post("/stamp", response_model=ToolResult)
def stamp_signatures(req: StampRequest):
    if not req.placements:
        raise HTTPException(status_code=422, detail="placements required")
    doc = open_pdf(req.file_id, req.password)
    sf = store.get(req.file_id)
    warnings: list[str] = []
    placed = 0
    try:
        for i, pl in enumerate(req.placements, start=1):
            try:
                page = get_page(doc, pl.page)
                rect = R(pl.rect)
                if pl.image_file_id:
                    place_image(page, rect, store.path(pl.image_file_id), keep=True)
                elif pl.text:
                    _, w = insert_fitted_text(
                        page, rect, pl.text, pl.font_size, pl.font or "helv", hex_to_rgb(pl.color), 1, shrink=True
                    )
                    warnings.extend(w)
                else:
                    raise ValueError("placement needs image_file_id or text")
                if req.date_stamp:
                    stamp = "Signed " + _dt.datetime.now().strftime(req.date_format)
                    fs = max(6.0, min(9.0, rect.height * 0.18))
                    below = pymupdf.Rect(rect.x0, rect.y1 + 1, max(rect.x1, rect.x0 + 120), rect.y1 + fs * 1.6 + 1)
                    below &= page.rect
                    if not below.is_empty:
                        insert_fitted_text(page, below, stamp, fs, "helv", (0.25, 0.25, 0.25), 0, shrink=True)
                placed += 1
            except Exception as e:  # noqa: BLE001
                warnings.append(f"placement #{i}: {type(e).__name__}: {e}")
        if req.flatten:
            doc.bake(annots=True, widgets=False)
        out = save_doc(doc, with_suffix(sf.name, "-signed"))
    finally:
        doc.close()
    return ToolResult(outputs=[file_out(out)], data={"placed": placed}, warnings=warnings)


# ---- digital signatures -------------------------------------------------------------


def generate_self_signed(
    common_name: str, password: bytes, email: str | None = None, org: str | None = None, days: int = 730
) -> tuple[bytes, dict[str, Any]]:
    """Return (pkcs12 bytes, info) for a fresh RSA-2048 self-signed certificate."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    attrs = [x509.NameAttribute(NameOID.COMMON_NAME, common_name)]
    if org:
        attrs.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, org))
    if email:
        attrs.append(x509.NameAttribute(NameOID.EMAIL_ADDRESS, email))
    name = x509.Name(attrs)
    now = _dt.datetime.now(_dt.UTC)
    builder = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - _dt.timedelta(days=1))
        .not_valid_after(now + _dt.timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
    )
    if email:
        builder = builder.add_extension(x509.SubjectAlternativeName([x509.RFC822Name(email)]), critical=False)
    cert = builder.sign(key, hashes.SHA256())
    enc = serialization.BestAvailableEncryption(password) if password else serialization.NoEncryption()
    p12 = pkcs12.serialize_key_and_certificates(common_name.encode("utf-8"), key, cert, None, enc)
    info = {
        "subject": cert.subject.rfc4514_string(),
        "not_before": cert.not_valid_before_utc.isoformat(),
        "not_after": cert.not_valid_after_utc.isoformat(),
        "serial": format(cert.serial_number, "x"),
    }
    return p12, info


class SelfSignedCertRequest(BaseModel):
    common_name: str
    email: str | None = None
    org: str | None = None
    password: str
    days: int = Field(default=730, ge=1, le=3650)


@router.post("/self-signed-cert", response_model=ToolResult)
def self_signed_cert(req: SelfSignedCertRequest):
    p12, info = generate_self_signed(req.common_name, req.password.encode("utf-8"), req.email, req.org, req.days)
    safe = "".join(c for c in req.common_name if c.isalnum() or c in " -_").strip() or "certificate"
    sf = store.save_bytes(p12, f"{safe}.p12", "application/x-pkcs12")
    return ToolResult(outputs=[file_out(sf)], data=info, warnings=["self-signed certificate: not trusted by default"])


class DigitalSignRequest(BaseModel):
    file_id: str
    password: str | None = None
    cert_file_id: str | None = None
    cert_password: str | None = None
    reason: str | None = None
    location: str | None = None
    contact: str | None = None
    visible: bool = True
    page: int = -1
    rect: Rect4 | None = None
    field_name: str = "Signature1"
    signer_name: str | None = None


def _load_signer(req: DigitalSignRequest, tmpdir: str):
    from pyhanko.sign import signers

    self_signed = False
    pw = (req.cert_password or "").encode("utf-8") or None
    if req.cert_file_id:
        cert_path = store.path(req.cert_file_id)
        try:
            signer = signers.SimpleSigner.load_pkcs12(pfx_file=str(cert_path), passphrase=pw)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Could not load certificate: {e}") from e
        if signer is None:
            raise HTTPException(status_code=400, detail="Could not load certificate (wrong password?)")
    else:
        self_signed = True
        p12, _ = generate_self_signed(req.signer_name or "Folio User", b"folio")
        p = Path(tmpdir) / "self.p12"
        p.write_bytes(p12)
        signer = signers.SimpleSigner.load_pkcs12(pfx_file=str(p), passphrase=b"folio")
    return signer, self_signed


def _pdf_box(page: pymupdf.Page, rect: pymupdf.Rect) -> tuple[float, float, float, float]:
    """Displayed-space rect -> PDF user-space box (bottom-left origin, unrotated) for pyHanko."""
    r = to_page_space(page, rect)
    mb = page.mediabox
    cb = page.cropbox
    x0 = mb.x0 + cb.x0 + r.x0
    x1 = mb.x0 + cb.x0 + r.x1
    # pymupdf cropbox is top-left based inside the mediabox; mediabox y grows upwards
    top = mb.y1 - cb.y0
    y0 = top - r.y1
    y1 = top - r.y0
    return (x0, y0, x1, y1)


@router.post("/digital", response_model=ToolResult)
def digital_sign(req: DigitalSignRequest):
    from pyhanko import stamp as hstamp
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers
    from pyhanko.sign.fields import SigFieldSpec

    sf = require_pdf(req.file_id)
    warnings: list[str] = []
    # Resolve the page/box with PyMuPDF (handles rotation + encrypted inputs).
    doc = open_pdf(req.file_id, req.password)
    try:
        page_idx = (doc.page_count - 1) if req.page < 1 else min(req.page, doc.page_count) - 1
        page = doc[page_idx]
        if req.rect is not None:
            rect = R(req.rect) & page.rect
        else:
            pr = page.rect
            rect = pymupdf.Rect(pr.width - 236, pr.height - 96, pr.width - 36, pr.height - 36)
        box = _pdf_box(page, rect)
        existing = {w.field_name for p in doc for w in p.widgets()}
        src_bytes = doc.tobytes() if (doc.needs_pass or doc.is_encrypted) else None
    finally:
        doc.close()
    field_name = req.field_name
    if field_name in existing:
        n = 2
        while f"{field_name}{n}" in existing:
            n += 1
        warnings.append(f"field {field_name!r} exists; using {field_name}{n}")
        field_name = f"{field_name}{n}"

    with tempfile.TemporaryDirectory(prefix="folio-sign-") as tmp:
        signer, self_signed = _load_signer(req, tmp)
        if self_signed:
            warnings.append("self-signed certificate: viewers will show the signature as untrusted")
        src_path = Path(tmp) / "src.pdf"
        if src_bytes is not None:
            src_path.write_bytes(src_bytes)
        else:
            src_path = sf.fs_path
        file_id, out_path = store.output_path(with_suffix(sf.name, "-signed"))
        meta = signers.PdfSignatureMetadata(
            field_name=field_name,
            reason=req.reason or None,
            location=req.location or None,
            contact_info=req.contact or None,
            md_algorithm="sha256",
        )
        lines = ["Digitally signed by %(signer)s", "%(ts)s"]
        if req.reason:
            lines.append(req.reason.replace("%", "%%"))
        if req.location:
            lines.append(req.location.replace("%", "%%"))
        style = hstamp.TextStampStyle(stamp_text="\n".join(lines), border_width=1)
        try:
            with src_path.open("rb") as inf:
                w = IncrementalPdfFileWriter(inf, strict=False)
                if req.visible:
                    fields.append_signature_field(w, SigFieldSpec(sig_field_name=field_name, on_page=page_idx, box=box))
                pdf_signer = signers.PdfSigner(meta, signer=signer, stamp_style=style)
                with out_path.open("wb") as outf:
                    pdf_signer.sign_pdf(w, output=outf, existing_fields_only=False)
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            store.delete(file_id)
            raise HTTPException(status_code=400, detail=f"Signing failed: {type(e).__name__}: {e}") from e
        out = store.register_output(file_id, out_path, "application/pdf")
        subject = signer.signing_cert.subject.human_friendly
        cn = dict(signer.signing_cert.subject.native).get("common_name", subject)
    data = {"signer": cn, "certificate_subject": subject, "self_signed": self_signed, "field_name": field_name}
    return ToolResult(outputs=[file_out(out)], data=data, warnings=warnings)


class VerifyRequest(BaseModel):
    file_id: str
    password: str | None = None


def _enum_name(v) -> str | None:
    if v is None:
        return None
    return getattr(v, "name", str(v)).lower()


@router.post("/verify", response_model=ToolResult)
def verify(req: VerifyRequest):
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign import validation
    from pyhanko_certvalidator import ValidationContext

    sf = require_pdf(req.file_id)
    data_path = sf.fs_path
    tmp = None
    if req.password:
        doc = open_pdf(req.file_id, req.password)
        tmp = tempfile.NamedTemporaryFile(prefix="folio-verify-", suffix=".pdf", delete=False)
        tmp.write(doc.tobytes())
        tmp.close()
        doc.close()
        data_path = Path(tmp.name)
    sigs: list[dict[str, Any]] = []
    warnings: list[str] = []
    try:
        with data_path.open("rb") as f:
            try:
                reader = PdfFileReader(f, strict=False)
                embedded = list(reader.embedded_signatures)
            except Exception as e:  # noqa: BLE001
                raise HTTPException(status_code=400, detail=f"Cannot read PDF for verification: {e}") from e
            for sig in embedded:
                entry: dict[str, Any] = {"field_name": sig.field_name}
                sobj = sig.sig_object
                for key, out in (
                    ("/Reason", "reason"),
                    ("/Location", "location"),
                    ("/ContactInfo", "contact"),
                    ("/Name", "name"),
                    ("/M", "signing_time_raw"),
                ):
                    val = sobj.get(key)
                    if val is not None:
                        entry[out] = str(val)
                try:
                    vc = ValidationContext(allow_fetching=False, trust_roots=[])
                    st = validation.validate_pdf_signature(sig, signer_validation_context=vc)
                    cert = st.signing_cert
                    subj = cert.subject.native if cert is not None else {}
                    entry.update(
                        {
                            "intact": bool(st.intact),
                            "valid": bool(st.valid),
                            "trusted": bool(st.trusted),
                            "signer": subj.get("common_name") or (cert.subject.human_friendly if cert else None),
                            "certificate_subject": cert.subject.human_friendly if cert is not None else None,
                            "signing_time": st.signer_reported_dt.isoformat() if st.signer_reported_dt else None,
                            "coverage": _enum_name(st.coverage),
                            "entire_file": _enum_name(st.coverage) == "entire_file",
                            "modification_level": _enum_name(st.modification_level),
                            "md_algorithm": getattr(st, "md_algorithm", None),
                            "summary": st.summary(),
                            "self_signed": bool(cert is not None and cert.subject == cert.issuer),
                        }
                    )
                    if not st.trusted:
                        entry["trust_note"] = (
                            "Certificate chain is not anchored in a trusted root (self-signed or unknown CA)."
                        )
                except Exception as e:  # noqa: BLE001
                    entry.update(
                        {"intact": None, "valid": False, "trusted": False, "error": f"{type(e).__name__}: {e}"}
                    )
                    warnings.append(f"{sig.field_name}: validation error: {e}")
                sigs.append(entry)
    finally:
        if tmp is not None:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
    return ToolResult(outputs=[], data={"signatures": sigs, "count": len(sigs)}, warnings=warnings)
