from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
from services.vector_store import search_chunks
from openai import AsyncOpenAI
import asyncio
import os

router = APIRouter()

client = AsyncOpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY", "your-deepseek-api-key"),
    base_url="https://api.deepseek.com/v1"
)

@router.get("/{notebook_id}/roadmap")
async def generate_youtube_roadmap(notebook_id: int, db: Session = Depends(get_db)):
    # Get all youtube sources
    sources = db.query(models.Source).filter(
        models.Source.notebook_id == notebook_id,
        models.Source.type == models.SourceType.YOUTUBE
    ).all()
    
    if not sources:
        raise HTTPException(status_code=400, detail="No YouTube sources found in this notebook.")
        
    source_names = [s.name for s in sources]
    
    prompt = f"""Based on the following YouTube videos, generate a personalized learning roadmap. 
Identify the key concepts taught in these videos and create a structured step-by-step path to master them.

Videos:
{', '.join(source_names)}

Output the roadmap in Markdown format.
"""
    
    response = await client.chat.completions.create(
        model="deepseek-v4-pro",
        messages=[
            {"role": "system", "content": "You are an expert learning curriculum designer."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5
    )
    
    return {"roadmap": response.choices[0].message.content}

@router.get("/{notebook_id}/podcast")
async def generate_podcast(notebook_id: int, db: Session = Depends(get_db)):
    # This is a mock for the bonus text-to-speech feature.
    # In a real scenario, we would summarize all sources and pass it to edge-tts or gTTS.
    return {"message": "Podcast generation initiated. Audio file will be available soon (Demo)."}


@router.post("/{notebook_id}/{source_id}/summarize")
async def summarize_youtube(notebook_id: int, source_id: int, db: Session = Depends(get_db)):
    """Extract YouTube transcript chunks and summarize using DeepSeek."""
    source = db.query(models.Source).filter(
        models.Source.id == source_id,
        models.Source.notebook_id == notebook_id
    ).first()

    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    if source.type != models.SourceType.YOUTUBE:
        raise HTTPException(status_code=400, detail="Source is not a YouTube video")

    if not source.content_uri:
        raise HTTPException(status_code=400, detail="No YouTube URL found for this source")

    try:
        from services.ingestion import extract_youtube
        chunks = extract_youtube(source.content_uri)
        full_text = " ".join([c["text"] for c in chunks])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract transcript: {str(e)}")

    if not full_text.strip():
        raise HTTPException(status_code=500, detail="Transcript was empty — the video may have no captions")

    prompt = f"""You are an expert summarizer. Please read the following YouTube video transcript.
Provide a clear, structured summary with a brief overview, followed by the main key takeaways in bullet points.

Transcript:
{full_text[:12000]}"""

    try:
        response = await client.chat.completions.create(
            model="deepseek-v4-pro",
            messages=[
                {"role": "system", "content": "You are an expert video summarizer."},
                {"role": "user", "content": prompt}
            ]
        )
        return {
            "summary": response.choices[0].message.content,
            "video_name": source.name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DeepSeek API error: {str(e)}")
