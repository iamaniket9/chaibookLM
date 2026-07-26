import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from database import get_db
import models
from services.ingestion import extract_pdf, extract_text, extract_web, extract_youtube, extract_vtt
from services.vector_store import add_chunks_to_vector_store, delete_source_chunks

router = APIRouter()

UPLOAD_DIR = "./data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def process_source_background(source_id: int, notebook_id: int, file_path: str, url: str, source_type: str):
    # Create a fresh DB session for this background task
    from database import SessionLocal
    db = SessionLocal()
    try:
        db_source = db.query(models.Source).filter(models.Source.id == source_id).first()
        if not db_source:
            print(f"Source {source_id} not found")
            return
        db_source.status = models.SourceStatus.INDEXING
        db.commit()

        chunks = []
        if source_type == models.SourceType.PDF:
            chunks = extract_pdf(file_path)
            # Add filename to metadata so UI can render the PDF
            filename = os.path.basename(file_path)
            for c in chunks:
                c["metadata"]["filename"] = filename
        elif source_type == models.SourceType.TEXT:
            chunks = extract_text(file_path)
        elif source_type == models.SourceType.WEB:
            chunks = extract_web(url)
        elif source_type == models.SourceType.YOUTUBE:
            chunks = extract_youtube(url)
        elif source_type == models.SourceType.VTT:
            chunks = extract_vtt(file_path)

        add_chunks_to_vector_store(notebook_id, source_id, chunks)

        db_source = db.query(models.Source).filter(models.Source.id == source_id).first()
        if db_source:
            db_source.status = models.SourceStatus.READY
            db.commit()
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)[:500]}"
        print(f"Error processing source {source_id}: {error_msg}")
        try:
            db_source = db.query(models.Source).filter(models.Source.id == source_id).first()
            if db_source:
                db_source.status = models.SourceStatus.ERROR
                db_source.error_message = error_msg
                db.commit()
        except Exception as inner_e:
            print(f"Error updating source status: {inner_e}")
    finally:
        db.close()


@router.get("/{notebook_id}")
def get_sources(notebook_id: int, db: Session = Depends(get_db)):
    sources = db.query(models.Source).filter(models.Source.notebook_id == notebook_id).all()
    return sources

@router.post("/{notebook_id}/upload")
async def upload_source(
    notebook_id: int,
    background_tasks: BackgroundTasks,
    type: str = Form(...),
    name: str = Form(...),
    url: str = Form(None),
    file: UploadFile = File(None),
    db: Session = Depends(get_db)
):
    notebook = db.query(models.Notebook).filter(models.Notebook.id == notebook_id).first()
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")

    file_path = None
    if file:
        file_path = os.path.join(UPLOAD_DIR, f"{notebook_id}_{file.filename}")
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
            
    content_uri = url if url else file_path

    db_source = models.Source(
        notebook_id=notebook_id,
        name=name,
        type=type,
        status=models.SourceStatus.UPLOADING,
        content_uri=content_uri
    )
    db.add(db_source)
    db.commit()
    db.refresh(db_source)
    
    background_tasks.add_task(
        process_source_background, db_source.id, notebook_id, file_path, url, type
    )
    
    return db_source

@router.delete("/{notebook_id}/{source_id}")
def delete_source(notebook_id: int, source_id: int, db: Session = Depends(get_db)):
    db_source = db.query(models.Source).filter(
        models.Source.id == source_id, 
        models.Source.notebook_id == notebook_id
    ).first()
    
    if not db_source:
        raise HTTPException(status_code=404, detail="Source not found")
        
    delete_source_chunks(notebook_id, source_id)
    
    # If it's a file, remove it
    if db_source.content_uri and db_source.content_uri.startswith("./data/uploads/"):
        if os.path.exists(db_source.content_uri):
            os.remove(db_source.content_uri)
            
    db.delete(db_source)
    db.commit()
    return {"message": "Source deleted"}
