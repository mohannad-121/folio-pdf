from __future__ import annotations

import io
import shutil

import pymupdf
import pytest
from PIL import Image, ImageDraw

from .conftest import download, make_pdf, upload, wait_job

HAVE_TESS = shutil.which("tesseract") is not None
HAVE_GS = any(shutil.which(c) for c in ("gs", "gswin64c", "gswin32c"))


def _scan_png(text: str = "FOLIO OCR TEST", size=(1200, 800)) -> bytes:
    img = Image.new("RGB", size, (250, 248, 240))
    d = ImageDraw.Draw(img)
    try:
        from PIL import ImageFont

        font = ImageFont.truetype("arial.ttf", 72)
    except OSError:
        font = None
    d.text((100, 300), text, fill=(20, 20, 20), font=font)
    buf = io.BytesIO()
    img.save(buf, "PNG", dpi=(150, 150))
    return buf.getvalue()


def _scanned_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=576, height=384)  # same aspect as the 1200x800 image
    page.insert_image(page.rect, stream=_scan_png())  # full-bleed image, no text layer
    return doc.tobytes()


def test_detect(client, uploaded):
    r = client.post("/api/ocr/detect", json={"file_id": uploaded["file_id"]})
    assert r.status_code == 200
    j = r.json()
    assert j["page_count"] == 3 and j["needs_ocr"] is False
    assert all(p["has_text"] and not p["likely_scanned"] for p in j["pages"])

    f = upload(client, _scanned_pdf(), "scan.pdf")
    j = client.post("/api/ocr/detect", json={"file_id": f["file_id"]}).json()
    assert j["pages"][0] == {"page": 1, "has_text": False, "image_coverage": 1.0, "likely_scanned": True}
    assert j["needs_ocr"] is True

    # small image + no text: not "scanned"
    doc = pymupdf.open()
    doc.new_page().insert_image(pymupdf.Rect(10, 10, 100, 100), stream=_scan_png(size=(90, 90)))
    f = upload(client, doc.tobytes(), "small.pdf")
    j = client.post("/api/ocr/detect", json={"file_id": f["file_id"]}).json()
    assert j["pages"][0]["likely_scanned"] is False


def test_languages(client):
    r = client.get("/api/ocr/languages")
    assert r.status_code == 200
    j = r.json()
    if HAVE_TESS:
        assert j["available"] is True and "eng" in j["languages"]
    else:
        assert j == {"available": False, "languages": []}


def test_ocr_pdf_requires_binaries_or_works(client):
    f = upload(client, _scanned_pdf(), "scan.pdf")
    r = client.post("/api/ocr/pdf", json={"file_id": f["file_id"], "language": "eng"})
    if not (HAVE_TESS and HAVE_GS):
        assert r.status_code == 501, r.text
        pytest.skip("Tesseract/Ghostscript not installed")
    assert r.status_code == 200, r.text
    j = wait_job(client, r.json(), timeout=300)
    assert j["state"] == "done", j["error"]
    out = j["result"]["outputs"][0]
    assert out["name"] == "scan-ocr.pdf" and j["result"]["data"]["languages"] == ["eng"]
    doc = pymupdf.open(stream=download(client, out), filetype="pdf")
    assert "FOLIO" in doc[0].get_text().upper()


def test_ocr_pdf_missing_file_id(client):
    assert client.post("/api/ocr/pdf", json={}).status_code in (400, 501)


def test_extract_text(client):
    f = upload(client, _scanned_pdf(), "scan.pdf")
    r = client.post("/api/ocr/extract-text", json={"file_id": f["file_id"]})
    if not HAVE_TESS:
        assert r.status_code == 501
        pytest.skip("Tesseract not installed")
    assert r.status_code == 200, r.text
    j = r.json()
    assert len(j["data"]["text_per_page"]) == 1
    assert "FOLIO" in j["data"]["text_per_page"][0].upper()
    assert j["outputs"][0]["name"] == "scan-ocr.txt"


def test_scan_to_pdf(client):
    a = upload(client, _scan_png("PAGE ONE"), "p1.png", "image/png")
    b = upload(client, _scan_png("PAGE TWO"), "p2.png", "image/png")
    r = client.post("/api/ocr/scan-to-pdf", json={"file_ids": [a["file_id"], b["file_id"]], "ocr": True})
    assert r.status_code == 200, r.text
    j = wait_job(client, r.json(), timeout=300)
    assert j["state"] == "done", j["error"]
    res = j["result"]
    out = res["outputs"][0]
    assert out["name"] == "scan.pdf" and out["page_count"] == 2
    doc = pymupdf.open(stream=download(client, out), filetype="pdf")
    # 1200x800 px at 150 dpi -> 576x384 pt
    assert (round(doc[0].rect.width), round(doc[0].rect.height)) == (576, 384)
    if HAVE_TESS and HAVE_GS:
        assert res["data"]["ocr"] is True
        assert "PAGE" in doc[0].get_text().upper()
    else:
        assert res["data"]["ocr"] is False
        assert any("OCR skipped" in w for w in res["warnings"])

    # ocr=False never needs tesseract and the enhanced image is grayscale
    r = client.post("/api/ocr/scan-to-pdf", json={"file_id": a["file_id"], "ocr": False, "enhance": True})
    j = wait_job(client, r.json())
    assert j["state"] == "done", j["error"]
    assert j["result"]["outputs"][0]["name"] == "p1-scan.pdf"
    doc = pymupdf.open(stream=download(client, j["result"]["outputs"][0]), filetype="pdf")
    info = doc.get_page_images(0)[0]
    assert info[5] in ("DeviceGray", "ICCBased", "CalGray")


def test_detect_on_text_pdf_without_images(client):
    f = upload(client, make_pdf(1), "t.pdf")
    j = client.post("/api/ocr/detect", json={"file_id": f["file_id"]}).json()
    assert j["pages"][0]["image_coverage"] == 0.0
