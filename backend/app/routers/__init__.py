"""Router discovery.

``app.routers.files`` is the core API. Every module in ``app.tools`` that
exposes a module-level ``router`` (an ``APIRouter``) is auto-registered, so
adding a tool means adding one file — nothing else to wire up.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil

from fastapi import APIRouter, FastAPI

from . import files

log = logging.getLogger("folio")


def register_all(app: FastAPI) -> list[str]:
    app.include_router(files.router)
    registered = ["files"]

    from .. import tools as tools_pkg

    for mod_info in pkgutil.iter_modules(tools_pkg.__path__):
        if mod_info.name.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f"{tools_pkg.__name__}.{mod_info.name}")
        except Exception as e:  # noqa: BLE001 - a broken optional dependency must not take the API down
            log.warning("Tool module %s failed to import and was skipped: %s", mod_info.name, e)
            continue
        router = getattr(mod, "router", None)
        if isinstance(router, APIRouter):
            app.include_router(router)
            registered.append(mod_info.name)
    return registered
