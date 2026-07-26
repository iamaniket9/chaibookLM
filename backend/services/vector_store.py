import chromadb
from sentence_transformers import SentenceTransformer
import os
import re

# Initialize ChromaDB client (local persistent)
CHROMA_DATA_PATH = "./data/chroma"
chroma_client = chromadb.PersistentClient(path=CHROMA_DATA_PATH)

# Initialize HuggingFace embeddings (runs locally, no API key needed)
# all-MiniLM-L6-v2 is fast and good enough for general RAG
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

# Common English stop words — stripped from keyword match to avoid noise
_STOP_WORDS = frozenset({
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'i', 'you', 'he', 'she',
    'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
    'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
    'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
    'at', 'in', 'on', 'of', 'to', 'for', 'with', 'about', 'and', 'or',
    'not', 'no', 'but', 'if', 'then', 'else', 'this', 'that', 'these',
    'those', 'just', 'so', 'very', 'really', 'only', 'also', 'too',
    'all', 'some', 'any', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'such', 'than', 'time',
})


def _query_keywords(query: str) -> set[str]:
    """Extract meaningful lowercase keywords from a query, skipping stop words."""
    tokens = re.findall(r'[a-zA-Z0-9]+', query.lower())
    return {t for t in tokens if t not in _STOP_WORDS and len(t) > 1}


def get_collection(notebook_id: int):
    """Get or create a ChromaDB collection for a specific notebook."""
    collection_name = f"notebook_{notebook_id}"
    return chroma_client.get_or_create_collection(name=collection_name)


def add_chunks_to_vector_store(notebook_id: int, source_id: int, chunks: list[dict]):
    """
    chunks format:
    [
        {"text": "...", "metadata": {"page": 1, "source_id": 1, "type": "pdf"}},
        ...
    ]
    """
    if not chunks:
        return

    collection = get_collection(notebook_id)

    texts = [chunk["text"] for chunk in chunks]
    metadatas = [chunk["metadata"] for chunk in chunks]
    # Ensure source_id is in metadata for all chunks
    for meta in metadatas:
        meta["source_id"] = source_id

    ids = [f"source_{source_id}_chunk_{i}" for i in range(len(chunks))]

    # Generate embeddings
    embeddings = embedding_model.encode(texts).tolist()

    # Add to Chroma
    collection.add(
        documents=texts,
        embeddings=embeddings,
        metadatas=metadatas,
        ids=ids
    )


def search_chunks(notebook_id: int, query: str, top_k: int = 5):
    """Search for relevant chunks in a notebook's collection."""
    collection = get_collection(notebook_id)

    if collection.count() == 0:
        return []

    query_embedding = embedding_model.encode([query]).tolist()[0]

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k
    )

    # Format results
    retrieved_chunks = []
    if results['documents'] and results['documents'][0]:
        for i in range(len(results['documents'][0])):
            retrieved_chunks.append({
                "text": results['documents'][0][i],
                "metadata": results['metadatas'][0][i] if results['metadatas'] else {},
                "distance": results['distances'][0][i] if 'distances' in results else 0
            })

    return retrieved_chunks


def hybrid_search_chunks(notebook_id: int, query: str, top_k: int = 10):
    """Hybrid search: semantic + keyword re-ranking.

    Fetches extra candidates from semantic search, then boosts chunks that
    explicitly contain the query keywords.  This prevents the "mentioned in
    passing but never explained" problem where pure embedding similarity
    ranks a shallow mention above a deep discussion of the same entity.
    """
    collection = get_collection(notebook_id)

    if collection.count() == 0:
        return []

    # Pull more candidates from semantic search so we have room to re-rank
    candidates = search_chunks(notebook_id, query, top_k=top_k * 3)
    if not candidates:
        return []

    keywords = _query_keywords(query)

    # Without meaningful keywords, fall back to pure semantic results
    if not keywords:
        return candidates[:top_k]

    # Score each candidate: semantic closeness + keyword hit bonus
    scored = []
    for chunk in candidates:
        text_lower = chunk["text"].lower()
        kw_hits = sum(1 for kw in keywords if kw in text_lower)
        # distance is lower-is-better; invert so higher score = better
        distance = chunk.get("distance", 1.0)
        semantic_score = 1.0 / (1.0 + distance)
        # Blend: 60 % semantic, 40 % keyword-match bonus
        combined = semantic_score * 0.6 + (kw_hits / max(len(keywords), 1)) * 0.4
        scored.append((combined, chunk))

    # Sort descending (higher combined score first)
    scored.sort(key=lambda x: x[0], reverse=True)

    return [chunk for _, chunk in scored[:top_k]]


def delete_source_chunks(notebook_id: int, source_id: int):
    """Delete all chunks for a specific source."""
    collection = get_collection(notebook_id)
    collection.delete(
        where={"source_id": source_id}
    )
