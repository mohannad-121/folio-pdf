from __future__ import annotations

import io

import pymupdf
from PIL import Image

from .conftest import download, make_pdf, upload, wait_job


def _open(data: bytes) -> pymupdf.Document:
    return pymupdf.open(stream=data, filetype="pdf")


def _noisy_jpeg(size: int = 1200) -> bytes:
    import random

    rnd = random.Random(1)
    img = Image.new("RGB", (size, size))
    img.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(size * size)])
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _image_pdf(pages: int = 2) -> bytes:
    doc = _open(make_pdf(pages, "Image doc"))
    jpg = _noisy_jpeg()
    for page in doc:
        # 1200 px over 300 pt -> 288 dpi; medium should downsample.
        page.insert_image(pymupdf.Rect(72, 200, 372, 500), stream=jpg)
    doc.set_metadata({"title": "Secret title", "author": "Someone"})
    return doc.tobytes()


def _run(client, path, body):
    r = client.post(path, json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    if "job_id" in j:
        j = wait_job(client, j)
        assert j["state"] == "done", j
        return j["result"]
    return j


def test_compress_levels(client):
    data = _image_pdf()
    f = upload(client, data, "img.pdf")
    sizes = {}
    for level in ("low", "medium", "high", "extreme"):
        res = _run(client, "/api/optimize/compress", {"file_id": f["file_id"], "level": level})
        out = res["outputs"][0]
        assert out["name"] == "img-compressed.pdf"
        assert out["size"] <= len(data)
        assert res["data"]["original_size"] == len(data)
        assert res["data"]["compressed_size"] == out["size"]
        assert 0 <= res["data"]["saved_percent"] <= 100
        doc = _open(download(client, out))
        assert doc.page_count == 2 and "Image doc" in doc[0].get_text()
        sizes[level] = out["size"]
    assert sizes["medium"] < len(data) * 0.7
    assert sizes["extreme"] <= sizes["medium"]


def test_compress_remove_metadata_and_multiple(client):
    a = upload(client, _image_pdf(1), "a.pdf")
    b = upload(client, make_pdf(1), "b.pdf")
    res = _run(
        client,
        "/api/optimize/compress",
        {"file_ids": [a["file_id"], b["file_id"]], "level": "medium", "remove_metadata": True},
    )
    assert len(res["outputs"]) == 2 and len(res["data"]["files"]) == 2
    doc = _open(download(client, res["outputs"][0]))
    assert not doc.metadata.get("title")
    for o in res["outputs"]:
        assert o["size"] <= max(a["size"], b["size"])


def test_compress_errors(client):
    assert client.post("/api/optimize/compress", json={"level": "low"}).status_code == 400
    assert client.post("/api/optimize/compress", json={"file_id": "0" * 32}).status_code == 404


def test_repair(client):
    data = make_pdf(2)
    broken = data[:-200] + b"garbage" * 5  # truncate xref/trailer
    f = upload(client, broken, "broken.pdf")
    res = _run(client, "/api/optimize/repair", {"file_id": f["file_id"]})
    assert res["data"]["repaired_with"] in ("pikepdf", "pymupdf")
    doc = _open(download(client, res["outputs"][0]))
    assert doc.page_count == 2
    assert res["outputs"][0]["name"] == "broken-repaired.pdf"


def test_flatten(client):
    doc = _open(make_pdf(1))
    page = doc[0]
    page.add_highlight_annot(pymupdf.Rect(70, 60, 200, 90))
    w = pymupdf.Widget()
    w.field_name = "name"
    w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    w.rect = pymupdf.Rect(72, 300, 300, 330)
    w.field_value = "Typed value"
    page.add_widget(w)
    f = upload(client, doc.tobytes(), "form.pdf")
    res = _run(client, "/api/optimize/flatten", {"file_id": f["file_id"]})
    assert res["data"]["annotations"] == 1 and res["data"]["widgets"] == 1
    out = _open(download(client, res["outputs"][0]))
    assert not list(out[0].annots()) and not list(out[0].widgets())
    assert "Hello Folio" in out[0].get_text()


def test_grayscale(client):
    doc = _open(make_pdf(1))
    doc[0].draw_rect(pymupdf.Rect(100, 300, 300, 400), color=(1, 0, 0), fill=(1, 0, 0))
    f = upload(client, doc.tobytes(), "color.pdf")
    res = _run(client, "/api/optimize/grayscale", {"file_id": f["file_id"]})
    out = _open(download(client, res["outputs"][0]))
    pix = out[0].get_pixmap(clip=pymupdf.Rect(150, 320, 250, 380), alpha=False)
    r, g, b = pix.pixel(10, 10)
    assert r == g == b, (r, g, b)
    assert "Hello Folio" in out[0].get_text()


def test_linearize(client):
    f = upload(client, make_pdf(2), "doc.pdf")
    res = _run(client, "/api/optimize/linearize", {"file_id": f["file_id"]})
    import pikepdf

    out = download(client, res["outputs"][0])
    with pikepdf.open(io.BytesIO(out)) as pdf:
        assert pdf.is_linearized
    assert res["outputs"][0]["page_count"] == 2


def test_remove_blank_pages(client):
    doc = _open(make_pdf(2))
    doc.new_page(pno=1)  # blank in the middle
    doc.new_page(-1)  # blank at end
    f = upload(client, doc.tobytes(), "blanks.pdf")
    res = _run(client, "/api/optimize/remove-blank-pages", {"file_id": f["file_id"]})
    assert res["data"]["removed"] == 2 and res["data"]["removed_pages"] == [2, 4]
    assert res["outputs"][0]["page_count"] == 2

    empty = pymupdf.open()
    empty.new_page()
    e = upload(client, empty.tobytes(), "empty.pdf")
    assert client.post("/api/optimize/remove-blank-pages", json={"file_id": e["file_id"]}).status_code == 400
