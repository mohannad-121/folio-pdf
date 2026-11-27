"""Standalone entry point for the Folio backend (desktop sidecar / PyInstaller target).

Environment:
    FOLIO_HOST      bind address (default 127.0.0.1)
    FOLIO_PORT      port (default 8765)
    FOLIO_DATA_DIR  data folder; logs go to <data_dir>/logs/backend.log
    FOLIO_EXIT_ON_STDIN_EOF=1
                    exit as soon as stdin is closed. The desktop shell spawns the server with a
                    stdin pipe, so if the shell dies without cleaning up (crash, task kill) the
                    server notices the closed pipe and exits instead of lingering as an orphan.

Every other FOLIO_* variable is read by :mod:`app.config` as usual.
"""

from __future__ import annotations

import logging
import multiprocessing
import os
import sys
import threading
from pathlib import Path


def _base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _log_config(log_file: Path) -> dict:
    fmt = "%(asctime)s %(levelname)s %(name)s: %(message)s"
    handlers: dict = {
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(log_file),
            "maxBytes": 5 * 1024 * 1024,
            "backupCount": 3,
            "encoding": "utf-8",
            "formatter": "default",
        },
    }
    names = ["file"]
    if sys.stderr is not None:  # windowed/frozen builds may have no stderr
        handlers["console"] = {"class": "logging.StreamHandler", "stream": "ext://sys.stderr", "formatter": "default"}
        names.append("console")
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"default": {"format": fmt}},
        "handlers": handlers,
        "root": {"level": "INFO", "handlers": names},
        "loggers": {
            "uvicorn": {"level": "INFO", "handlers": [], "propagate": True},
            "uvicorn.error": {"level": "INFO", "handlers": [], "propagate": True},
            "uvicorn.access": {"level": "WARNING", "handlers": [], "propagate": True},
        },
    }


def _watch_stdin() -> None:
    def run() -> None:
        try:
            while sys.stdin.read(4096):
                pass
        except Exception:  # noqa: BLE001
            pass
        logging.getLogger("folio").info("stdin closed; parent process is gone, shutting down")
        os._exit(0)

    threading.Thread(target=run, name="parent-watch", daemon=True).start()


def main() -> None:
    multiprocessing.freeze_support()
    # Make `import app` work when run from another working directory (non-frozen).
    sys.path.insert(0, str(_base_dir()))

    host = os.environ.get("FOLIO_HOST", "127.0.0.1")
    port = int(os.environ.get("FOLIO_PORT", "8765"))
    data_dir = Path(os.environ.get("FOLIO_DATA_DIR", "data")).resolve()
    os.environ["FOLIO_DATA_DIR"] = str(data_dir)
    log_dir = data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    import logging.config

    logging.config.dictConfig(_log_config(log_dir / "backend.log"))
    log = logging.getLogger("folio")
    log.info("Folio server starting on http://%s:%d (data: %s, frozen: %s)", host, port, data_dir,
             bool(getattr(sys, "frozen", False)))

    if os.environ.get("FOLIO_EXIT_ON_STDIN_EOF") == "1" and sys.stdin is not None:
        _watch_stdin()

    import uvicorn

    from app.main import app

    uvicorn.run(app, host=host, port=port, log_config=None, access_log=False, workers=1)


if __name__ == "__main__":
    main()
