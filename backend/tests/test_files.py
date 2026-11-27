from .conftest import download, make_pdf, upload


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_upload_info_download(client, sample_pdf):
    f = upload(client, sample_pdf)
    assert f["name"] == "sample.pdf"
    assert f["page_count"] == 3
    assert download(client, f) == sample_pdf
    r = client.get(f"/api/files/{f['file_id']}")
    assert r.json()["file_id"] == f["file_id"]


def test_pdf_info_and_render(client, uploaded):
    fid = uploaded["file_id"]
    info = client.get(f"/api/files/{fid}/pdf-info").json()
    assert info["page_count"] == 3
    assert info["has_text"] is True
    assert len(info["pages"]) == 3
    img = client.get(f"/api/files/{fid}/pages/1/render?scale=0.5")
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert client.get(f"/api/files/{fid}/pages/99/render").status_code == 404


def test_text_and_search(client, uploaded):
    fid = uploaded["file_id"]
    text = client.get(f"/api/files/{fid}/text?pages=2").json()
    assert len(text) == 1 and "page 2" in text[0]["text"]
    hits = client.get(f"/api/files/{fid}/search", params={"q": "lazy dog"}).json()
    assert hits["count"] == 3


def test_bad_ids(client):
    assert client.get("/api/files/not-an-id").status_code == 400
    assert client.get("/api/files/" + "0" * 32).status_code == 404
    assert client.get("/api/jobs/nope").status_code == 404


def test_non_pdf_rejected_by_pdf_info(client):
    f = upload(client, b"just text", "note.txt", "text/plain")
    assert client.get(f"/api/files/{f['file_id']}/pdf-info").status_code == 400


def test_page_spec():
    from app.schemas import parse_page_spec

    assert parse_page_spec("all", 4) == [0, 1, 2, 3]
    assert parse_page_spec("1-2,4", 4) == [0, 1, 3]
    assert parse_page_spec("3-", 5) == [2, 3, 4]
    assert parse_page_spec("odd", 5) == [0, 2, 4]
    assert parse_page_spec("last", 5) == [4]
    assert make_pdf(1)[:4] == b"%PDF"
