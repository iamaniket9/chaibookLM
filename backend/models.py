from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
import datetime
from database import Base
import enum


def utcnow() -> datetime.datetime:
    """Timezone-aware UTC timestamp.

    `datetime.datetime.utcnow()` is deprecated from Python 3.12 and returns a
    naive datetime, which makes comparisons with aware timestamps blow up.
    """
    return datetime.datetime.now(datetime.timezone.utc)


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
    created_at = Column(DateTime, default=utcnow)

    sources = relationship("Source", back_populates="notebook", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="notebook", cascade="all, delete-orphan")

class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, index=True)
    notebook_id = Column(Integer, ForeignKey("notebooks.id"))
    name = Column(String)
    type = Column(String) # SourceType
    status = Column(String, default=SourceStatus.UPLOADING)
    content_uri = Column(String, nullable=True) # file path or URL
    error_message = Column(String, nullable=True) # stores error details if indexing fails
    created_at = Column(DateTime, default=utcnow)

    notebook = relationship("Notebook", back_populates="sources")

class Message(Base):
    """A single turn of a notebook's chat, persisted so history survives reloads."""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    notebook_id = Column(Integer, ForeignKey("notebooks.id"), index=True)
    role = Column(String) # 'user' or 'assistant'
    content = Column(Text)
    # JSON-encoded citation map for assistant turns, so clicking a citation
    # still opens the source viewer after a page reload.
    citations = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    notebook = relationship("Notebook", back_populates="messages")
