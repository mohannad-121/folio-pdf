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

## Download

Desktop apps for **Windows, macOS and Linux** are on the
[GitHub Releases page](https://github.com/mohannad-121/folio-pdf/releases/latest). They run
completely offline: the PDF engine is bundled and runs locally, nothing is uploaded anywhere.

| OS | File | Notes |
| --- | --- | --- |
| Windows 10/11 (x64) | `Folio-PDF-<version>-win-x64-setup.exe` (installer) or `…-portable.exe` | The app is not code-signed yet, so SmartScreen shows "Windows protected your PC": click **More info → Run anyway**. Runs on Windows on ARM through x64 emulation. |
| macOS Apple silicon | `Folio-PDF-<version>-mac-arm64.dmg` | Not signed/notarized yet. Open the DMG, drag Folio PDF to Applications, then **right-click the app → Open → Open** the first time. If macOS says the app "is damaged", run `xattr -dr com.apple.quarantine "/Applications/Folio PDF.app"`. |
| macOS Intel | `Folio-PDF-<version>-mac-x64.dmg` | Same as above. |
| Linux (x64) | `.AppImage`, `.deb`, `.rpm` | AppImage: `chmod +x Folio-PDF-*.AppImage && ./Folio-PDF-*.AppImage` (needs `libfuse2` on Ubuntu 22.04+: `sudo apt install libfuse2`). Debian/Ubuntu: `sudo apt install ./Folio-PDF-*.deb`. Fedora/openSUSE: `sudo dnf install ./Folio-PDF-*.rpm`. |

The installed app updates itself from GitHub Releases (the portable Windows build does not).
A few tools need free system programs that are **not** bundled (they are large):
LibreOffice (Office ⇄ PDF), Tesseract (OCR) and Ghostscript (PDF/A). Open
**Help → Optional components** in the app to see what is detected and how to install each
one (`winget` / `brew` / `apt` one-liners), then restart the app.

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

## Build the desktop app

The desktop app (`desktop/`) is an Electron shell. On start it launches the backend, frozen
with PyInstaller, on a random `127.0.0.1` port; the backend also serves the built frontend,
so the window loads `http://127.0.0.1:<port>/` and everything is same-origin.

Requirements: Node 22+, the backend virtualenv from [Development](#development) (or any
Python 3.12+ with `backend/requirements.txt` installed; point `FOLIO_PYTHON` at it) plus
PyInstaller:

```bash
backend/.venv/Scripts/python -m pip install pyinstaller   # or backend/.venv/bin/python
cd desktop
npm install
npm run dev            # Electron + backend straight from backend/.venv (uses frontend/dist)
npm run dist           # build frontend + frozen backend, then installers for this OS -> desktop/dist/
```

* `npm run build:frontend` builds the SPA and copies it to `desktop/build/frontend-dist`.
* `npm run build:backend` runs `backend/folio.spec` with PyInstaller → `desktop/build/backend/`.
* `node scripts/smoke-backend.mjs` starts the frozen backend and checks health, `/`, upload and a tool call.
* `npm run dist:win` / `dist:mac` / `dist:linux` package for one OS. You can only build for the OS you
  are on, because the backend is a native binary. CI builds all of them.
* `FOLIO_DEV_URL=http://localhost:5173 npm run dev` points the window at a running Vite dev server
  instead (start the backend and `npm run dev` in `frontend/` yourself; Vite proxies `/api`).
* `npm run build:icons` regenerates `build/icon.png` / `icon.ico` (headless Edge/Chrome + Pillow).

Releases: pushing a tag `v*` runs [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml),
which builds Windows (x64), macOS (arm64 + x64) and Linux (x64) and attaches the installers to a
**draft** release. Running the workflow manually uploads them as workflow artifacts instead.
Code signing and notarization switch on when the secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are added to the repository.

## Architecture

```
frontend/   React 19 + TypeScript + Vite + Tailwind, pdf.js viewer
backend/    FastAPI; PyMuPDF, pikepdf, pdf2docx, python-pptx, openpyxl,
            ocrmypdf, pyHanko, WeasyPrint, LibreOffice headless
desktop/    Electron shell; runs the PyInstaller-frozen backend as a local sidecar
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
