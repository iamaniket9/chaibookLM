"""Root-level entry point for Render deployment.

Render's start command is ``uvicorn main:app`` from the repo root.
The backend source lives in ``backend/`` and is designed to run with that
directory as the working directory.  This shim adds ``backend/`` to the
import path so that ``uvicorn main:app`` works from the repo root as well.
"""
import sys
import os

_backend_dir = os.path.join(os.path.dirname(__file__), "backend")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

# Now import the real FastAPI app from backend/main.py
from main import app  # noqa: E402  (import after sys.path manipulation)

__all__ = ["app"]
