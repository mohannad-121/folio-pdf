# Folio PDF

**Every PDF tool. One place. Yours.**

Folio is an open-source, self-hosted PDF workstation: view, edit, annotate, convert, merge, split, compress, OCR, sign, protect, redact and compare PDFs — all from a browser, on your own machine. Think Acrobat, without the subscription or the upload to someone else's cloud.

## Features

| Area | What you get |
| --- | --- |
| **View** | Fast pdf.js viewer, search, zoom, thumbnails, bookmarks/outline, text selection, read aloud, print |
| **Edit** | Edit existing text, add text/images/shapes, highlight, underline, strike, draw, sticky notes, links, watermarks, backgrounds, headers/footers, page numbers, crop, resize, metadata, bookmarks |
| **Organize** | Merge (PDFs, images, Office files), split, extract, delete, insert, reorder (drag & drop), rotate |
| **Convert from PDF** | Word (DOCX), Excel (XLSX), PowerPoint (PPTX), JPG/PNG/WebP/TIFF, HTML, text/Markdown, PDF/A |
| **Convert to PDF** | Word, Excel, PowerPoint, images, HTML/URL, text/Markdown, scans |
| **Optimize** | Compress (4 levels), OCR (Tesseract, 10+ languages), repair, flatten, grayscale |
| **Security** | AES-256 password protection, permissions, unlock, redaction (terms, regex, PII patterns, regions), sanitize hidden data |
| **Forms & Sign** | Fill forms, create fields, export/import data, draw/type/upload signatures, PKCS#12 digital signatures, signature verification |
| **Review** | Compare two PDFs (text + visual diff), accessibility audit, inspector, word count |

## Quick start (Docker — recommended)

```bash
git clone https://github.com/mohannad-121/folio-pdf.git
cd folio-pdf
docker compose up --build
```

Open <http://localhost:8080>. The Docker image bundles LibreOffice, Tesseract, Ghostscript and every font you need.

## Development

**Backend** (Python 3.12+):

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate   # or source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

API docs at <http://localhost:8000/docs>.

**Frontend** (Node 22+):

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to the backend.

Optional system tools for local dev (the Docker image includes them):

* [LibreOffice](https://www.libreoffice.org/) — Office ⇄ PDF conversion
* [Tesseract](https://github.com/tesseract-ocr/tesseract) — OCR
* [Ghostscript](https://www.ghostscript.com/) + [qpdf](https://qpdf.sourceforge.io/) — used by ocrmypdf and PDF/A

Set `FOLIO_SOFFICE_BIN` / `FOLIO_TESSERACT_BIN` in `backend/.env` if they are not on your PATH. `/api/health` reports what was detected.

## Architecture

```
frontend/   React 19 + TypeScript + Vite + Tailwind, pdf.js viewer
backend/    FastAPI; PyMuPDF, pikepdf, pdf2docx, python-pptx, openpyxl,
            ocrmypdf, pyHanko, WeasyPrint, LibreOffice headless
desktop/    (planned) Tauri wrapper around the same frontend + a backend sidecar
```

* Upload once → get a `file_id` → chain any number of tools → download.
* Fast tools answer synchronously; slow ones (OCR, Office conversion) return a job you poll.
* Every tool is one Python module in `backend/app/tools/` with an `APIRouter`; routers are auto-discovered.
* Every tool page is one entry in `frontend/src/lib/tools.ts`; the UI is generated from it.

## Tests

```bash
cd backend && pytest
cd frontend && npm run lint && npm run build
```

## License

MIT
