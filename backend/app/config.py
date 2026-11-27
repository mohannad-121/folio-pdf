from __future__ import annotations

from pathlib import Path
from typing import Literal

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
    # Built frontend to serve (SPA). None = <repo>/frontend/dist when it exists (desktop app sets this).
    static_dir: Path | None = None

    # ---- accounts & billing -------------------------------------------------------------
    # False = self-hosted open-source edition: every tool unlocked, accounts optional,
    # billing endpoints report ``enabled: false``.
    billing_enabled: bool = False
    # SQLAlchemy URL. Empty = sqlite:///<data_dir>/folio.db.
    database_url: str = ""
    # Key that signs session cookies. Empty = generated once and persisted in <data_dir>/.secret_key.
    secret_key: str = ""
    session_days: int = 30
    # Set to true when served over HTTPS so the session cookie gets the Secure flag.
    cookie_secure: bool = False
    # Use the first X-Forwarded-For hop as the client IP (only behind a trusted reverse proxy).
    trust_proxy: bool = False
    # Paddle Billing.
    paddle_environment: Literal["sandbox", "production"] = "sandbox"
    paddle_client_token: str = ""  # client-side token for Paddle.js
    paddle_api_key: str = ""  # server-side API key
    paddle_webhook_secret: str = ""  # notification destination secret key (pdl_ntfset_...)
    paddle_price_plus_monthly: str = ""
    paddle_price_plus_yearly: str = ""
    paddle_price_pro_monthly: str = ""
    paddle_price_pro_yearly: str = ""
    paddle_price_max_monthly: str = ""
    paddle_price_max_yearly: str = ""
    # Display only; the real trial is configured on the Paddle prices.
    trial_days: int = 7
    # Public URL of the frontend (checkout success redirect).
    public_url: str = "http://localhost:5173"

    @property
    def paddle_api_base(self) -> str:
        if self.paddle_environment == "production":
            return "https://api.paddle.com"
        return "https://sandbox-api.paddle.com"

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'folio.db').resolve().as_posix()}"


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
