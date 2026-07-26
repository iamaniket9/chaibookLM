from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from services.rag import stream_rag_response
from database import get_db
import models

router = APIRouter()


class HistoryEntry(BaseModel):
    role: str
    content: str


class QueryRequest(BaseModel):
    query: str
    history: Optional[List[HistoryEntry]] = None

@router.post("/{notebook_id}")
async def query_notebook(notebook_id: int, request: QueryRequest):
    return StreamingResponse(
        stream_rag_response(notebook_id, request.query, request.history),
        media_type="text/event-stream"
    )
