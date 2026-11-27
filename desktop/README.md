# Desktop wrapper (planned)

Folio is built web-first with a strict API boundary so it can be packaged as a
desktop app later:

* The frontend only talks to the backend through `frontend/src/lib/api.ts`,
  using `VITE_API_BASE` as the base URL. A desktop wrapper sets this to the
  address of a bundled backend.
* The backend is a plain FastAPI app with no browser-specific assumptions and
  can run as a sidecar process (PyInstaller / python-build-standalone).
* `tauri://localhost` is already an allowed CORS origin.

Planned approach: **Tauri 2** shell + Python sidecar, with LibreOffice and
Tesseract as optional system dependencies detected at runtime (`/api/health`
reports what is available and the UI degrades gracefully).
