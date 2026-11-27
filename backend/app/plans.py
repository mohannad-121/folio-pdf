"""Plans, limits and the tool -> minimum-tier map. Single source of truth for pricing and gating.

``GET /api/plans`` exposes everything here so the frontend can render the pricing page and
lock badges without duplicating any of it.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter

from .config import settings

Tier = Literal["free", "plus", "pro", "max"]
TIERS: tuple[Tier, ...] = ("free", "plus", "pro", "max")
TIER_NAMES: dict[str, str] = {"free": "Free", "plus": "Plus", "pro": "Pro", "max": "Max"}


def tier_rank(tier: str) -> int:
    try:
        return TIERS.index(tier)  # type: ignore[arg-type]
    except ValueError:
        return 0


def max_tier(*tiers: str) -> Tier:
    return max(tiers, key=tier_rank, default="free")  # type: ignore[return-value]


def tier_at_least(tier: str, required: str) -> bool:
    return tier_rank(tier) >= tier_rank(required)


def available_on(tier: str) -> str:
    """'Pro and Max', 'Plus, Pro and Max', 'Max'."""
    names = [TIER_NAMES[t] for t in TIERS[tier_rank(tier):] if t != "free"] or ["Max"]
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


# ---- limits -------------------------------------------------------------------------------

LIMITS: dict[str, dict] = {
    "free": {
        "max_file_mb": 10,
        "daily_tasks": 5,
        "max_files_per_task": 3,
        "batch": False,
        "api_access": False,
        "team_seats": 1,
        "priority_processing": False,
    },
    "plus": {
        "max_file_mb": 50,
        "daily_tasks": None,
        "max_files_per_task": None,
        "batch": False,
        "api_access": False,
        "team_seats": 1,
        "priority_processing": False,
    },
    "pro": {
        "max_file_mb": 200,
        "daily_tasks": None,
        "max_files_per_task": None,
        "batch": True,
        "api_access": False,
        "team_seats": 1,
        "priority_processing": False,
    },
    "max": {
        "max_file_mb": 1024,
        "daily_tasks": None,
        "max_files_per_task": None,
        "batch": True,
        "api_access": True,
        "team_seats": 5,
        "priority_processing": True,
    },
}

PRICES: dict[str, dict[str, float]] = {
    "free": {"monthly": 0, "yearly": 0},
    "plus": {"monthly": 5, "yearly": 48},
    "pro": {"monthly": 12, "yearly": 108},
    "max": {"monthly": 24, "yearly": 216},
}

TAGLINES = {
    "free": "Everyday PDF essentials, no account needed.",
    "plus": "Every converter and editor, without the daily cap.",
    "pro": "OCR, redaction and digital signatures for serious paperwork.",
    "max": "Huge files, API access and priority processing for power users and teams.",
}

FEATURES: dict[str, list[str]] = {
    "free": [
        "View, annotate and highlight PDFs right in your browser",
        "Merge, split, rotate, reorder, extract and delete pages",
        "Convert PDF to text and Markdown, or text to PDF",
        "Light compression, word count and document inspector",
        "5 tasks per day, files up to 10 MB, up to 3 files per merge",
    ],
    "plus": [
        "Everything in Free, with unlimited daily tasks",
        "Full editor: edit text, images and links, crop and resize pages",
        "Word, Excel, PowerPoint, HTML and images to PDF, and back again",
        "Strong compression, repair, flatten, grayscale and web-optimize",
        "Watermarks, page numbers, headers and footers, bookmarks and metadata",
        "Password-protect, unlock and sanitize documents",
        "Fill forms and sign with a drawn or typed signature",
        "Files up to 50 MB",
    ],
    "pro": [
        "Everything in Plus",
        "OCR: turn scans into searchable, selectable PDFs in dozens of languages",
        "True redaction that permanently removes sensitive content",
        "Certificate-based digital signatures and PDF/A archiving",
        "Compare two versions side by side and check accessibility",
        "Build fillable forms, then export and import form data",
        "Batch processing: run a tool on many files at once",
        "Files up to 200 MB",
    ],
    "max": [
        "Everything in Pro",
        "REST API access with personal API keys",
        "Files up to 1 GB",
        "Priority processing queue",
        "Team workspace with 5 seats (coming soon)",
        "Priority email support",
    ],
}


# ---- tools ---------------------------------------------------------------------------------

# Minimum tier per tool id. Ids match frontend/src/lib/tools.ts where a tool exists there; extra
# ids cover endpoints the catalog does not list as standalone tools.
TOOL_TIERS: dict[str, Tier] = {
    # free
    "view": "free",
    "merge": "free",
    "split": "free",
    "extract-pages": "free",
    "delete-pages": "free",
    "rotate": "free",
    "organize": "free",
    "pdf-to-text": "free",
    "pdf-to-markdown": "free",
    "text-to-pdf": "free",
    "compress": "free",  # level "low" only; see COMPRESS_LEVEL_TIERS
    "word-count": "free",
    "inspect": "free",
    "ocr-detect": "free",
    # plus
    "insert-pages": "plus",
    "replace-pages": "plus",
    "duplicate-pages": "plus",
    "n-up": "plus",
    "booklet": "plus",
    "crop": "plus",
    "page-size": "plus",
    "word-to-pdf": "plus",
    "excel-to-pdf": "plus",
    "powerpoint-to-pdf": "plus",
    "office-to-pdf": "plus",
    "any-to-pdf": "plus",
    "images-to-pdf": "plus",
    "html-to-pdf": "plus",
    "pdf-to-word": "plus",
    "pdf-to-excel": "plus",
    "pdf-to-powerpoint": "plus",
    "pdf-to-jpg": "plus",
    "pdf-to-png": "plus",
    "pdf-to-html": "plus",
    "edit": "plus",
    "watermark": "plus",
    "page-numbers": "plus",
    "header-footer": "plus",
    "background": "plus",
    "metadata": "plus",
    "bookmarks": "plus",
    "repair": "plus",
    "flatten": "plus",
    "grayscale": "plus",
    "linearize": "plus",
    "remove-blank-pages": "plus",
    "protect": "plus",
    "unlock": "plus",
    "sanitize": "plus",
    "sign": "plus",
    "stamp": "plus",
    "fill-form": "plus",
    "verify-signatures": "plus",
    "remove-annotations": "plus",
    "flatten-annotations": "plus",
    "extract-attachments": "plus",
    "measure": "plus",
    # pro
    "ocr": "pro",
    "scan-to-pdf": "pro",
    "redact": "pro",
    "compare": "pro",
    "accessibility": "pro",
    "create-form": "pro",
    "form-data": "pro",
    "digital-sign": "pro",
    "pdf-to-pdfa": "pro",
    # max
    "api": "max",
}

TOOL_LABELS: dict[str, str] = {
    "ocr": "OCR",
    "ocr-detect": "Scan detection",
    "scan-to-pdf": "Scan to PDF",
    "redact": "Redaction",
    "compare": "Compare PDFs",
    "accessibility": "Accessibility check",
    "create-form": "Form creation",
    "form-data": "Form data import/export",
    "digital-sign": "Digital signatures",
    "pdf-to-pdfa": "PDF/A conversion",
    "pdf-to-word": "PDF to Word",
    "pdf-to-excel": "PDF to Excel",
    "pdf-to-powerpoint": "PDF to PowerPoint",
    "pdf-to-jpg": "PDF to image",
    "pdf-to-png": "PDF to PNG",
    "pdf-to-html": "PDF to HTML",
    "pdf-to-text": "PDF to text",
    "pdf-to-markdown": "PDF to Markdown",
    "word-to-pdf": "Word to PDF",
    "excel-to-pdf": "Excel to PDF",
    "powerpoint-to-pdf": "PowerPoint to PDF",
    "office-to-pdf": "Office to PDF",
    "any-to-pdf": "Convert to PDF",
    "images-to-pdf": "Images to PDF",
    "html-to-pdf": "HTML to PDF",
    "text-to-pdf": "Text to PDF",
    "edit": "Editing PDF content",
    "api": "API access",
    "batch": "Batch processing",
    "max_files_per_task": "Combining more than 3 files",
    "compress": "Stronger compression",
    "n-up": "N-up layout",
    "page-size": "Page resizing",
}


def tool_label(tool: str) -> str:
    return TOOL_LABELS.get(tool) or tool.replace("-", " ").replace("_", " ").capitalize()


# Endpoint -> tool id. Keys are (method, route path template) exactly as FastAPI registers them.
ROUTE_TOOLS: dict[tuple[str, str], str] = {
    # organize
    ("POST", "/api/organize/merge"): "merge",
    ("POST", "/api/organize/split"): "split",
    ("POST", "/api/organize/extract"): "extract-pages",
    ("POST", "/api/organize/delete"): "delete-pages",
    ("POST", "/api/organize/rotate"): "rotate",
    ("POST", "/api/organize/reorder"): "organize",
    ("POST", "/api/organize/insert"): "insert-pages",
    ("POST", "/api/organize/replace"): "replace-pages",
    ("POST", "/api/organize/duplicate"): "duplicate-pages",
    ("POST", "/api/organize/n-up"): "n-up",
    ("POST", "/api/organize/booklet"): "booklet",
    # convert
    ("POST", "/api/convert/pdf-to-docx"): "pdf-to-word",
    ("POST", "/api/convert/pdf-to-xlsx"): "pdf-to-excel",
    ("POST", "/api/convert/pdf-to-pptx"): "pdf-to-powerpoint",
    ("POST", "/api/convert/pdf-to-images"): "pdf-to-jpg",
    ("POST", "/api/convert/pdf-to-html"): "pdf-to-html",
    ("POST", "/api/convert/pdf-to-text"): "pdf-to-text",
    ("POST", "/api/convert/pdf-to-markdown"): "pdf-to-markdown",
    ("POST", "/api/convert/pdf-to-pdfa"): "pdf-to-pdfa",
    ("POST", "/api/convert/office-to-pdf"): "office-to-pdf",
    ("POST", "/api/convert/word-to-pdf"): "word-to-pdf",
    ("POST", "/api/convert/excel-to-pdf"): "excel-to-pdf",
    ("POST", "/api/convert/powerpoint-to-pdf"): "powerpoint-to-pdf",
    ("POST", "/api/convert/images-to-pdf"): "images-to-pdf",
    ("POST", "/api/convert/html-to-pdf"): "html-to-pdf",
    ("POST", "/api/convert/text-to-pdf"): "text-to-pdf",
    ("POST", "/api/convert/any-to-pdf"): "any-to-pdf",
    # edit
    ("POST", "/api/edit/apply"): "edit",  # gated per op, see OP_TIERS
    ("POST", "/api/edit/watermark"): "watermark",
    ("POST", "/api/edit/page-numbers"): "page-numbers",
    ("POST", "/api/edit/header-footer"): "header-footer",
    ("POST", "/api/edit/background"): "background",
    ("POST", "/api/edit/metadata"): "metadata",
    ("POST", "/api/edit/bookmarks"): "bookmarks",
    ("POST", "/api/edit/crop"): "crop",
    ("POST", "/api/edit/resize"): "page-size",
    ("POST", "/api/edit/remove-annotations"): "remove-annotations",
    ("POST", "/api/edit/flatten-annotations"): "flatten-annotations",
    # forms
    ("POST", "/api/forms/fill"): "fill-form",
    ("POST", "/api/forms/flatten"): "fill-form",
    ("POST", "/api/forms/add-fields"): "create-form",
    ("POST", "/api/forms/remove-fields"): "create-form",
    ("POST", "/api/forms/export"): "form-data",
    ("POST", "/api/forms/import"): "form-data",
    # ocr
    ("POST", "/api/ocr/pdf"): "ocr",
    ("POST", "/api/ocr/scan-to-pdf"): "scan-to-pdf",
    ("POST", "/api/ocr/extract-text"): "ocr",
    ("POST", "/api/ocr/detect"): "ocr-detect",
    # optimize
    ("POST", "/api/optimize/compress"): "compress",  # gated per level, see COMPRESS_LEVEL_TIERS
    ("POST", "/api/optimize/repair"): "repair",
    ("POST", "/api/optimize/flatten"): "flatten",
    ("POST", "/api/optimize/grayscale"): "grayscale",
    ("POST", "/api/optimize/linearize"): "linearize",
    ("POST", "/api/optimize/remove-blank-pages"): "remove-blank-pages",
    # review
    ("POST", "/api/review/compare"): "compare",
    ("POST", "/api/review/accessibility"): "accessibility",
    ("POST", "/api/review/inspect"): "inspect",
    ("POST", "/api/review/word-count"): "word-count",
    ("POST", "/api/review/extract-attachments"): "extract-attachments",
    ("POST", "/api/review/measure"): "measure",
    # security
    ("POST", "/api/security/protect"): "protect",
    ("POST", "/api/security/unlock"): "unlock",
    ("POST", "/api/security/redact"): "redact",
    ("GET", "/api/security/redact/preview/{file_id}"): "redact",
    ("POST", "/api/security/sanitize"): "sanitize",
    # sign
    ("POST", "/api/sign/signature-image"): "sign",
    ("POST", "/api/sign/stamp"): "sign",
    ("GET", "/api/sign/fonts"): "sign",
    ("POST", "/api/sign/self-signed-cert"): "digital-sign",
    ("POST", "/api/sign/digital"): "digital-sign",
    ("POST", "/api/sign/verify"): "verify-signatures",
}

# Tool endpoints whose POSTs are helpers and do not count toward the daily task quota.
NON_TASK_TOOLS: set[str] = {"ocr-detect"}

# Tools that legitimately take several inputs; ``max_files_per_task`` applies to them and the
# batch rule does not.
MULTI_INPUT_TOOLS: set[str] = {"merge", "images-to-pdf", "scan-to-pdf", "compare"}
FILES_PER_TASK_TOOLS: set[str] = {"merge", "images-to-pdf", "scan-to-pdf"}

# Any POST under these areas must be mapped above (enforced by a test).
GATED_AREAS = ("organize", "optimize", "security", "convert", "ocr", "edit", "forms", "sign", "review")
DEFAULT_TOOL_TIER: Tier = "plus"  # unmapped tool POSTs are paid by default

COMPRESS_LEVEL_TIERS: dict[str, Tier] = {"low": "free", "medium": "plus", "high": "plus", "extreme": "plus"}
COMPRESS_DEFAULT_LEVEL = "medium"  # the endpoint's default when ``level`` is omitted

ANNOTATION_OPS = (
    "highlight", "underline", "strikeout", "squiggly", "ink", "rect", "ellipse", "line", "arrow",
    "polygon", "polyline", "note", "freetext", "delete_annot", "update_annot",
)
OP_TIERS: dict[str, Tier] = {
    **{op: "free" for op in ANNOTATION_OPS},
    "text": "plus",
    "image": "plus",
    "signature": "plus",
    "stamp": "plus",
    "delete_image": "plus",
    "replace_image": "plus",
    "link": "plus",
    "delete_link": "plus",
    "replace_text": "plus",
    "rotate_page": "plus",
    "delete_page": "plus",
    "insert_blank_page": "plus",
    "move_page": "plus",
    "reorder_pages": "free",  # same as the free Organize tool
    "form_value": "plus",
    "crop_page": "plus",
    "set_metadata": "plus",
    "redact": "pro",
    "erase": "pro",
}
DEFAULT_OP_TIER: Tier = "plus"

OP_LABELS = {
    "redact": "Redaction",
    "erase": "Erasing content",
    "text": "Adding text",
    "replace_text": "Editing existing text",
    "image": "Adding images",
    "signature": "Adding signatures",
    "stamp": "Adding stamps",
    "form_value": "Filling forms",
}


def op_tier(op: str) -> Tier:
    return OP_TIERS.get(op, DEFAULT_OP_TIER)


def tool_tier(tool: str) -> Tier:
    return TOOL_TIERS.get(tool, DEFAULT_TOOL_TIER)


def route_tool(method: str, path: str) -> str | None:
    """Tool id for an endpoint, or None if the endpoint is not a gated tool."""
    tool = ROUTE_TOOLS.get((method.upper(), path))
    if tool:
        return tool
    if method.upper() == "POST":
        parts = path.strip("/").split("/")
        if len(parts) >= 3 and parts[0] == "api" and parts[1] in GATED_AREAS:
            return path  # unmapped tool endpoint: gated at DEFAULT_TOOL_TIER
    return None


def limits_for(tier: str) -> dict:
    return dict(LIMITS.get(tier, LIMITS["free"]))


def unlocked_limits() -> dict:
    """Limits reported when billing is disabled (self-hosted): everything unlocked."""
    lim = limits_for("max")
    lim["max_file_mb"] = settings.max_upload_bytes // (1024 * 1024)
    return lim


def next_tier(tier: str) -> Tier | None:
    i = tier_rank(tier)
    return TIERS[i + 1] if i + 1 < len(TIERS) else None


def tier_for_file_mb(size_mb: float) -> Tier | None:
    for t in TIERS:
        if LIMITS[t]["max_file_mb"] >= size_mb:
            return t
    return None


# ---- API ----------------------------------------------------------------------------------

router = APIRouter(prefix="/api", tags=["plans"])


@router.get("/plans")
def get_plans():
    tiers = []
    for t in TIERS:
        tiers.append(
            {
                "id": t,
                "name": TIER_NAMES[t],
                "tagline": TAGLINES[t],
                "price_monthly": PRICES[t]["monthly"],
                "price_yearly": PRICES[t]["yearly"],
                "trial_days": 0 if t == "free" else settings.trial_days,
                "highlight": t == "pro",
                "limits": limits_for(t),
                "features": FEATURES[t],
            }
        )
    tool_tiers = {k: v for k, v in TOOL_TIERS.items() if k != "api"}
    return {
        "tiers": tiers,
        "tool_tiers": tool_tiers,
        "op_tiers": dict(OP_TIERS),
        # Extras beyond the core contract: per-level compress gating and the batch rule.
        "compress_level_tiers": dict(COMPRESS_LEVEL_TIERS),
        "batch_tier": "pro",
    }
