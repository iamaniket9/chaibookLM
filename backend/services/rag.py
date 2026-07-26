import os
from openai import AsyncOpenAI
from services.vector_store import hybrid_search_chunks
import json

# Initialize OpenAI client pointing to DeepSeek
client = AsyncOpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY", "your-deepseek-api-key"),
    base_url="https://api.deepseek.com/v1"
)

async def stream_rag_response(notebook_id: int, query: str, history=None):
    """
    1. Retrieve chunks
    2. Build prompt with citations and conversation history
    3. Stream LLM response
    """
    # 1. Retrieve — hybrid search (semantic + keyword) for better relevance
    chunks = hybrid_search_chunks(notebook_id, query, top_k=10)

    if not chunks:
        yield "data: " + json.dumps({"type": "message", "content": "I couldn't find any information about that in this notebook's sources."}) + "\n\n"
        yield "data: [DONE]\n\n"
        return

    # Build context and metadata map
    context_text = ""
    citation_map = {} # Maps chunk index (1-based) to its metadata

    for i, chunk in enumerate(chunks):
        citation_id = i + 1
        meta = chunk.get("metadata", {})

        # Normalize metadata: ChromaDB may return all values as strings
        # Ensure critical fields are present and correctly typed
        normalized_meta = {
            "type": str(meta.get("type", "")),
            "source_id": meta.get("source_id", ""),
        }

        # YouTube-specific fields
        if "video_id" in meta:
            normalized_meta["video_id"] = str(meta["video_id"])
        if "timestamp" in meta:
            try:
                normalized_meta["timestamp"] = int(float(meta["timestamp"]))
            except (ValueError, TypeError):
                normalized_meta["timestamp"] = 0

        # PDF-specific fields
        if "page" in meta:
            try:
                normalized_meta["page"] = int(float(meta["page"]))
            except (ValueError, TypeError):
                normalized_meta["page"] = 1
        if "filename" in meta:
            normalized_meta["filename"] = str(meta["filename"])

        # Web-specific fields
        if "url" in meta:
            normalized_meta["url"] = str(meta["url"])

        # Build a context label that includes timestamp/page so the LLM can
        # tell the user *when* or *where* the information was discussed
        source_label = f"--- Source [{citation_id}]"

        if normalized_meta.get("timestamp") and normalized_meta.get("video_id"):
            ts = normalized_meta["timestamp"]
            hours = ts // 3600
            minutes = (ts % 3600) // 60
            seconds = ts % 60
            if hours > 0:
                source_label += f" (YouTube @ {hours}:{minutes:02d}:{seconds:02d})"
            else:
                source_label += f" (YouTube @ {minutes}:{seconds:02d})"
        elif normalized_meta.get("page") and normalized_meta.get("filename"):
            source_label += f" (PDF page {normalized_meta['page']})"

        source_label += " ---"

        citation_map[citation_id] = normalized_meta
        context_text += f"\n{source_label}\n{chunk['text']}\n"

    # Send citation map to frontend first
    yield "data: " + json.dumps({"type": "citations", "citations": citation_map}) + "\n\n"

    # 2. Build messages list
    system_prompt = f"""You are an AI research assistant. Answer the user's question based ONLY on the provided context.
If the answer is not contained within the context, say "I don't know based on the provided sources."

Context:
{context_text}

IMPORTANT INSTRUCTIONS:
- You MUST cite your sources using inline brackets, e.g. [1], [2].
- Put the citation exactly after the sentence or fact it supports.
- Do not add a references section at the end. The UI will handle displaying citations.
- Use the conversation history (if provided) to understand follow-up questions in context.
- When a source shows a timestamp (e.g. "YouTube @ 2:34"), mention it in your answer so the user knows exactly when it was discussed (e.g. "...as discussed at 2:34 in the video [1].").
"""

    # Build message list with optional conversation history
    messages = [{"role": "system", "content": system_prompt}]

    # Include the last few exchanges so the LLM understands follow-up questions
    if history:
        for entry in history:
            role = entry.role if hasattr(entry, 'role') else entry.get('role', 'user')
            content = entry.content if hasattr(entry, 'content') else entry.get('content', '')
            # Map 'assistant' → 'assistant' (both use the same name)
            if role in ('user', 'assistant'):
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": query})

    # 3. Stream LLM Response
    try:
        response = await client.chat.completions.create(
            model="deepseek-v4-pro",
            messages=messages,
            stream=True,
            temperature=0.2
        )

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content is not None:
                content = chunk.choices[0].delta.content
                yield "data: " + json.dumps({"type": "message", "content": content}) + "\n\n"

        yield "data: [DONE]\n\n"
    except Exception as e:
        yield "data: " + json.dumps({"type": "message", "content": f"\n\n**Error reaching DeepSeek API:** {str(e)}"}) + "\n\n"
        yield "data: [DONE]\n\n"
