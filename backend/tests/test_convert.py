from __future__ import annotations

import io
import json
import shutil
import zipfile

import pymupdf
import pytest
from PIL import Image

from .conftest import download, make_pdf, upload, wait_job


def _png(w: int, h: int, color=(200, 30, 30), dpi: int | None = None) -> bytes:
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    kwargs = {"dpi": (dpi, dpi)} if dpi else {}
    img.save(buf, "PNG", **kwargs)
    return buf.getvalue()


def _run(client, path: str, body: dict) -> dict:
    """POST; if a job comes back, wait for it and return the ToolResult."""
    r = client.post(path, json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    if "job_id" in j:
        j = wait_job(client, j)
        assert j["state"] == "done", j.get("error")
        return j["result"]
    return j


# ---- from PDF ---------------------------------------------------------------


def test_pdf_to_docx(client, uploaded):
    import docx

    res = _run(client, "/api/convert/pdf-to-docx", {"file_id": uploaded["file_id"], "pages": "1-2"})
    assert len(res["outputs"]) == 1
    out = res["outputs"][0]
    assert out["name"].endswith(".docx")
    d = docx.Document(io.BytesIO(download(client, out)))
    text = "\n".join(p.text for p in d.paragraphs)
    if not text.strip():  # pdf2docx may put text in tables/text boxes
        text = "\n".join(c.text for t in d.tables for row in t.rows for c in row.cells)
    assert "Hello" in text
    assert res["data"]["pages"] == 2


def test_pdf_to_docx_bad_pages(client, uploaded):
    r = client.post("/api/convert/pdf-to-docx", json={"file_id": uploaded["file_id"], "pages": "9-3"})
    assert r.status_code == 400


def test_pdf_requires_file_id(client):
    assert client.post("/api/convert/pdf-to-text", json={}).status_code == 400


def _table_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    x0, y0, cw, rh = 72, 72, 120, 24
    data = [["Item", "Qty", "Price"], ["Apple", "3", "1.50"], ["Pear", "7", "2.25"]]
    for r, row in enumerate(data):
        for c, cell in enumerate(row):
            page.insert_text((x0 + c * cw + 6, y0 + r * rh + 17), cell, fontsize=11)
    shape = page.new_shape()
    for r in range(len(data) + 1):
        shape.draw_line((x0, y0 + r * rh), (x0 + 3 * cw, y0 + r * rh))
    for c in range(4):
        shape.draw_line((x0 + c * cw, y0), (x0 + c * cw, y0 + 3 * rh))
    shape.finish(width=1, color=(0, 0, 0))
    shape.commit()
    doc.new_page().insert_text((72, 72), "Just text on page two")
    return doc.tobytes()


def test_pdf_to_xlsx(client):
    import openpyxl

    f = upload(client, _table_pdf(), "table.pdf")
    res = _run(client, "/api/convert/pdf-to-xlsx", {"file_id": f["file_id"]})
    out = res["outputs"][0]
    assert out["name"] == "table.xlsx"
    wb = openpyxl.load_workbook(io.BytesIO(download(client, out)))
    assert wb.sheetnames
    if res["data"]["tables_found"]:
        ws = wb[[n for n in wb.sheetnames if n.startswith("Table_p1")][0]]
        cells = {str(c.value) for row in ws.iter_rows() for c in row if c.value is not None}
        assert "Apple" in cells
    assert any(n.startswith("Page_2") for n in wb.sheetnames)


@pytest.mark.parametrize("mode", ["image", "text"])
def test_pdf_to_pptx(client, uploaded, mode):
    from pptx import Presentation

    res = _run(client, "/api/convert/pdf-to-pptx", {"file_id": uploaded["file_id"], "mode": mode})
    prs = Presentation(io.BytesIO(download(client, res["outputs"][0])))
    assert len(prs.slides) == 3
    # A4 portrait page -> portrait slide
    assert prs.slide_height > prs.slide_width
    if mode == "text":
        texts = [sh.text_frame.text for s in prs.slides for sh in s.shapes if sh.has_text_frame]
        assert any("Hello Folio page 1" in t for t in texts)


@pytest.mark.parametrize("fmt,ext", [("jpeg", ".jpg"), ("png", ".png"), ("webp", ".webp"), ("tiff", ".tiff")])
def test_pdf_to_images(client, uploaded, fmt, ext):
    res = _run(client, "/api/convert/pdf-to-images", {"file_id": uploaded["file_id"], "format": fmt, "dpi": 50})
    names = [o["name"] for o in res["outputs"]]
    assert names[:3] == [f"sample-page-00{i}{ext}" for i in (1, 2, 3)]
    assert names[3].endswith(".zip")
    with zipfile.ZipFile(io.BytesIO(download(client, res["outputs"][3]))) as zf:
        assert len(zf.namelist()) == 3
    img = Image.open(io.BytesIO(download(client, res["outputs"][0])))
    assert abs(img.width - 595 * 50 / 72) <= 1


def test_pdf_to_images_single_page_no_zip(client, uploaded):
    res = _run(client, "/api/convert/pdf-to-images", {"file_ids": [uploaded["file_id"]], "pages": "2", "dpi": 36})
    assert len(res["outputs"]) == 1 and res["outputs"][0]["name"] == "sample-page-002.jpg"


def test_pdf_to_images_extract_embedded(client):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(pymupdf.Rect(50, 50, 250, 250), stream=_png(100, 100))
    page.insert_image(pymupdf.Rect(300, 300, 400, 400), stream=_png(40, 60, (0, 0, 255)))
    f = upload(client, doc.tobytes(), "pics.pdf")
    body = {"file_id": f["file_id"], "extract_embedded": True, "format": "png"}
    res = _run(client, "/api/convert/pdf-to-images", body)
    assert res["data"]["images"] == 2
    assert [o["name"] for o in res["outputs"]][:2] == ["pics-image-001.png", "pics-image-002.png"]
    sizes = {Image.open(io.BytesIO(download(client, o))).size for o in res["outputs"][:2]}
    assert sizes == {(100, 100), (40, 60)}


@pytest.mark.parametrize("mode", ["layout", "flow"])
def test_pdf_to_html(client, uploaded, mode):
    res = _run(client, "/api/convert/pdf-to-html", {"file_id": uploaded["file_id"], "mode": mode, "pages": "1-2"})
    html = download(client, res["outputs"][0]).decode("utf-8")
    assert res["outputs"][0]["name"] == "sample.html"
    assert html.startswith("<!DOCTYPE html>") and "Hello Folio page 1" in html
    if mode == "layout":
        assert 'id="page-2"' in html and 'id="page-3"' not in html


def test_pdf_to_text_txt(client, uploaded):
    res = _run(client, "/api/convert/pdf-to-text", {"file_id": uploaded["file_id"], "format": "txt"})
    txt = download(client, res["outputs"][0]).decode("utf-8")
    assert txt.count("\f") == 2 and "lazy dog" in txt
    assert res["data"]["pages"] == 3


def test_pdf_to_text_md(client, uploaded):
    res = _run(client, "/api/convert/pdf-to-text", {"file_id": uploaded["file_id"], "format": "md", "pages": "1"})
    md = download(client, res["outputs"][0]).decode("utf-8")
    assert "Hello Folio page 1" in md and "page 2" not in md
    res2 = _run(client, "/api/convert/pdf-to-markdown", {"file_id": uploaded["file_id"]})
    assert res2["outputs"][0]["name"] == "sample.md"


def test_pdf_to_text_json(client, uploaded):
    res = _run(client, "/api/convert/pdf-to-text", {"file_id": uploaded["file_id"], "format": "json", "pages": "3"})
    data = json.loads(download(client, res["outputs"][0]))
    assert len(data["pages"]) == 1 and data["pages"][0]["page"] == 3
    spans = [sp for b in data["pages"][0]["blocks"] if b["type"] == "text" for ln in b["lines"] for sp in ln["spans"]]
    assert any("page 3" in sp["text"] for sp in spans)
    assert all({"bbox", "font", "size", "color"} <= set(sp) for sp in spans)


def test_pdf_to_pdfa(client, uploaded):
    if not any(shutil.which(c) for c in ("gs", "gswin64c", "gswin32c")):
        r = client.post("/api/convert/pdf-to-pdfa", json={"file_id": uploaded["file_id"]})
        assert r.status_code == 501
        pytest.skip("Ghostscript not installed")
    res = _run(client, "/api/convert/pdf-to-pdfa", {"file_id": uploaded["file_id"]})
    pdf = download(client, res["outputs"][0])
    assert b"pdfaid" in pdf or b"PDF/A" in pdf


# ---- to PDF -----------------------------------------------------------------


def test_office_to_pdf_requires_libreoffice(client):
    import docx

    d = docx.Document()
    d.add_paragraph("Hello from Word")
    buf = io.BytesIO()
    d.save(buf)
    ctype = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    f = upload(client, buf.getvalue(), "hello.docx", ctype)
    if not shutil.which("soffice") and not shutil.which("libreoffice"):
        for ep in ("office-to-pdf", "word-to-pdf", "excel-to-pdf", "powerpoint-to-pdf"):
            r = client.post(f"/api/convert/{ep}", json={"file_id": f["file_id"]})
            assert r.status_code == 501, r.text
        pytest.skip("LibreOffice not installed")
    res = _run(client, "/api/convert/word-to-pdf", {"file_id": f["file_id"]})
    assert res["outputs"][0]["name"] == "hello.pdf" and res["outputs"][0]["page_count"] == 1


def test_images_to_pdf_fit(client):
    a = upload(client, _png(300, 150), "a.png", "image/png")
    b = upload(client, _png(100, 400, dpi=200), "b.png", "image/png")
    res = _run(client, "/api/convert/images-to-pdf", {"file_ids": [a["file_id"], b["file_id"]], "page_size": "fit"})
    out = res["outputs"][0]
    assert out["name"] == "images.pdf" and out["page_count"] == 2
    doc = pymupdf.open(stream=download(client, out), filetype="pdf")
    assert (round(doc[0].rect.width), round(doc[0].rect.height)) == (300, 150)
    assert (round(doc[1].rect.width), round(doc[1].rect.height)) == (36, 144)  # 200 dpi -> pt
    assert len(doc[0].get_images()) == 1


def test_images_to_pdf_a4_margin_and_tiff(client):
    frames = [Image.new("L", (80, 60), 100), Image.new("L", (60, 80), 50)]
    buf = io.BytesIO()
    frames[0].save(buf, "TIFF", save_all=True, append_images=frames[1:])
    t = upload(client, buf.getvalue(), "scan.tiff", "image/tiff")
    res = _run(client, "/api/convert/images-to-pdf", {"file_id": t["file_id"], "page_size": "A4", "margin": 20})
    doc = pymupdf.open(stream=download(client, res["outputs"][0]), filetype="pdf")
    assert doc.page_count == 2
    assert doc[0].rect.width > doc[0].rect.height  # auto -> landscape for a wide image
    assert doc[1].rect.width < doc[1].rect.height
    assert round(doc[1].rect.width) == 595
    img_rect = doc[0].get_image_rects(doc[0].get_images()[0][0])[0]
    assert img_rect.x0 >= 19.5 and img_rect.y0 >= 19.5


def test_images_to_pdf_rejects_non_image(client):
    f = upload(client, b"not an image", "x.png", "image/png")
    assert client.post("/api/convert/images-to-pdf", json={"file_ids": [f["file_id"]]}).status_code == 400


def test_text_to_pdf_plain_and_markdown(client):
    body = "\n".join(f"Line {i} " + "lorem ipsum " * 12 for i in range(120))
    f = upload(client, body.encode(), "notes.txt", "text/plain")
    res = _run(client, "/api/convert/text-to-pdf", {"file_id": f["file_id"]})
    out = res["outputs"][0]
    assert out["name"] == "notes.pdf" and out["page_count"] >= 2
    doc = pymupdf.open(stream=download(client, out), filetype="pdf")
    assert "Line 0" in doc[0].get_text() and "Line 119" in doc[-1].get_text()

    md = "# Title\n\nSome *emphasis* and a list:\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"
    f = upload(client, md.encode(), "readme.md", "text/markdown")
    res = _run(client, "/api/convert/text-to-pdf", {"file_id": f["file_id"]})
    doc = pymupdf.open(stream=download(client, res["outputs"][0]), filetype="pdf")
    text = doc[0].get_text()
    assert "Title" in text and "one" in text and "two" in text
    blocks = [b for b in doc[0].get_text("dict")["blocks"] if b["type"] == 0]
    sizes = {round(s["size"]) for b in blocks for ln in b["lines"] for s in ln["spans"]}
    assert len(sizes) > 1  # heading rendered larger than body

    res = _run(client, "/api/convert/text-to-pdf", {"text": "inline text", "font_size": 14, "page_size": "Letter"})
    doc = pymupdf.open(stream=download(client, res["outputs"][0]), filetype="pdf")
    assert round(doc[0].rect.width) == 612 and "inline text" in doc[0].get_text()
    assert client.post("/api/convert/text-to-pdf", json={}).status_code == 400


def test_text_to_pdf_csv(client):
    f = upload(client, b"name,qty\napple,3\npear,7\n", "data.csv", "text/csv")
    res = _run(client, "/api/convert/text-to-pdf", {"file_id": f["file_id"]})
    doc = pymupdf.open(stream=download(client, res["outputs"][0]), filetype="pdf")
    text = doc[0].get_text()
    assert "apple" in text and "pear" in text


def test_html_to_pdf_ssrf_rejected(client):
    for url in ("http://127.0.0.1/", "http://localhost:8000/x", "http://10.1.2.3/", "http://192.168.1.1/",
                "http://169.254.169.254/latest", "http://[::1]/", "file:///etc/passwd", "ftp://example.com/"):
        r = client.post("/api/convert/html-to-pdf", json={"url": url})
        assert r.status_code == 400, (url, r.text)
    assert client.post("/api/convert/html-to-pdf", json={}).status_code == 400


def test_html_to_pdf_inline(client):
    r = client.post("/api/convert/html-to-pdf", json={"html": "<h1>Hi there</h1><p>Body</p>", "page_size": "Letter"})
    if r.status_code == 501:
        pytest.skip("WeasyPrint native libraries not available")
    assert r.status_code == 200, r.text
    j = wait_job(client, r.json())
    assert j["state"] == "done", j["error"]
    doc = pymupdf.open(stream=download(client, j["result"]["outputs"][0]), filetype="pdf")
    assert "Hi there" in doc[0].get_text() and round(doc[0].rect.width) == 612


def test_any_to_pdf(client, uploaded):
    res = _run(client, "/api/convert/any-to-pdf", {"file_id": uploaded["file_id"]})
    assert res["outputs"][0]["file_id"] == uploaded["file_id"] and res["data"]["kind"] == "pdf"

    img = upload(client, _png(50, 50), "pic.png", "image/png")
    res = _run(client, "/api/convert/any-to-pdf", {"file_id": img["file_id"]})
    assert res["outputs"][0]["name"] == "pic.pdf" and res["data"]["kind"] == "image"

    txt = upload(client, b"plain words", "words.txt", "text/plain")
    res = _run(client, "/api/convert/any-to-pdf", {"file_id": txt["file_id"]})
    assert res["outputs"][0]["name"] == "words.pdf"

    from app.tools.convert import to_pdf

    sf = to_pdf(img["file_id"])
    assert sf.name == "pic.pdf" and sf.fs_path.read_bytes()[:4] == b"%PDF"

    junk = upload(client, bytes(range(256)) * 4, "blob.bin", "application/octet-stream")
    assert client.post("/api/convert/any-to-pdf", json={"file_id": junk["file_id"]}).status_code == 400


def test_password_protected_pdf(client):
    doc = pymupdf.open(stream=make_pdf(1), filetype="pdf")
    data = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner")
    f = upload(client, data, "locked.pdf")
    assert client.post("/api/convert/pdf-to-text", json={"file_id": f["file_id"]}).status_code == 401
    res = _run(client, "/api/convert/pdf-to-text", {"file_id": f["file_id"], "password": "secret"})
    assert "Hello" in download(client, res["outputs"][0]).decode()
