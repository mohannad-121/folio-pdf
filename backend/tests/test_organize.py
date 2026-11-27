from __future__ import annotations

import io
import zipfile

import pymupdf

from .conftest import download, make_pdf, upload


def _open(data: bytes) -> pymupdf.Document:
    return pymupdf.open(stream=data, filetype="pdf")


def _toc_pdf(pages: int = 4) -> bytes:
    doc = _open(make_pdf(pages, "Chapter"))
    doc.set_toc([[1, "Intro", 1], [2, "Detail", 2], [1, "Second", 3]])
    return doc.tobytes()


def _png_bytes() -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 100), 0)
    pix.clear_with(200)
    return pix.tobytes("png")


def test_merge_pdfs_images_and_bookmarks(client):
    a = upload(client, _toc_pdf(4), "a.pdf")
    b = upload(client, make_pdf(2, "B"), "b.pdf")
    img = upload(client, _png_bytes(), "photo.png", "image/png")
    r = client.post("/api/organize/merge", json={"file_ids": [a["file_id"], b["file_id"], img["file_id"]]})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["data"]["page_count"] == 7
    assert [s["pages"] for s in res["data"]["sources"]] == [4, 2, 1]
    out = res["outputs"][0]
    assert out["name"] == "merged.pdf" and out["page_count"] == 7
    doc = _open(download(client, out))
    toc = doc.get_toc(simple=True)
    assert [1, "a", 1] in toc
    assert [2, "Intro", 1] in toc and [3, "Detail", 2] in toc
    assert [1, "b", 5] in toc and [1, "photo", 7] in toc


def test_merge_rejects_unsupported_and_empty(client):
    txt = upload(client, b"hello", "note.txt", "text/plain")
    pdf = upload(client, make_pdf(1), "x.pdf")
    r = client.post("/api/organize/merge", json={"file_ids": [pdf["file_id"], txt["file_id"]]})
    assert r.status_code == 400 and "note.txt" in r.json()["detail"]
    assert client.post("/api/organize/merge", json={}).status_code == 400


def test_split_modes(client):
    f = upload(client, make_pdf(5), "doc.pdf")
    fid = f["file_id"]
    r = client.post("/api/organize/split", json={"file_id": fid, "mode": "ranges", "ranges": "1-2, 3, 4-"})
    assert r.status_code == 200, r.text
    outs = r.json()["outputs"]
    assert [o["name"] for o in outs] == ["doc-part-01.pdf", "doc-part-02.pdf", "doc-part-03.pdf", "doc-split.zip"]
    assert [o["page_count"] for o in outs[:3]] == [2, 1, 2]
    with zipfile.ZipFile(io.BytesIO(download(client, outs[3]))) as zf:
        assert sorted(zf.namelist()) == ["doc-part-01.pdf", "doc-part-02.pdf", "doc-part-03.pdf"]

    r = client.post("/api/organize/split", json={"file_id": fid, "mode": "every", "every": 2})
    assert [o["page_count"] for o in r.json()["outputs"][:-1]] == [2, 2, 1]

    r = client.post("/api/organize/split", json={"file_id": fid, "mode": "single"})
    assert len(r.json()["outputs"]) == 6  # 5 parts + zip

    assert client.post("/api/organize/split", json={"file_id": fid, "mode": "bookmarks"}).status_code == 400
    assert client.post("/api/organize/split", json={"file_id": fid, "mode": "ranges"}).status_code == 400

    t = upload(client, _toc_pdf(4), "toc.pdf")
    r = client.post("/api/organize/split", json={"file_id": t["file_id"], "mode": "bookmarks"})
    assert r.status_code == 200, r.text
    assert [o["page_count"] for o in r.json()["outputs"][:-1]] == [2, 2]


def test_extract_delete_duplicate(client):
    f = upload(client, make_pdf(5), "doc.pdf")
    fid = f["file_id"]
    r = client.post("/api/organize/extract", json={"file_id": fid, "pages": "2,4"})
    assert r.status_code == 200, r.text
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 2 and "page 2" in doc[0].get_text() and "page 4" in doc[1].get_text()

    r = client.post("/api/organize/delete", json={"file_id": fid, "pages": "1,5"})
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 3 and "page 2" in doc[0].get_text()
    assert client.post("/api/organize/delete", json={"file_id": fid, "pages": "all"}).status_code == 400
    assert client.post("/api/organize/delete", json={"file_id": fid, "pages": "x-y"}).status_code == 400

    r = client.post("/api/organize/duplicate", json={"file_id": fid, "pages": "1"})
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 6 and "page 1" in doc[0].get_text() and "page 1" in doc[1].get_text()
    assert "page 2" in doc[2].get_text()


def test_rotate_multiple(client):
    a = upload(client, make_pdf(2), "a.pdf")
    b = upload(client, make_pdf(1), "b.pdf")
    r = client.post("/api/organize/rotate", json={"file_ids": [a["file_id"], b["file_id"]], "angle": 90, "pages": "1"})
    assert r.status_code == 200, r.text
    outs = r.json()["outputs"]
    assert len(outs) == 2
    doc = _open(download(client, outs[0]))
    assert doc[0].rotation == 90 and doc[1].rotation == 0
    r = client.post("/api/organize/rotate", json={"file_id": outs[0]["file_id"], "angle": 270})
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc[0].rotation == 0 and doc[1].rotation == 270
    assert client.post("/api/organize/rotate", json={"file_id": a["file_id"], "angle": 45}).status_code == 422


def test_insert_blank_and_pdf(client):
    f = upload(client, make_pdf(2), "doc.pdf")
    r = client.post("/api/organize/insert", json={"file_id": f["file_id"], "at": 1, "blank_count": 2})
    assert r.status_code == 200, r.text
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 4
    assert "page 1" in doc[0].get_text() and not doc[1].get_text().strip() and "page 2" in doc[3].get_text()
    assert doc[1].rect.width == 595

    other = upload(client, make_pdf(1, "Other"), "other.pdf")
    r = client.post("/api/organize/insert", json={"file_id": f["file_id"], "at": 0, "insert_file_id": other["file_id"]})
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 3 and "Other" in doc[0].get_text()
    assert client.post("/api/organize/insert", json={"file_id": f["file_id"], "blank_count": 0}).status_code == 400


def test_reorder(client):
    f = upload(client, make_pdf(3), "doc.pdf")
    body = {
        "file_id": f["file_id"],
        "pages": [{"source_page": 3}, {"source_page": 1, "rotation": 180}, {"source_page": 3}],
    }
    r = client.post("/api/organize/reorder", json=body)
    assert r.status_code == 200, r.text
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 3
    assert "page 3" in doc[0].get_text() and "page 1" in doc[1].get_text() and "page 3" in doc[2].get_text()
    assert doc[1].rotation == 180
    assert client.post("/api/organize/reorder", json={"file_id": f["file_id"], "pages": []}).status_code == 400
    bad = {"file_id": f["file_id"], "pages": [{"source_page": 9}]}
    assert client.post("/api/organize/reorder", json=bad).status_code == 400


def test_replace(client):
    f = upload(client, make_pdf(4), "doc.pdf")
    rep = upload(client, make_pdf(2, "New"), "new.pdf")
    body = {"file_id": f["file_id"], "pages": "2-3", "replacement_file_id": rep["file_id"]}
    r = client.post("/api/organize/replace", json=body)
    assert r.status_code == 200, r.text
    doc = _open(download(client, r.json()["outputs"][0]))
    texts = [p.get_text() for p in doc]
    assert doc.page_count == 4
    assert "page 1" in texts[0] and "New page 1" in texts[1] and "New page 2" in texts[2] and "page 4" in texts[3]


def test_nup_and_booklet(client):
    f = upload(client, make_pdf(5), "doc.pdf")
    r = client.post("/api/organize/n-up", json={"file_id": f["file_id"], "per_page": 4})
    assert r.status_code == 200, r.text
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 2 and doc[0].rect.width < doc[0].rect.height
    assert "page 1" in doc[0].get_text() and "page 5" in doc[1].get_text()

    r = client.post("/api/organize/n-up", json={"file_id": f["file_id"], "per_page": 2})
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 3 and doc[0].rect.width > doc[0].rect.height

    r = client.post("/api/organize/booklet", json={"file_id": f["file_id"]})
    assert r.status_code == 200, r.text
    doc = _open(download(client, r.json()["outputs"][0]))
    assert doc.page_count == 4  # 5 pages -> 8 slots -> 4 sides
    first = doc[0].get_text()
    assert "page 1" in first  # sheet 1 front holds last (blank) | first
    assert doc[0].rect.width > doc[0].rect.height
