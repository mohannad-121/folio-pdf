"""File storage.

Every file Folio touches (uploads and outputs) is stored under
``settings.data_dir/<file_id>/<original_name>`` and addressed by its ``file_id``.
Tools receive input ``file_id``s and register their outputs through
:func:`FileStore.register_output`, which returns a new ``file_id`` the frontend
can download or feed into the next tool.
"""

from __future__ import annotations

import json
import mimetypes
import re
import shutil
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException, UploadFile

from .config import settings

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ \-()\[\]]+")


def sanitize_filename(name: str, default: str = "file") -> str:
    name = Path(name or default).name
    name = _SAFE_NAME.sub("_", name).strip(" .")
    return name or default


@dataclass
class StoredFile:
    file_id: str
    name: str
    size: int
    content_type: str
    created_at: float
    path: str  # absolute path on disk

    @property
    def fs_path(self) -> Path:
        return Path(self.path)


class FileStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or settings.data_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    # ---- internal helpers --------------------------------------------------
    def _dir(self, file_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", file_id or ""):
            raise HTTPException(status_code=400, detail="Invalid file id")
        return self.root / file_id

    def _meta_path(self, file_id: str) -> Path:
        return self._dir(file_id) / ".meta.json"

    def _write_meta(self, sf: StoredFile) -> None:
        self._meta_path(sf.file_id).write_text(json.dumps(asdict(sf)), encoding="utf-8")

    # ---- public API --------------------------------------------------------
    def new_id(self) -> str:
        return uuid.uuid4().hex

    def get(self, file_id: str) -> StoredFile:
        mp = self._meta_path(file_id)
        if not mp.exists():
            raise HTTPException(status_code=404, detail=f"File {file_id} not found")
        data = json.loads(mp.read_text(encoding="utf-8"))
        sf = StoredFile(**data)
        if not sf.fs_path.exists():
            raise HTTPException(status_code=404, detail=f"File {file_id} missing on disk")
        return sf

    def path(self, file_id: str) -> Path:
        """Absolute path of a stored file (raises 404 if unknown)."""
        return self.get(file_id).fs_path

    def exists(self, file_id: str) -> bool:
        try:
            self.get(file_id)
            return True
        except HTTPException:
            return False

    async def save_upload(self, upload: UploadFile) -> StoredFile:
        file_id = self.new_id()
        d = self._dir(file_id)
        d.mkdir(parents=True, exist_ok=False)
        name = sanitize_filename(upload.filename or "upload")
        target = d / name
        size = 0
        with target.open("wb") as out:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    out.close()
                    shutil.rmtree(d, ignore_errors=True)
                    raise HTTPException(status_code=413, detail="File too large")
                out.write(chunk)
        ctype = upload.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
        sf = StoredFile(file_id, name, size, ctype, time.time(), str(target))
        self._write_meta(sf)
        return sf

    def save_bytes(self, data: bytes, name: str, content_type: str | None = None) -> StoredFile:
        file_id = self.new_id()
        d = self._dir(file_id)
        d.mkdir(parents=True, exist_ok=False)
        name = sanitize_filename(name)
        target = d / name
        target.write_bytes(data)
        ctype = content_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
        sf = StoredFile(file_id, name, len(data), ctype, time.time(), str(target))
        self._write_meta(sf)
        return sf

    def save_stream(self, stream: BinaryIO, name: str, content_type: str | None = None) -> StoredFile:
        return self.save_bytes(stream.read(), name, content_type)

    def output_path(self, name: str) -> tuple[str, Path]:
        """Reserve a new file id and return (file_id, path) for a tool to write into.

        Call :meth:`register_output` once the file has been written.
        """
        file_id = self.new_id()
        d = self._dir(file_id)
        d.mkdir(parents=True, exist_ok=False)
        return file_id, d / sanitize_filename(name)

    def register_output(self, file_id: str, path: Path, content_type: str | None = None) -> StoredFile:
        path = Path(path)
        if not path.exists():
            raise RuntimeError(f"Output {path} was not written")
        ctype = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        sf = StoredFile(file_id, path.name, path.stat().st_size, ctype, time.time(), str(path))
        self._write_meta(sf)
        return sf

    def register_existing(self, path: Path, content_type: str | None = None) -> StoredFile:
        """Copy an arbitrary file (e.g. a temp file) into the store."""
        file_id, target = self.output_path(Path(path).name)
        shutil.copyfile(path, target)
        return self.register_output(file_id, target, content_type)

    def delete(self, file_id: str) -> None:
        shutil.rmtree(self._dir(file_id), ignore_errors=True)

    def sweep(self, ttl_seconds: int | None = None) -> int:
        """Delete files older than the TTL. Returns the number removed."""
        ttl = settings.file_ttl_seconds if ttl_seconds is None else ttl_seconds
        cutoff = time.time() - ttl
        removed = 0
        for d in self.root.iterdir():
            if not d.is_dir():
                continue
            try:
                if d.stat().st_mtime < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
                    removed += 1
            except OSError:
                pass
        return removed


store = FileStore()
