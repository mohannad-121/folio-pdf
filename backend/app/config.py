from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every field can be overridden with a FOLIO_* env var."""

    model_config = SettingsConfigDict(env_prefix="FOLIO_", env_file=".env", extra="ignore")

    # Where uploaded + generated files live. Each file gets its own folder keyed by id.
    data_dir: Path = Path("data")
    # Uploads larger than this are rejected (bytes). Default 500 MB.
    max_upload_bytes: int = 500 * 1024 * 1024
    # Files older than this are swept by the cleanup task (seconds). Default 24h.
    file_ttl_seconds: int = 24 * 60 * 60
    # Allowed CORS origins for the dev frontend / desktop wrapper.
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost"]
    # Worker threads for background jobs.
    job_workers: int = 4
    # External binaries. Leave empty to use whatever is on PATH.
    soffice_bin: str = ""  # LibreOffice headless (Office -> PDF)
    tesseract_bin: str = ""  # Tesseract OCR
    # Default OCR languages (tesseract codes, '+'-separated).
    ocr_languages: str = "eng"


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
