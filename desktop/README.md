# Folio PDF desktop (Electron)

The desktop app is a thin Electron shell around the same backend + frontend as the web app.

```
Electron main (src/main.js)
 ├─ picks a free port, spawns the sidecar  resources/backend/folio-server[.exe]
 │     FOLIO_HOST=127.0.0.1  FOLIO_PORT=<port>  FOLIO_DATA_DIR=<userData>/data
 │     FOLIO_STATIC_DIR=resources/frontend-dist  FOLIO_BILLING_ENABLED=false
 ├─ splash (src/splash.html) until GET /api/health answers (60 s timeout)
 └─ BrowserWindow -> http://127.0.0.1:<port>/   (same origin: API, cookies, pdf.js just work)
```

* `src/preload.js` exposes `window.folioDesktop` (`platform`, `version`, `openExternal`,
  `showItemInFolder`, `onOpenFile`).
* **File → Open PDF…**, double-clicking a `.pdf` (file association), a second launch with a path,
  or dropping a PDF on the macOS Dock icon all upload the file to `/api/files` from the main
  process and navigate to `/view/<file_id>`.
* Downloads get a native *Save as* dialog and a "show in folder" notification.
* **Help → Optional components** (`src/components.html`) shows whether LibreOffice, Tesseract and
  Ghostscript were found, with install commands per OS.
* The sidecar is killed on quit (tree-kill on Windows, process group on macOS/Linux) and also
  exits by itself when its stdin pipe closes, so a crashed shell leaves no orphan server.
* Logs: `<userData>/data/logs/main.log` (Electron) and `backend.log` (server); **Help → Open logs folder**.
* Auto-update: `electron-updater` against GitHub Releases (installed builds only).

## Commands

```bash
npm install
npm run dev              # Electron + backend from ../backend/.venv (python folio_server.py)
FOLIO_DEV_URL=http://localhost:5173 npm run dev   # use a running Vite dev server instead
FOLIO_USE_FROZEN_BACKEND=1 npm run dev            # dev shell + the PyInstaller build in build/backend

npm run build:frontend   # ../frontend build -> build/frontend-dist
npm run build:backend    # PyInstaller (../backend/folio.spec) -> build/backend
node scripts/smoke-backend.mjs   # health, index, upload, rotate against the frozen backend
npm run dist             # everything + installers for this OS -> dist/
npm run dist:win | dist:mac | dist:linux
npm run build:icons      # regenerate build/icon.png + icon.ico
```

Python for `build:backend` is `$FOLIO_PYTHON`, else `../backend/.venv`, else `python3`/`python`;
it needs `pip install -r ../backend/requirements.txt pyinstaller`.
