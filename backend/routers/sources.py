import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from database import get_db
from paths import UPLOAD_DIR, is_managed_upload
import models
from services.ingestion import extract_pdf, extract_text, extract_web, extract_youtube, extract_vtt
from services.vector_store import add_chunks_to_vector_store, delete_source_chunks

router = APIRouter()

# Which extractor handles each source type, and whether it consumes an uploaded
# file or a URL. Keeping this as a table means an unhandled type is impossible
# rather than silently producing an empty source.
EXTRACTORS = {
    models.SourceType.PDF: (extract_pdf, "file"),
    models.SourceType.TEXT: (extract_text, "file"),
    models.SourceType.VTT: (extract_vtt, "file"),
    models.SourceType.WEB: (extract_web, "url"),
    models.SourceType.YOUTUBE: (extract_youtube, "url"),
}


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

        extractor, input_kind = EXTRACTORS[models.SourceType(source_type)]
        source_input = file_path if input_kind == "file" else url
        if not source_input:
            raise ValueError(f"No {input_kind} was provided for this {source_type} source")

        chunks = extractor(source_input)

        if source_type == models.SourceType.PDF:
            # Add filename to metadata so UI can render the PDF
            filename = os.path.basename(file_path)
            for c in chunks:
                c["metadata"]["filename"] = filename

        # An empty result means the source is unusable — a scanned PDF with no
        # text layer, a blank page, a video with no captions. Marking it READY
        # would show a green dot for a notebook that can't answer anything.
        if not chunks:
            raise ValueError(
                "No text could be extracted from this source. "
                "If it is a scanned PDF or an image-only document, it needs OCR first."
            )

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
    type: models.SourceType = Form(...),
    name: str = Form(...),
    url: str = Form(None),
    file: UploadFile = File(None),
    db: Session = Depends(get_db)
):
    notebook = db.query(models.Notebook).filter(models.Notebook.id == notebook_id).first()
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")

    _, input_kind = EXTRACTORS[type]
    if input_kind == "file" and not file:
        raise HTTPException(status_code=422, detail=f"A file is required for a '{type.value}' source")
    if input_kind == "url" and not url:
        raise HTTPException(status_code=422, detail=f"A URL is required for a '{type.value}' source")

    file_path = None
    if file:
        # Only the basename is used: a filename is client-supplied data and may
        # contain path separators.
        safe_name = os.path.basename(file.filename or "upload")
        file_path = os.path.join(UPLOAD_DIR, f"{notebook_id}_{safe_name}")
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

    content_uri = url if url else file_path

    db_source = models.Source(
        notebook_id=notebook_id,
        name=name,
        type=type.value,
        status=models.SourceStatus.UPLOADING,
        content_uri=content_uri
    )
    db.add(db_source)
    db.commit()
    db.refresh(db_source)

    background_tasks.add_task(
        process_source_background, db_source.id, notebook_id, file_path, url, type.value
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

    # If it's a file we stored, remove it
    if is_managed_upload(db_source.content_uri):
        try:
            os.remove(db_source.content_uri)
        except FileNotFoundError:
            pass

    db.delete(db_source)
    db.commit()
    return {"message": "Source deleted"}
