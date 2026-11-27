from __future__ import annotations

import io

import pymupdf

from .conftest import download, make_pdf, upload


def out_doc(client, res: dict, idx: int = 0) -> pymupdf.Document:
    return pymupdf.open("pdf", download(client, res["outputs"][idx]))


def test_fonts(client):
    r = client.get("/api/sign/fonts")
    assert r.status_code == 200
    assert {f["style"] for f in r.json()} == {"cursive", "serif", "sans"}


def test_signature_image_draw_and_type_then_stamp(client, uploaded):
    from PIL import Image

    r = client.post(
        "/api/sign/signature-image",
        json={
            "kind": "draw",
            "paths": [[[10, 100], [200, 50], [400, 150], [590, 100]], [[300, 20]]],
            "color": "#0000ff",
        },
    )
    assert r.status_code == 200, r.text
    drawn = r.json()["outputs"][0]
    assert drawn["content_type"] == "image/png"
    img = Image.open(io.BytesIO(download(client, drawn)))
    assert img.size == (600, 200) and img.mode == "RGBA"
    assert img.getpixel((2, 2))[3] == 0  # transparent background
    assert img.getchannel("A").getbbox() is not None

    r = client.post("/api/sign/signature-image", json={"kind": "type", "text": "Ada Lovelace", "font": "cursive"})
    assert r.status_code == 200, r.text
    typed = r.json()["outputs"][0]
    timg = Image.open(io.BytesIO(download(client, typed)))
    assert timg.getchannel("A").getbbox() is not None
    assert client.post("/api/sign/signature-image", json={"kind": "type"}).status_code == 422

    r = client.post(
        "/api/sign/stamp",
        json={
            "file_id": uploaded["file_id"],
            "placements": [
                {"page": 1, "rect": [300, 600, 500, 680], "image_file_id": drawn["file_id"]},
                {"page": 3, "rect": [72, 700, 300, 760], "image_file_id": typed["file_id"]},
                {"page": 2, "rect": [72, 700, 300, 730], "text": "Signed by Ada"},
            ],
            "date_stamp": True,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["placed"] == 3 and r.json()["outputs"][0]["name"] == "sample-signed.pdf"
    out = out_doc(client, r.json())
    assert len(out[0].get_images()) == 1 and len(out[2].get_images()) == 1
    assert "Signed by Ada" in out[1].get_text()
    assert "Signed 20" in out[0].get_text()


def test_digital_self_signed_then_verify(client, uploaded):
    r = client.post(
        "/api/sign/digital",
        json={"file_id": uploaded["file_id"], "reason": "I approve", "location": "Lab", "signer_name": "Ada"},
    )
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["data"]["self_signed"] is True and res["data"]["signer"] == "Ada"
    assert any("self-signed" in w for w in res["warnings"])
    signed = res["outputs"][0]
    assert signed["name"] == "sample-signed.pdf"
    doc = out_doc(client, res)
    assert doc.page_count == 3
    widgets = [w for w in doc[2].widgets()]
    assert widgets and widgets[0].field_type_string == "Signature" and widgets[0].is_signed
    assert doc[2].search_for("Digitally signed by")

    v = client.post("/api/sign/verify", json={"file_id": signed["file_id"]})
    assert v.status_code == 200, v.text
    data = v.json()["data"]
    assert data["count"] == 1
    sig = data["signatures"][0]
    assert sig["intact"] is True and sig["valid"] is True and sig["trusted"] is False
    assert sig["signer"] == "Ada" and sig["reason"] == "I approve" and sig["entire_file"] is True
    assert sig["self_signed"] is True and sig["signing_time"]

    # unsigned document -> no signatures
    v = client.post("/api/sign/verify", json={"file_id": uploaded["file_id"]})
    assert v.json()["data"] == {"signatures": [], "count": 0}


def test_self_signed_cert_then_sign_with_it(client):
    r = client.post(
        "/api/sign/self-signed-cert",
        json={"common_name": "Folio Tester", "email": "t@example.com", "org": "Folio", "password": "secret"},
    )
    assert r.status_code == 200, r.text
    cert = r.json()["outputs"][0]
    assert cert["name"].endswith(".p12") and "CN=Folio Tester" in r.json()["data"]["subject"]

    pdf = upload(client, make_pdf(1))
    r = client.post(
        "/api/sign/digital",
        json={"file_id": pdf["file_id"], "cert_file_id": cert["file_id"], "cert_password": "secret", "visible": False},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["self_signed"] is False and r.json()["data"]["signer"] == "Folio Tester"
    v = client.post("/api/sign/verify", json={"file_id": r.json()["outputs"][0]["file_id"]}).json()["data"]
    assert v["count"] == 1 and v["signatures"][0]["valid"] is True and v["signatures"][0]["signer"] == "Folio Tester"

    bad = client.post(
        "/api/sign/digital", json={"file_id": pdf["file_id"], "cert_file_id": cert["file_id"], "cert_password": "wrong"}
    )
    assert bad.status_code == 400


def test_tampered_signature_not_intact(client):
    pdf = upload(client, make_pdf(1))
    r = client.post("/api/sign/digital", json={"file_id": pdf["file_id"], "visible": False})
    data = download(client, r.json()["outputs"][0])
    # flip a byte inside the signed range (the "Written by MuPDF" header comment)
    tampered = data.replace(b"Written by MuPDF", b"Written by MuPDX", 1)
    assert tampered != data
    t = upload(client, tampered, "tampered.pdf")
    v = client.post("/api/sign/verify", json={"file_id": t["file_id"]}).json()["data"]
    assert v["count"] == 1 and v["signatures"][0]["intact"] is False
