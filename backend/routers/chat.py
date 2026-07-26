import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional

from database import SessionLocal, get_db
from services.rag import stream_rag_response
import models

router = APIRouter()

# Proxies (Render, nginx, Cloudflare) buffer responses by default, which turns a
# token-by-token stream into one delayed blob. These headers opt out.
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

# Cap on how much conversation history a client may replay into the prompt.
MAX_HISTORY_ENTRIES = 10


class HistoryEntry(BaseModel):
    role: str
    content: str


class QueryRequest(BaseModel):
    query: str
    history: Optional[List[HistoryEntry]] = None


class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    citations: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


def _persist_exchange(notebook_id: int, query: str, answer: str, citations: Optional[dict]):
    """Store one user/assistant turn pair.

    Uses its own session rather than the request's: the request-scoped session
    may already be closed by the time a streaming response finishes.
    """
    db = SessionLocal()
    try:
        db.add(models.Message(notebook_id=notebook_id, role="user", content=query))
        db.add(models.Message(
            notebook_id=notebook_id,
            role="assistant",
            content=answer,
            citations=json.dumps(citations) if citations else None,
        ))
        db.commit()
    except Exception as e:
        print(f"Failed to persist chat exchange for notebook {notebook_id}: {e}")
    finally:
        db.close()


async def _sse_stream(notebook_id: int, query: str, history):
    """Frame RAG events as SSE, accumulating the answer so it can be saved.

    The persist step sits in a `finally` so an answer the user aborted halfway
    through is still kept — matching what they can see on screen.
    """
    answer_parts: List[str] = []
    citations: Optional[dict] = None
    try:
        async for event in stream_rag_response(notebook_id, query, history):
            if event["type"] == "citations":
                citations = event["citations"]
            elif event["type"] == "message":
                answer_parts.append(event["content"])
            yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"
    finally:
        answer = "".join(answer_parts)
        if answer.strip():
            _persist_exchange(notebook_id, query, answer, citations)


@router.post("/{notebook_id}")
async def query_notebook(notebook_id: int, request: QueryRequest, db: Session = Depends(get_db)):
    if not db.query(models.Notebook).filter(models.Notebook.id == notebook_id).first():
        raise HTTPException(status_code=404, detail="Notebook not found")

    if not request.query.strip():
        raise HTTPException(status_code=422, detail="Query must not be empty")

    history = (request.history or [])[-MAX_HISTORY_ENTRIES:]

    return StreamingResponse(
        _sse_stream(notebook_id, request.query, history),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.get("/{notebook_id}/history", response_model=List[MessageResponse])
def get_history(notebook_id: int, db: Session = Depends(get_db)):
    """Return this notebook's chat in chronological order."""
    messages = (
        db.query(models.Message)
        .filter(models.Message.notebook_id == notebook_id)
        .order_by(models.Message.id)
        .all()
    )

    return [
        MessageResponse(
            id=m.id,
            role=m.role,
            content=m.content or "",
            citations=json.loads(m.citations) if m.citations else None,
        )
        for m in messages
    ]


@router.delete("/{notebook_id}/history")
def clear_history(notebook_id: int, db: Session = Depends(get_db)):
    deleted = (
        db.query(models.Message)
        .filter(models.Message.notebook_id == notebook_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}
