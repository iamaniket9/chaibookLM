FROM python:3.11-slim AS builder
WORKDIR /app

# Install build deps needed for chromadb/hnswlib, then remove after
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
# --no-cache-dir keeps pip cache out; --prefix isolates packages
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Final image ──────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# Only copy what's needed from builder (no build tools in final image)
COPY --from=builder /install /usr/local

# Copy only the Python source — venv/data/__pycache__ are excluded by .dockerignore
COPY backend/ .

# Clean up any stray __pycache__ that snuck through
RUN find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null; \
    find . -type f -name "*.pyc" -delete 2>/dev/null; \
    true

# Ensure data dir exists (Render mounts a volume here or the app creates it at runtime)
RUN mkdir -p /app/data/uploads /app/data/chroma

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
