from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
from pydantic import BaseModel

router = APIRouter()

class NotebookCreate(BaseModel):
    name: str

class NotebookResponse(BaseModel):
    id: int
    name: str
    
    class Config:
        from_attributes = True

@router.get("/", response_model=list[NotebookResponse])
def get_notebooks(db: Session = Depends(get_db)):
    return db.query(models.Notebook).all()

@router.post("/", response_model=NotebookResponse)
def create_notebook(notebook: NotebookCreate, db: Session = Depends(get_db)):
    db_notebook = models.Notebook(name=notebook.name)
    db.add(db_notebook)
    db.commit()
    db.refresh(db_notebook)
    return db_notebook

@router.delete("/{notebook_id}")
def delete_notebook(notebook_id: int, db: Session = Depends(get_db)):
    db_notebook = db.query(models.Notebook).filter(models.Notebook.id == notebook_id).first()
    if not db_notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")
    
    # Cascade delete will handle sources in SQLite, but we also need to delete ChromaDB collection
    import chromadb
    import shutil
    try:
        from services.vector_store import chroma_client
        chroma_client.delete_collection(name=f"notebook_{notebook_id}")
    except Exception as e:
        print(f"Error deleting collection: {e}")
        
    db.delete(db_notebook)
    db.commit()
    return {"message": "Notebook deleted"}
