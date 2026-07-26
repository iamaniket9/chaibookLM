"""Canonical locations for everything the app persists to disk.

Two rules live here so the rest of the codebase doesn't have to think about them:

1. Paths resolve relative to *this file*, not the process working directory, so
   the server behaves the same whether it's launched from `backend/`, the repo
   root, or a process manager with an unrelated CWD.
2. Importing this module guarantees the directories exist. Nothing else has to
   remember to call `makedirs` before opening the database or the vector store.

Set the DATA_DIR environment variable to relocate all state (useful when a host
mounts a persistent disk somewhere specific).
"""
import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_DIR = os.path.abspath(os.environ.get("DATA_DIR") or os.path.join(BACKEND_DIR, "data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
CHROMA_DIR = os.path.join(DATA_DIR, "chroma")
DB_PATH = os.path.join(DATA_DIR, "chaibook.db")

for _directory in (DATA_DIR, UPLOAD_DIR, CHROMA_DIR):
    os.makedirs(_directory, exist_ok=True)


def is_managed_upload(path: str) -> bool:
    """True if `path` points at a file we created inside UPLOAD_DIR.

    Used before deleting files on disk. Older rows stored CWD-relative paths
    like `./data/uploads/1_foo.pdf`, so the check resolves the path first and
    then tests containment rather than comparing prefixes as strings.
    """
    if not path:
        return False
    resolved = os.path.abspath(path)
    return os.path.commonpath([resolved, UPLOAD_DIR]) == UPLOAD_DIR
