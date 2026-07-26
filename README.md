# ChaiBookLM - AI Research Assistant

ChaiBookLM is an AI-powered research assistant inspired by NotebookLM. It allows users to upload multiple knowledge sources (PDFs, Web URLs, YouTube videos, Text, and VTT files), ask questions grounded in those sources, and receive answers with proper inline citations linking back to the original context.

## Architecture

This project is built using a modern decoupled architecture optimized for AI/RAG workflows:

- **Frontend:** React + Vite, styled with custom CSS Modules implementing a premium dark-mode, glassmorphism design.
- **Backend:** Python + FastAPI for asynchronous, high-performance API endpoints and streaming generation.
- **Database:** SQLite (via SQLAlchemy) for relational metadata (Notebooks, Sources).
- **Vector Store:** ChromaDB running locally to store and query document embeddings.
- **AI Models:** 
  - **Embeddings:** `all-MiniLM-L6-v2` via HuggingFace `sentence-transformers` (runs locally, free, very fast).
  - **Generation:** DeepSeek API via OpenAI-compatible endpoints.

## Retrieval Flow (RAG Pipeline)

1. **Ingestion:** When a user uploads a source, a background task parses it (e.g., extracting YouTube transcripts via `youtube-transcript-api` or parsing PDFs via `PyMuPDF`).
2. **Chunking & Metadata:** The text is chunked using semantic character limits. Crucially, metadata like `page_number`, `timestamp`, and `source_id` are attached to each chunk.
3. **Embedding:** Chunks are embedded locally and stored in ChromaDB within a collection specific to the notebook.
4. **Retrieval:** When a user asks a question, the query is embedded, and the top-K chunks are retrieved using vector similarity.
5. **Generation & Citation:** The chunks are passed to the DeepSeek LLM with a strict prompt to answer the question and emit inline citations (e.g., `[1]`). 
6. **Streaming & Inspection:** The response streams to the UI. The UI matches citation markers to the chunk metadata and provides an interactive Source Viewer pane (opening the PDF page, YouTube timestamp, or highlighting text).

## Environment Variables

Create a `.env` file in the `backend/` directory or set the following environment variable in your terminal:

```bash
# Required for DeepSeek API LLM generation
DEEPSEEK_API_KEY=your_deepseek_api_key_here
```

## Setup & Running Locally

### 1. Backend Setup

```bash
cd backend
python -m venv venv
# Activate virtual environment
# Windows: venv\Scripts\activate
# Mac/Linux: source venv/bin/activate

pip install -r requirements.txt

# Run the FastAPI server
uvicorn main:app --reload
```
The backend will run at `http://localhost:8000`. Swagger UI is available at `http://localhost:8000/docs`.

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```
The frontend will run at `http://localhost:5173`.

## Deployment (Vercel)

Since Vercel uses a serverless, read-only filesystem, the backend (SQLite, ChromaDB) cannot be hosted directly on Vercel without migrating to a cloud database (e.g., Supabase Postgres + pgvector).

**Recommended approach for this architecture:**
1. Deploy the `frontend/` directory to **Vercel**.
2. Deploy the `backend/` directory to **Render**, **Railway**, or **Fly.io** with a persistent disk attached (to store `./data/chroma` and `./data/chaibook.db`). Update the frontend's API URL to point to the hosted backend.
