from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
import datetime
from database import Base
import enum

class SourceStatus(str, enum.Enum):
    UPLOADING = "uploading"
    INDEXING = "indexing"
    READY = "ready"
    ERROR = "error"

class SourceType(str, enum.Enum):
    PDF = "pdf"
    TEXT = "text"
    WEB = "web"
    YOUTUBE = "youtube"
    VTT = "vtt"

class Notebook(Base):
    __tablename__ = "notebooks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    sources = relationship("Source", back_populates="notebook", cascade="all, delete-orphan")

class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, index=True)
    notebook_id = Column(Integer, ForeignKey("notebooks.id"))
    name = Column(String)
    type = Column(String) # SourceType
    status = Column(String, default=SourceStatus.UPLOADING)
    content_uri = Column(String, nullable=True) # file path or URL
    error_message = Column(String, nullable=True) # stores error details if indexing fails
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    notebook = relationship("Notebook", back_populates="sources")
