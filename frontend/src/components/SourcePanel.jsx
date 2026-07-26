import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, FileText, File, Link, Video, X, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import Modal from './Modal';
import { BACKEND_URL } from '../config';
import styles from './SourcePanel.module.css';

const POLL_INTERVAL_MS = 3000;
const PENDING_STATUSES = new Set(['uploading', 'indexing']);

const TYPE_ICONS = {
  pdf: File,
  text: FileText,
  web: Link,
  youtube: Video,
  vtt: FileText,
};

const TYPE_LABELS = {
  youtube: 'YouTube video',
  pdf: 'PDF document',
  vtt: 'transcript',
  text: 'text file',
  web: 'webpage',
};

/** Pull the useful part out of a FastAPI error body. */
async function describeError(res) {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') return body.detail;
    if (Array.isArray(body?.detail)) return body.detail.map(d => d.msg).join('; ');
  } catch {
    // fall through to the status line
  }
  return `Request failed (HTTP ${res.status})`;
}

export default function SourcePanel({ notebookId, onQuickQuery }) {
  const [sources, setSources] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [modalConfig, setModalConfig] = useState({ isOpen: false, type: '', title: '', placeholder: '' });

  // Bumped on every notebook switch so a slow in-flight poll can't write its
  // results into the newly selected notebook's list.
  const requestIdRef = useRef(0);

  const fetchSources = useCallback(async (signal) => {
    const requestId = requestIdRef.current;
    try {
      const res = await fetch(`${BACKEND_URL}/api/sources/${notebookId}`, { signal });
      if (!res.ok) throw new Error(await describeError(res));
      const data = await res.json();
      if (requestId !== requestIdRef.current) return null;
      if (!Array.isArray(data)) throw new Error('Unexpected response from server');
      setSources(data);
      setError(null);
      return data;
    } catch (e) {
      if (e.name === 'AbortError' || requestId !== requestIdRef.current) return null;
      console.error('Failed to load sources', e);
      setError(`Could not load sources. ${e.message}`);
      return null;
    }
  }, [notebookId]);

  // Poll only while something is still being indexed. Once every source has
  // settled there is nothing to watch, so the timer stops.
  useEffect(() => {
    requestIdRef.current += 1;
    const controller = new AbortController();
    let timer = null;
    let stopped = false;

    const poll = async () => {
      const data = await fetchSources(controller.signal);
      if (stopped) return;
      const stillWorking = data === null || data.some(s => PENDING_STATUSES.has(s.status));
      if (stillWorking) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    setSources([]);
    setError(null);
    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [notebookId, fetchSources]);

  const handleUpload = async (type, file, url) => {
    if (!file && !url) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('type', type);
    formData.append('name', file ? file.name : url);
    if (file) formData.append('file', file);
    if (url) formData.append('url', url);

    try {
      const res = await fetch(`${BACKEND_URL}/api/sources/${notebookId}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(await describeError(res));
      await fetchSources();
    } catch (e) {
      console.error('Upload failed', e);
      setError(`Upload failed. ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (sourceId) => {
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sources/${notebookId}/${sourceId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await describeError(res));
      setSources(prev => prev.filter(s => s.id !== sourceId));
    } catch (e) {
      console.error('Delete failed', e);
      setError(`Could not delete that source. ${e.message}`);
    }
    await fetchSources();
  };

  // Resetting the input's value lets the same file be picked again after a
  // failed upload or a delete.
  const handleFilePick = (type) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleUpload(type, file, null);
  };

  const openUrlModal = (type, title, placeholder) => {
    setModalConfig({ isOpen: true, type, title, placeholder });
  };

  const getStatusDot = (status) => {
    if (PENDING_STATUSES.has(status)) {
      return <span className={`${styles.statusDot} ${styles.yellow}`} title={status}></span>;
    }
    if (status === 'ready') {
      return <span className={`${styles.statusDot} ${styles.green}`} title="ready"></span>;
    }
    return <span className={`${styles.statusDot} ${styles.red}`} title={status}></span>;
  };

  const fileButtons = [
    { type: 'pdf', label: 'PDF', accept: '.pdf', Icon: Upload },
    { type: 'text', label: 'Text', accept: '.txt', Icon: FileText },
    { type: 'vtt', label: 'VTT', accept: '.vtt', Icon: FileText },
  ];

  return (
    <div className={styles.sourcePanel}>
      <div className={styles.header}>
        <h3>Knowledge Sources</h3>
        {uploading && (
          <span className={styles.uploadingBadge}>
            <Loader2 size={13} className={styles.spin} />
            Uploading…
          </span>
        )}
      </div>

      <div className={styles.uploadControls}>
        {fileButtons.map(({ type, label, accept, Icon }) => (
          <label
            key={type}
            className={`${styles.uploadBtn} ${uploading ? styles.disabledBtn : ''}`}
          >
            <Icon size={16} /> {label}
            <input
              type="file"
              hidden
              accept={accept}
              disabled={uploading}
              onChange={handleFilePick(type)}
            />
          </label>
        ))}
        <button
          className={`${styles.uploadBtn} ${uploading ? styles.disabledBtn : ''}`}
          disabled={uploading}
          onClick={() => openUrlModal('web', 'Add Website Source', 'https://example.com/article')}
        >
          <Link size={16} /> Web
        </button>
        <button
          className={`${styles.uploadBtn} ${uploading ? styles.disabledBtn : ''}`}
          disabled={uploading}
          onClick={() => openUrlModal('youtube', 'Add YouTube Video Source', 'https://youtube.com/watch?v=...')}
        >
          <Video size={16} /> YT
        </button>
      </div>

      {error && (
        <div className={styles.panelError} role="alert">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* URL input modal */}
      <Modal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        placeholder={modalConfig.placeholder}
        onSubmit={(url) => handleUpload(modalConfig.type, null, url)}
        onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
      />

      <div className={styles.sourceList}>
        {sources.length === 0 && !error && (
          <p className={styles.emptyState}>
            No sources yet — add a PDF, text file, VTT, web page or YouTube video to get started.
          </p>
        )}

        {sources.map(src => {
          const Icon = TYPE_ICONS[src.type] ?? FileText;
          const label = TYPE_LABELS[src.type] ?? 'source';

          return (
            <div key={src.id} className={`${styles.sourceItem} ${src.status === 'error' ? styles.sourceError : ''}`}>
              <div className={styles.sourceInfo}>
                <Icon size={16} />
                <span className={styles.sourceName} title={src.name}>{src.name}</span>
              </div>
              <div className={styles.statusArea}>
                {src.status === 'ready' && (
                  <button
                    className={styles.summarizeBtn}
                    onClick={() => onQuickQuery?.(
                      `Give me a detailed summary of the ${label} source titled "${src.name}". ` +
                      'Include the key topics, main points, and any important conclusions.'
                    )}
                    title="Quick AI Summary"
                  >
                    <Sparkles size={14} />
                    Summarize
                  </button>
                )}
                {src.status === 'error' && src.error_message && (
                  <span className={styles.errorIndicator} title={src.error_message}>!</span>
                )}
                {getStatusDot(src.status)}
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(src.id)}
                  title={`Remove ${src.name}`}
                  aria-label={`Remove ${src.name}`}
                >
                  <X size={14} />
                </button>
              </div>
              {src.status === 'error' && src.error_message && (
                <div className={styles.errorMessage}>{src.error_message}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
