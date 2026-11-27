from __future__ import annotations

import io
import os
import tempfile

import pytest

# Point the store at a temp dir before the app imports settings.
_tmp = tempfile.mkdtemp(prefix="folio-test-")
os.environ["FOLIO_DATA_DIR"] = _tmp

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


def make_pdf(pages: int = 3, text: str = "Hello Folio") -> bytes:
    """Build a small multi-page PDF with real text using PyMuPDF."""
    import pymupdf as fitz

    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 72), f"{text} page {i + 1}", fontsize=18)
        page.insert_text((72, 120), "The quick brown fox jumps over the lazy dog.", fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def sample_pdf() -> bytes:
    return make_pdf()


def upload(client: TestClient, data: bytes, name: str = "sample.pdf", ctype: str = "application/pdf") -> dict:
    r = client.post("/api/files", files=[("files", (name, io.BytesIO(data), ctype))])
    assert r.status_code == 200, r.text
    return r.json()[0]


@pytest.fixture
def uploaded(client: TestClient, sample_pdf: bytes) -> dict:
    return upload(client, sample_pdf)


def wait_job(client: TestClient, job: dict, timeout: float = 120) -> dict:
    """Poll a JobOut until finished; returns the final JobOut."""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/jobs/{job['job_id']}")
        assert r.status_code == 200
        j = r.json()
        if j["state"] in ("done", "error"):
            return j
        time.sleep(0.2)
    raise AssertionError("job timed out")


def download(client: TestClient, file_out: dict) -> bytes:
    r = client.get(file_out["download_url"])
    assert r.status_code == 200
    return r.content
