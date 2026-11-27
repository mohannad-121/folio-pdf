from __future__ import annotations

import pymupdf

from .conftest import download, make_pdf, upload


def _open(data: bytes) -> pymupdf.Document:
    return pymupdf.open(stream=data, filetype="pdf")


PII_LINES = [
    "Contact: jane.doe@example.com or john@mail.example.org",
    "Call +1 (555) 123-4567 or 020 7946 0958 today",
    "SSN 123-45-6789 on file. Card 4111 1111 1111 1111 accepted.",
    "IBAN DE89 3704 0044 0532 0130 00 and the word Confidential appears here.",
    "Not a card: 1234 5678 9012 3456. Totally public text.",
]


def _pii_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    for line in PII_LINES:
        page.insert_text((50, y), line, fontsize=11)
        y += 24
    return doc.tobytes()


def test_protect_and_permissions_and_unlock(client):
    f = upload(client, make_pdf(2), "doc.pdf")
    body = {
        "file_id": f["file_id"],
        "user_password": "open123",
        "owner_password": "own456",
        "allow_print": True,
        "allow_copy": False,
        "allow_modify": False,
    }
    r = client.post("/api/security/protect", json=body)
    assert r.status_code == 200, r.text
    out = r.json()["outputs"][0]
    assert out["name"] == "doc-protected.pdf"
    doc = _open(download(client, out))
    assert doc.needs_pass
    assert doc.authenticate("open123")

    perms = client.get(f"/api/security/permissions/{out['file_id']}").json()
    assert perms["encrypted"] and perms["needs_password"]
    perms = client.get(f"/api/security/permissions/{out['file_id']}", params={"password": "open123"}).json()
    assert perms["encrypted"] and perms["permissions"]["print"] is True
    assert perms["permissions"]["copy"] is False and perms["permissions"]["modify"] is False
    assert "AES" in (perms["encryption_method"] or "")

    assert client.post("/api/security/unlock", json={"file_id": out["file_id"]}).status_code == 401
    assert client.post("/api/security/unlock", json={"file_id": out["file_id"], "password": "nope"}).status_code == 401
    r = client.post("/api/security/unlock", json={"file_id": out["file_id"], "password": "open123"})
    assert r.status_code == 200, r.text
    unlocked = _open(download(client, r.json()["outputs"][0]))
    assert not unlocked.needs_pass and not unlocked.metadata.get("encryption")
    assert unlocked.page_count == 2 and "Hello Folio" in unlocked[0].get_text()


def test_protect_owner_only_then_unlock_without_password(client):
    f = upload(client, make_pdf(1), "doc.pdf")
    body = {"file_id": f["file_id"], "owner_password": "own", "allow_copy": False}
    r = client.post("/api/security/protect", json=body)
    assert r.status_code == 200, r.text
    out = r.json()["outputs"][0]
    doc = _open(download(client, out))
    assert not doc.needs_pass and "AES" in doc.metadata.get("encryption", "")
    perms = client.get(f"/api/security/permissions/{out['file_id']}").json()
    assert perms["encrypted"] and not perms["needs_password"] and perms["permissions"]["copy"] is False
    r = client.post("/api/security/unlock", json={"file_id": out["file_id"]})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["was_encrypted"] == [True]
    assert not _open(download(client, r.json()["outputs"][0])).metadata.get("encryption")
    assert client.post("/api/security/protect", json={"file_id": f["file_id"]}).status_code == 400


def test_redact_preview_and_apply(client):
    f = upload(client, _pii_pdf(), "pii.pdf")
    fid = f["file_id"]
    prev = client.get(
        f"/api/security/redact/preview/{fid}",
        params={
            "emails": True,
            "phones": True,
            "ssn": True,
            "credit_cards": True,
            "iban": True,
            "terms": ["confidential"],
        },
    )
    assert prev.status_code == 200, prev.text
    p = prev.json()
    # 2 emails + 2 phones + 1 ssn + 1 valid card (the 1234... one fails Luhn) + 1 iban + 1 term
    assert p["count"] == 8, p
    assert p["per_page"] == {"1": 8}
    assert all(m["page"] == 1 and len(m["rect"]) == 4 for m in p["matches"])
    # preview does not modify the file
    assert "jane.doe@example.com" in _open(download(client, f))[0].get_text()

    body = {
        "file_id": fid,
        "emails": True,
        "phones": True,
        "ssn": True,
        "credit_cards": True,
        "iban": True,
        "terms": "confidential\n",
        "regex": r"public",
    }
    r = client.post("/api/security/redact", json=body)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["data"]["matches"] == 9 and res["data"]["per_page"] == {"1": 9}
    text = _open(download(client, res["outputs"][0]))[0].get_text()
    for gone in (
        "jane.doe@example.com",
        "john@mail",
        "555",
        "7946",
        "123-45-6789",
        "4111",
        "DE89",
        "Confidential",
        "public",
    ):
        assert gone not in text, (gone, text)
    for kept in ("Contact:", "Call", "on file", "1234 5678 9012 3456", "Totally"):
        assert kept in text, (kept, text)


def test_redact_terms_regions_and_options(client):
    f = upload(client, make_pdf(2), "doc.pdf")
    fid = f["file_id"]
    # whole-word, case-sensitive: "Fox" must not match "fox"; "fox" must.
    prev = client.get(f"/api/security/redact/preview/{fid}", params={"terms": "Fox", "case_sensitive": True}).json()
    assert prev["count"] == 0
    prev = client.get(f"/api/security/redact/preview/{fid}", params={"terms": "fox", "whole_words": True}).json()
    assert prev["count"] == 2
    prev = client.get(f"/api/security/redact/preview/{fid}", params={"terms": "fo", "whole_words": True}).json()
    assert prev["count"] == 0
    prev = client.get(f"/api/security/redact/preview/{fid}", params={"terms": "fox", "pages": "2"}).json()
    assert prev["count"] == 1 and prev["matches"][0]["page"] == 2

    body = {
        "file_id": fid,
        "terms": ["lazy dog"],
        "pages": "1",
        "fill_color": "#ff0000",
        "regions": [{"page": 2, "rects": [[60, 55, 300, 95]]}],
    }
    r = client.post("/api/security/redact", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["matches"] == 2
    doc = _open(download(client, r.json()["outputs"][0]))
    assert "lazy dog" not in doc[0].get_text() and "lazy dog" in doc[1].get_text()
    assert "page 2" not in doc[1].get_text()  # region covered the headline
    assert client.post("/api/security/redact", json={"file_id": fid, "regex": "("}).status_code == 400
    assert client.post("/api/security/redact", json={"file_id": fid, "fill_color": "zzz"}).status_code == 400


def test_sanitize(client):
    doc = _open(make_pdf(1))
    doc.set_metadata({"title": "Hidden title", "author": "Me"})
    doc.embfile_add("notes.txt", b"secret notes")
    page = doc[0]
    page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(70, 60, 200, 90), "uri": "https://example.com"})
    page.add_text_annot((300, 300), "a comment")
    w = pymupdf.Widget()
    w.field_name = "f1"
    w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    w.rect = pymupdf.Rect(72, 400, 300, 430)
    w.field_value = "v"
    page.add_widget(w)
    f = upload(client, doc.tobytes(), "dirty.pdf")

    r = client.post("/api/security/sanitize", json={"file_id": f["file_id"]})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["embedded_files"] == 1
    out = _open(download(client, r.json()["outputs"][0]))
    assert out.embfile_count() == 0 and not out.metadata.get("title")
    assert len(out[0].get_links()) == 1  # links kept by default
    assert len(list(out[0].annots())) == 1  # comments kept by default

    body = {"file_id": f["file_id"], "annotations": True, "forms": True, "links": True}
    r = client.post("/api/security/sanitize", json=body)
    d = r.json()["data"]
    assert d["annotations"] == 1 and d["widgets"] == 1 and d["links"] == 1
    out = _open(download(client, r.json()["outputs"][0]))
    assert not list(out[0].annots()) and not list(out[0].widgets()) and not out[0].get_links()
    assert "Hello Folio" in out[0].get_text()
