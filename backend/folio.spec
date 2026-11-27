# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Folio backend sidecar (desktop app).

Build (from backend/):   python -m PyInstaller folio.spec --noconfirm
Output:                  dist/folio-server/folio-server[.exe]   (onedir: fast startup)

The desktop build script (desktop/scripts/build-backend.mjs) runs this with
--distpath ../desktop/build and --workpath ../desktop/build/pyinstaller-work.
"""

import sys

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_submodules,
    copy_metadata,
)

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"


def _safe(fn, *args, **kwargs):
    """Optional dependency helpers: a missing package must not break the build."""
    try:
        return fn(*args, **kwargs)
    except Exception as e:  # noqa: BLE001
        print(f"[folio.spec] skipped {fn.__name__}{args}: {e}")
        return []


def _no_tests(name: str) -> bool:
    return ".tests" not in name and ".test_" not in name and not name.endswith(".conftest")


hiddenimports: list[str] = []
datas: list = []

# The tool routers are discovered with pkgutil.iter_modules at runtime, which the static
# analysis cannot follow: list every app module explicitly.
hiddenimports += collect_submodules("app")

hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.dialects.sqlite.pysqlite",
    "multipart",
    "python_multipart",
    "logging.handlers",
    "logging.config",
]

# Data we never need: pymupdf's ONNX layout models (the engine itself is excluded below)
# and the MuPDF C headers/import libs.
DATA_EXCLUDES = {"pymupdf": ["layout/**", "mupdf-devel/**"]}

# PDF / Office libraries. Most are imported lazily inside the tool functions.
for pkg in [
    "pymupdf",
    "pymupdf4llm",
    "pdf2docx",
    "docx",
    "openpyxl",
    "pptx",
    "pdfplumber",
    "pdfminer",
    "pypdf",
    "pikepdf",
    "img2pdf",
    "markdown",
    "PIL",
    "pyhanko",
    "pyhanko_certvalidator",
    "cryptography",
    "pytesseract",
    "httpx",
]:
    hiddenimports += _safe(
        collect_submodules,
        pkg,
        filter=lambda n: _no_tests(n) and not n.startswith("pymupdf.layout"),
    )
    datas += _safe(collect_data_files, pkg, excludes=["**/tests/**", *DATA_EXCLUDES.get(pkg, [])])

# Packages that discover plugins through entry points need their dist metadata.
for dist in ["pyhanko", "pyhanko-certvalidator", "pymupdf4llm", "pdf2docx", "fastapi", "uvicorn"]:
    datas += _safe(copy_metadata, dist)

# OCRmyPDF (optional: pluggy plugins + metadata). Tesseract/Ghostscript stay external.
_ocr = _safe(collect_submodules, "ocrmypdf", filter=_no_tests)
if _ocr:
    hiddenimports += _ocr
    datas += _safe(collect_data_files, "ocrmypdf")
    datas += _safe(copy_metadata, "ocrmypdf")
    datas += _safe(copy_metadata, "pikepdf")

# WeasyPrint needs GTK/Pango, which is never present on stock Windows/macOS; the app
# already answers 501 when it is missing. On Linux it uses the system libraries.
excludes = [
    "tkinter",
    "_tkinter",
    "turtle",
    "idlelib",
    "matplotlib",
    "IPython",
    "jupyter",
    "notebook",
    "pytest",
    "_pytest",
    "pip",
    "PyInstaller",
    "test",
    "unittest.test",
    # pymupdf's optional ONNX layout engine (~80 MB with onnxruntime + networkx);
    # pymupdf4llm falls back to its classic engine when it is absent.
    "pymupdf.layout",
    "onnxruntime",
    "networkx",
]
if IS_WIN or IS_MAC:
    excludes += ["weasyprint", "cairocffi", "cairosvg", "tinycss2.tests"]
else:
    hiddenimports += _safe(collect_submodules, "weasyprint", filter=_no_tests)
    datas += _safe(collect_data_files, "weasyprint")

a = Analysis(
    ["folio_server.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)
# OpenCV (needed by pdf2docx) ships a ~40 MB FFmpeg DLL for video I/O we never use.
a.binaries = [b for b in a.binaries if "opencv_videoio_ffmpeg" not in b[0]]
a.datas = [d for d in a.datas if not d[0].replace("\\", "/").startswith(("pymupdf/layout/", "pymupdf/mupdf-devel/"))]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="folio-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # spawned hidden by Electron (windowsHide); stdout/stderr go to the app log
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="folio-server",
)
