from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

# Load env variables first, before importing routers that initialize API clients
load_dotenv()

from paths import UPLOAD_DIR
from database import engine, Base
import models
from routers import notebooks, sources, chat

# Create tables
Base.metadata.create_all(bind=engine)

# Run migrations for columns added after initial creation
from sqlalchemy import text, inspect as sa_inspect
with engine.connect() as conn:
    inspector = sa_inspect(conn)
    existing_cols = [c['name'] for c in inspector.get_columns('sources')]
    if 'error_message' not in existing_cols:
        conn.execute(text("ALTER TABLE sources ADD COLUMN error_message VARCHAR"))
        conn.commit()

app = FastAPI(title="ChaiBookLM API")

# Mount uploads directory so frontend can access PDFs
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Configure CORS for frontend
# allow_credentials=True is incompatible with allow_origins=["*"] per the CORS spec.
# The frontend uses API-key auth (not cookies), so credentials are unnecessary.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notebooks.router, prefix="/api/notebooks", tags=["Notebooks"])
app.include_router(sources.router, prefix="/api/sources", tags=["Sources"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])

@app.get("/")
def read_root():
    return {"message": "ChaiBookLM API is running"}
