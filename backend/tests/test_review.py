from __future__ import annotations

import json

import pymupdf

from .conftest import download, make_pdf, upload


def test_compare_text_and_visual(client):
    a = upload(client, make_pdf(2, "Hello Folio"), "old.pdf")
    b_doc = pymupdf.open("pdf", make_pdf(2, "Hello Folio"))
    # change one word on page 2 and add an extra word on page 1
    page = b_doc[1]
    rect = page.search_for("lazy")[0]
    page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()
    page.insert_text((rect.x0, rect.y1 - 2), "sleepy", fontsize=11)
    b_doc[0].insert_text((72, 200), "EXTRA", fontsize=11)
    b = upload(client, b_doc.tobytes(), "new.pdf")

    r = client.post("/api/review/compare", json={"file_ids": [a["file_id"], b["file_id"]]})
    assert r.status_code == 200, r.text
    res = r.json()
    data = res["data"]
    assert data["summary"]["pages_compared"] == 2 and data["summary"]["pages_changed"] == 2
    kinds = {(c["page"], c["kind"]) for c in data["changes"]}
    assert (2, "replace") in kinds and (1, "insert") in kinds
    repl = next(c for c in data["changes"] if c["page"] == 2)
    assert repl["a_text"] == "lazy" and repl["b_text"] == "sleepy" and repl["a_rects"] and repl["b_rects"]
    assert all(v["changed_percent"] > 0 for v in data["visual"])
    assert data["visual"][1]["bbox"] is not None
    names = [o["name"] for o in res["outputs"]]
    assert names == ["comparison-report.pdf", "comparison-report.json"]
    report = pymupdf.open("pdf", download(client, res["outputs"][0]))
    assert report.page_count == 2 and "Page 2" in report[1].get_text() and report[0].rect.width > 1190
    assert json.loads(download(client, res["outputs"][1]))["summary"] == data["summary"]

    # identical docs -> no changes; different page counts -> warning
    r = client.post("/api/review/compare", json={"file_ids": [a["file_id"], a["file_id"]], "visual": False})
    assert r.json()["data"]["changes"] == [] and r.json()["data"]["summary"]["pages_changed"] == 0
    c = upload(client, make_pdf(3), "three.pdf")
    r = client.post("/api/review/compare", json={"file_ids": [a["file_id"], c["file_id"]], "text": False})
    assert r.json()["data"]["summary"]["extra_pages_b"] == 1 and r.json()["warnings"]


def test_accessibility(client, uploaded):
    r = client.post("/api/review/accessibility", json={"file_id": uploaded["file_id"]})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert 0 <= data["score"] <= 100
    checks = {c["id"]: c for c in data["checks"]}
    assert checks["tagged"]["status"] == "fail" and checks["language"]["status"] == "fail"
    assert checks["title"]["status"] == "fail" and checks["scanned"]["status"] == "pass"
    assert checks["contrast"]["status"] == "na"
    assert {"pass", "fail", "warn", "na"} >= {c["status"] for c in data["checks"]}
    # with a title it gets better
    t = client.post("/api/edit/metadata", json={"file_id": uploaded["file_id"], "title": "Accessible"}).json()
    r2 = client.post("/api/review/accessibility", json={"file_id": t["outputs"][0]["file_id"]}).json()["data"]
    assert r2["score"] > data["score"]
    assert {c["id"]: c for c in r2["checks"]}["title"]["status"] == "pass"


def test_inspect(client):
    doc = pymupdf.open("pdf", make_pdf(2))
    doc[0].insert_image(
        pymupdf.Rect(300, 300, 400, 400), pixmap=pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8), 0)
    )
    doc.embfile_add("notes.txt", b"hello attachment", filename="notes.txt")
    doc.set_metadata({"title": "Inspect me"})
    f = upload(client, doc.tobytes())
    r = client.post("/api/review/inspect", json={"file_id": f["file_id"]})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["page_count"] == 2 and d["metadata"]["title"] == "Inspect me"
    assert d["fonts"] and d["fonts"][0]["name"] == "Helvetica" and d["fonts"][0]["pages"] == [1, 2]
    assert d["fonts"][0]["embedded"] is False and d["fonts"][0]["type"]
    assert len(d["images"]) == 1 and d["images"][0]["width"] == 8 and d["images"][0]["pages"] == [1]
    assert d["attachments"][0]["name"] == "notes.txt"
    assert d["javascript"] is False and d["encrypted"] is False and d["is_tagged"] is False
    assert d["pages"][0]["images"] == 1 and d["pages"][1]["has_text"] is True
    assert d["permissions"]["print"] is True and d["pdf_version"].startswith("PDF")
    assert d["file_size"] == f["size"]

    r = client.post("/api/review/extract-attachments", json={"file_id": f["file_id"]})
    assert r.json()["data"]["count"] == 1
    assert download(client, r.json()["outputs"][0]) == b"hello attachment"


def test_word_count(client, uploaded):
    r = client.post("/api/review/word-count", json={"file_id": uploaded["file_id"]})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    # "Hello Folio page N" (4) + "The quick brown fox jumps over the lazy dog." (9) per page
    assert d["pages"] == 3 and d["words"] == 39 and d["lines"] == 6
    assert d["characters"] > d["characters_no_spaces"] > 0
    assert d["per_page"][0]["words"] == 13
    r = client.post("/api/review/word-count", json={"file_id": uploaded["file_id"], "pages": "2"})
    assert r.json()["data"]["words"] == 13


def test_measure(client, uploaded):
    fid = uploaded["file_id"]
    r = client.post("/api/review/measure", json={"file_id": fid, "page": 1, "points": [[0, 0], [72, 0]], "unit": "in"})
    assert r.status_code == 200, r.text
    assert abs(r.json()["data"]["distance"] - 1.0) < 1e-9
    r = client.post(
        "/api/review/measure",
        json={"file_id": fid, "page": 1, "points": [[0, 0], [72, 0], [72, 72], [0, 72]], "unit": "mm", "scale": 2},
    )
    d = r.json()["data"]
    assert abs(d["area"] - (25.4 * 2) ** 2) < 1e-6 and abs(d["perimeter"] - 4 * 25.4 * 2) < 1e-6
    assert (
        client.post("/api/review/measure", json={"file_id": fid, "page": 9, "points": [[0, 0], [1, 1]]}).status_code
        == 404
    )
