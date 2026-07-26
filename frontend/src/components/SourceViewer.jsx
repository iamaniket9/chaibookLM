import { X } from 'lucide-react';
import styles from './SourceViewer.module.css';

/** Format seconds as H:MM:SS, M:SS, or 0:SS. */
function formatTime(totalSeconds) {
  if (totalSeconds == null || totalSeconds < 0) return null;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SourceViewer({ citation, onClose }) {
  const renderContent = () => {
    if (!citation) return null;

    if (citation.type === 'youtube') {
      const videoId = citation.video_id;
      if (!videoId) {
        return (
          <div className={styles.textHighlightView}>
            <div className={styles.metadataBar}>
              YouTube Source
              {citation.timestamp != null && citation.timestamp > 0 && ` • ${formatTime(citation.timestamp)}`}
            </div>
            <p className={styles.highlightedText}>
              A YouTube video was cited but the video ID could not be resolved.
              The transcript content was retrieved from this video.
            </p>
          </div>
        );
      }

      const hasTimestamp = citation.timestamp != null && citation.timestamp > 0;
      const params = new URLSearchParams();
      if (hasTimestamp) {
        params.set('start', Math.floor(citation.timestamp));
      }
      params.set('rel', '0');
      params.set('modestbranding', '1');

      return (
        <div className={styles.videoWrapper}>
          <div className={styles.metadataBar}>
            YouTube Source
            {hasTimestamp && ` • ${formatTime(citation.timestamp)}`}
          </div>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`}
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          ></iframe>
        </div>
      );
    }

    if (citation.type === 'pdf') {
      return (
        <div className={styles.textHighlightView}>
          <div className={styles.metadataBar}>
            Source: PDF | Page: {citation.page}
          </div>
          {citation.filename ? (
            <iframe
              key={`pdf-${citation.filename}-page-${citation.page}`}
              src={`/uploads/${citation.filename}#page=${citation.page}`}
              className={styles.webIframe}
              title={`PDF Viewer - Page ${citation.page}`}
            />
          ) : (
            <p className={styles.highlightedText}>
              We retrieved information from page {citation.page} of the document.
              (Re-upload this PDF to enable native viewing in the new update!)
            </p>
          )}
        </div>
      );
    }
    
    if (citation.type === 'web') {
        return (
          <div className={styles.textHighlightView}>
            <div className={styles.metadataBar}>
              Source: Web
            </div>
            <div className={styles.webLinkBox}>
              <p className={styles.highlightedText}>
                This answer was sourced from the following webpage:
              </p>
              {citation.url ? (
                <a href={citation.url} target="_blank" rel="noreferrer" className={styles.webLink}>
                  🔗 {citation.url}
                </a>
              ) : (
                <p className={styles.highlightedText}>URL not available.</p>
              )}
            </div>
          </div>
        );
    }

    if (citation.type === 'vtt') {
      return (
        <div className={styles.textHighlightView}>
          <div className={styles.metadataBar}>
            VTT Source
            {citation.timestamp != null && citation.timestamp > 0 && ` • ${formatTime(citation.timestamp)}`}
          </div>
          <p className={styles.highlightedText}>
            Relevant section was cited from this source.
          </p>
        </div>
      );
    }

    // Default fallback (text, etc.) — no timestamp
    return (
      <div className={styles.textHighlightView}>
        <div className={styles.metadataBar}>
          Source Type: {(citation.type || 'TEXT').toUpperCase()}
          {citation.page != null && ` | Page: ${citation.page}`}
        </div>
        <p className={styles.highlightedText}>
          Relevant section was cited from this source.
        </p>
      </div>
    );
  };

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.header}>
        <h3>Source Viewer</h3>
        <button onClick={onClose} className={styles.closeBtn}>
          <X size={18} />
        </button>
      </div>
      <div className={styles.contentArea}>
        {renderContent()}
      </div>
    </div>
  );
}
