import os
import fitz  # PyMuPDF
from bs4 import BeautifulSoup
import requests
from youtube_transcript_api import YouTubeTranscriptApi
import webvtt
import re
import tempfile
import json
from typing import List, Dict

def simple_chunker(text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
    """A basic character-based chunker."""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return chunks

def extract_pdf(file_path: str) -> List[Dict]:
    """Extracts text from PDF page by page."""
    doc = fitz.open(file_path)
    chunks = []
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        text = page.get_text("text")
        if text.strip():
            # chunk within page to keep page_num accurate
            page_chunks = simple_chunker(text, chunk_size=300, overlap=50)
            for c in page_chunks:
                chunks.append({
                    "text": c,
                    "metadata": {"page": page_num + 1, "type": "pdf"}
                })
    return chunks

def extract_text(file_path: str) -> List[Dict]:
    with open(file_path, "r", encoding="utf-8") as f:
        text = f.read()
    text_chunks = simple_chunker(text, chunk_size=400, overlap=50)
    return [{"text": c, "metadata": {"type": "text"}} for c in text_chunks]

def extract_web(url: str) -> List[Dict]:
    response = requests.get(url, timeout=10)
    soup = BeautifulSoup(response.content, "html.parser")
    # Remove scripts and styles
    for script in soup(["script", "style"]):
        script.extract()
    text = soup.get_text(separator=" ", strip=True)
    text_chunks = simple_chunker(text, chunk_size=400, overlap=50)
    return [{"text": c, "metadata": {"url": url, "type": "web"}} for c in text_chunks]

def extract_youtube_video_id(url: str) -> str:
    """Extract YouTube video ID from various URL formats.

    Supports:
    - https://www.youtube.com/watch?v=VIDEOID
    - https://youtu.be/VIDEOID
    - https://youtube.com/shorts/VIDEOID
    - https://www.youtube.com/live/VIDEOID
    - https://m.youtube.com/watch?v=VIDEOID
    - https://music.youtube.com/watch?v=VIDEOID
    - https://www.youtube.com/embed/VIDEOID
    - URLs with extra params (list, si, feature, t, etc.)
    """
    patterns = [
        # Standard watch URL: youtube.com/watch?v=VIDEOID (any subdomain)
        r'(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})',
        # Short URL: youtu.be/VIDEOID
        r'(?:https?://)?youtu\.be/([a-zA-Z0-9_-]{11})',
        # Shorts: youtube.com/shorts/VIDEOID
        r'(?:https?://)?(?:www\.)?youtube\.com/shorts/([a-zA-Z0-9_-]{11})',
        # Live: youtube.com/live/VIDEOID
        r'(?:https?://)?(?:www\.)?youtube\.com/live/([a-zA-Z0-9_-]{11})',
        # Embed: youtube.com/embed/VIDEOID
        r'(?:https?://)?(?:www\.)?youtube\.com/embed/([a-zA-Z0-9_-]{11})',
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)

    raise ValueError(f"Invalid YouTube URL: '{url}'. Could not extract video ID. Supported formats: youtube.com/watch?v=, youtu.be/, /shorts/, /live/, /embed/")

def _get_youtube_cookies_path() -> str | None:
    """Find the YouTube cookies file for authentication.

    Checks in order: YOUTUBE_COOKIES_PATH env var, backend/youtube_cookies.txt, cwd/youtube_cookies.txt
    Returns the path if found, None otherwise.
    """
    candidates = [
        os.environ.get("YOUTUBE_COOKIES_PATH", ""),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "youtube_cookies.txt"),
        os.path.join(os.getcwd(), "youtube_cookies.txt"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None

def _extract_youtube_ytdlp(video_id: str) -> List[Dict]:
    """Extract YouTube transcript using yt-dlp.

    yt-dlp is far more resilient than youtube-transcript-api:
    - Actively maintained to work around YouTube changes
    - Supports cookie-based authentication
    - Handles rate limiting and IP blocks better

    To bypass aggressive blocking, place a 'youtube_cookies.txt' file
    (exported via 'Get cookies.txt LOCALLY' browser extension) in backend/.
    """
    import yt_dlp

    cookies_path = _get_youtube_cookies_path()
    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        outtmpl = os.path.join(tmpdir, "%(id)s")

        ydl_opts = {
            "outtmpl": outtmpl,
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["en"],
            "subtitlesformat": "vtt",
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
        }

        if cookies_path:
            ydl_opts["cookiefile"] = cookies_path

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
        except Exception as e:
            raise ValueError(f"yt-dlp failed to extract video info: {e}")

        # yt-dlp saves subtitles as <outtmpl>.<lang>.vtt in tmpdir
        # Find the VTT file
        vtt_path = None
        for f in os.listdir(tmpdir):
            if f.endswith(".en.vtt"):
                vtt_path = os.path.join(tmpdir, f)
                break

        if not vtt_path:
            # Check if subtitles are available at all
            subs = info.get("subtitles", {})
            auto_subs = info.get("automatic_captions", {})
            available = list(subs.keys()) + list(auto_subs.keys())
            if available:
                raise ValueError(
                    f"No English subtitles found for this video. "
                    f"Available languages: {', '.join(sorted(set(available)))}"
                )
            else:
                raise ValueError("This video has no subtitles or auto-captions available.")

        # Parse the VTT file using the existing VTT parser
        return _parse_vtt_to_chunks(vtt_path, video_id)

def _parse_vtt_to_chunks(vtt_path: str, video_id: str) -> List[Dict]:
    """Parse a VTT file into chunks with YouTube metadata."""
    chunks = []
    current_chunk_text = ""
    start_time_sec = 0

    for caption in webvtt.read(vtt_path):
        if not current_chunk_text:
            parts = caption.start.split(':')
            if len(parts) == 3:
                start_time_sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
            elif len(parts) == 2:
                start_time_sec = int(parts[0]) * 60 + float(parts[1])

        current_chunk_text += caption.text.replace('\n', ' ') + " "

        if len(current_chunk_text.split()) > 200:
            chunks.append({
                "text": current_chunk_text.strip(),
                "metadata": {"timestamp": int(start_time_sec), "video_id": video_id, "type": "youtube"}
            })
            current_chunk_text = ""

    if current_chunk_text:
        chunks.append({
            "text": current_chunk_text.strip(),
            "metadata": {"timestamp": int(start_time_sec), "video_id": video_id, "type": "youtube"}
        })

    return chunks

def _extract_youtube_transcript_api(video_id: str) -> List[Dict]:
    """Fallback: extract YouTube transcript using youtube-transcript-api."""
    cookies_path = _get_youtube_cookies_path()

    if cookies_path:
        # Load cookies into a requests session
        import requests as req_lib
        session = req_lib.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        try:
            with open(cookies_path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split("\t")
                    if len(parts) >= 7 and "youtube.com" in parts[0]:
                        session.cookies.set(parts[5], parts[6], domain=".youtube.com")
        except Exception:
            pass
        yt_api = YouTubeTranscriptApi(http_client=session)
    else:
        yt_api = YouTubeTranscriptApi()

    fetched = None
    try:
        fetched = yt_api.fetch(video_id, languages=('en',))
    except Exception:
        pass

    if fetched is None:
        try:
            fetched = yt_api.fetch(video_id)
        except Exception:
            pass

    if fetched is None:
        try:
            transcript_list = yt_api.list(video_id)
            transcript_obj = None
            for method in ['find_transcript', 'find_generated_transcript', 'find_manually_created_transcript']:
                try:
                    transcript_obj = getattr(transcript_list, method)(['en'])
                    if transcript_obj:
                        break
                except Exception:
                    pass
            if transcript_obj is None:
                transcript_obj = next(iter(transcript_list), None)
            if transcript_obj is None:
                raise ValueError("No transcripts available")
            fetched = transcript_obj.fetch()
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"transcript-api list/select failed: {e}")

    transcript_data = []
    for s in fetched:
        if isinstance(s, dict):
            transcript_data.append({
                "text": str(s.get("text", "")),
                "start": float(s.get("start", 0)),
            })
        else:
            transcript_data.append({
                "text": str(getattr(s, "text", "")),
                "start": float(getattr(s, "start", 0)),
            })

    if not transcript_data:
        raise ValueError("No transcript content found")

    # Chunk the transcript
    chunks = []
    current_chunk_text = ""
    start_time = 0

    for item in transcript_data:
        if not current_chunk_text:
            start_time = item["start"]
        current_chunk_text += item["text"] + " "
        if len(current_chunk_text.split()) > 200:
            chunks.append({
                "text": current_chunk_text.strip(),
                "metadata": {"timestamp": int(start_time), "video_id": video_id, "type": "youtube"}
            })
            current_chunk_text = ""

    if current_chunk_text:
        chunks.append({
            "text": current_chunk_text.strip(),
            "metadata": {"timestamp": int(start_time), "video_id": video_id, "type": "youtube"}
        })

    return chunks

def extract_youtube(url: str) -> List[Dict]:
    """Extract transcript from a YouTube video URL.

    Uses yt-dlp as primary method (most reliable, handles IP blocks well).
    Falls back to youtube-transcript-api if yt-dlp fails.

    Place a 'youtube_cookies.txt' file (Netscape format) in the backend/
    directory to authenticate and bypass aggressive YouTube blocking.
    """
    video_id = extract_youtube_video_id(url)
    errors = []

    # Strategy 1: yt-dlp — most reliable, actively maintained
    try:
        return _extract_youtube_ytdlp(video_id)
    except Exception as e:
        errors.append(f"yt-dlp: {e}")

    # Strategy 2: youtube-transcript-api with cookie support
    try:
        return _extract_youtube_transcript_api(video_id)
    except Exception as e:
        errors.append(f"transcript-api: {e}")

    # Both failed — give the user actionable advice
    cookies_path = _get_youtube_cookies_path()
    cookie_tip = (
        f"Cookies file found at '{cookies_path}'. " if cookies_path
        else "No cookies file found. "
    )
    raise ValueError(
        f"Could not retrieve transcript for video '{video_id}'. "
        f"Errors: {' | '.join(errors)}. "
        f"{cookie_tip}"
        f"To fix: (1) Install 'Get cookies.txt LOCALLY' browser extension, "
        f"(2) Log into youtube.com, (3) Export cookies to 'youtube_cookies.txt' "
        f"in the backend/ directory, or set YOUTUBE_COOKIES_PATH env var."
    )

def extract_youtube_full_text(url: str) -> str:
    """Extract the full transcript from a YouTube video as a single text string.

    Reuses the existing extract_youtube() pipeline (both yt-dlp and
    transcript-api strategies) but returns the raw joined text instead of
    chunked results. Useful for feeding into large-context LLMs like Gemini.
    """
    chunks = extract_youtube(url)
    return " ".join([chunk["text"] for chunk in chunks])


def extract_vtt(file_path: str) -> List[Dict]:
    chunks = []
    current_chunk_text = ""
    start_time_sec = 0
    
    for caption in webvtt.read(file_path):
        if not current_chunk_text:
            # Parse start time: HH:MM:SS.mmm
            parts = caption.start.split(':')
            if len(parts) == 3:
                start_time_sec = int(parts[0])*3600 + int(parts[1])*60 + float(parts[2])
            elif len(parts) == 2:
                start_time_sec = int(parts[0])*60 + float(parts[1])
                
        current_chunk_text += caption.text.replace('\n', ' ') + " "
        
        if len(current_chunk_text.split()) > 200:
            chunks.append({
                "text": current_chunk_text,
                "metadata": {"timestamp": int(start_time_sec), "type": "vtt"}
            })
            current_chunk_text = ""
            
    if current_chunk_text:
        chunks.append({
            "text": current_chunk_text,
            "metadata": {"timestamp": int(start_time_sec), "type": "vtt"}
        })
        
    return chunks
