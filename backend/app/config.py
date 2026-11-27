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
    # SQLAlchemy URL. Empty = sqlite:///<data_dir>/folio.db. A pasted Supabase ``postgresql://`` or
    # ``postgres://`` URI is rewritten to the pure-Python pg8000 driver automatically.
    database_url: str = ""
    # Postgres TLS: path to the Supabase CA certificate (Database settings > SSL configuration >
    # Download certificate). With it the server certificate is verified; without it the connection
    # is encrypted but not verified (like libpq ``sslmode=require``). Supabase's CA is not in the
    # system trust store, so ``ssl.create_default_context()`` alone cannot verify the pooler.
    database_ssl_root_cert: str = ""
    # Use the first X-Forwarded-For hop as the client IP (only behind a trusted reverse proxy).
    trust_proxy: bool = False

    # ---- Supabase Auth ----------------------------------------------------------------------
    # Accounts are enabled whenever ``supabase_url`` is set (independently of billing).
    supabase_url: str = ""
    # Publishable key (sb_publishable_...). Public; handed to the frontend by /api/auth/config.
    supabase_publishable_key: str = ""
    # Secret key (sb_secret_...). Optional: enables the Auth Admin API (MFA checks, account deletion).
    supabase_secret_key: str = ""
    supabase_jwt_audience: str = "authenticated"
    # Billing, account deletion and API-key management need aal2 when the user has a verified TOTP factor.
    require_mfa_for_sensitive: bool = True
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

    @property
    def accounts_enabled(self) -> bool:
        return bool(self.supabase_url.strip())

    @property
    def supabase_base(self) -> str:
        return self.supabase_url.strip().rstrip("/")

    @property
    def supabase_issuer(self) -> str:
        return f"{self.supabase_base}/auth/v1"

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'folio.db').resolve().as_posix()}"


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
