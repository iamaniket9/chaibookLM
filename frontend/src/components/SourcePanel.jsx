import { useState, useEffect } from 'react';
import { Upload, FileText, File, Link, Video, X, Sparkles } from 'lucide-react';
import Modal from './Modal';
import styles from './SourcePanel.module.css';

export default function SourcePanel({ notebookId, onQuickQuery }) {
  const [sources, setSources] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [modalConfig, setModalConfig] = useState({ isOpen: false, type: '', title: '', placeholder: '' });
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Poll for sources to update status
  useEffect(() => {
    fetchSources();
    const interval = setInterval(fetchSources, 3000);
    return () => clearInterval(interval);
  }, [notebookId]);

  const fetchSources = async () => {
    const res = await fetch(`/api/sources/${notebookId}`);
    const data = await res.json();
    setSources(data);
  };

  // Gate: only allow upload if no source exists yet
  const guardUpload = (callback) => {
    if (sources.length > 0) {
      setShowLimitModal(true);
      return;
    }
    callback();
  };

  const handleUpload = async (type, file, url) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('type', type);
    formData.append('name', file ? file.name : url);
    if (file) formData.append('file', file);
    if (url) formData.append('url', url);

    await fetch(`/api/sources/${notebookId}/upload`, {
      method: 'POST',
      body: formData,
    });
    
    fetchSources();
    setUploading(false);
  };

  const getStatusDot = (status) => {
    if (status === 'uploading' || status === 'indexing') {
      return <span className={`${styles.statusDot} ${styles.yellow}`}></span>;
    }
    if (status === 'ready') {
      return <span className={`${styles.statusDot} ${styles.green}`}></span>;
    }
    return <span className={`${styles.statusDot} ${styles.red}`}></span>;
  };

  // Ref for hidden file inputs so we can trigger them programmatically
  const pdfRef = useState(null);
  const textRef = useState(null);
  const vttRef = useState(null);

  return (
    <div className={styles.sourcePanel}>
      <div className={styles.header}>
        <h3>Knowledge Sources</h3>
        {sources.length > 0 && (
          <span className={styles.sourceLimit}>1 source per notebook</span>
        )}
      </div>
      
      <div className={styles.uploadControls}>
        <label className={`${styles.uploadBtn} ${sources.length > 0 ? styles.disabledBtn : ''}`}
          onClick={(e) => { if (sources.length > 0) { e.preventDefault(); setShowLimitModal(true); } }}>
          <Upload size={16} /> PDF
          <input type="file" hidden accept=".pdf" onChange={(e) => handleUpload('pdf', e.target.files[0], null)} />
        </label>
        <label className={`${styles.uploadBtn} ${sources.length > 0 ? styles.disabledBtn : ''}`}
          onClick={(e) => { if (sources.length > 0) { e.preventDefault(); setShowLimitModal(true); } }}>
          <FileText size={16} /> Text
          <input type="file" hidden accept=".txt" onChange={(e) => handleUpload('text', e.target.files[0], null)} />
        </label>
        <label className={`${styles.uploadBtn} ${sources.length > 0 ? styles.disabledBtn : ''}`}
          onClick={(e) => { if (sources.length > 0) { e.preventDefault(); setShowLimitModal(true); } }}>
          <FileText size={16} /> VTT
          <input type="file" hidden accept=".vtt" onChange={(e) => handleUpload('vtt', e.target.files[0], null)} />
        </label>
        <button className={`${styles.uploadBtn} ${sources.length > 0 ? styles.disabledBtn : ''}`} onClick={() => {
          guardUpload(() => setModalConfig({
            isOpen: true,
            type: 'web',
            title: 'Add Website Source',
            placeholder: 'https://example.com/article'
          }));
        }}>
          <Link size={16} /> Web
        </button>
        <button className={`${styles.uploadBtn} ${sources.length > 0 ? styles.disabledBtn : ''}`} onClick={() => {
          guardUpload(() => setModalConfig({
            isOpen: true,
            type: 'youtube',
            title: 'Add YouTube Video Source',
            placeholder: 'https://youtube.com/watch?v=...'
          }));
        }}>
          <Video size={16} /> YT
        </button>
      </div>

      {/* URL input modal */}
      <Modal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        placeholder={modalConfig.placeholder}
        onSubmit={(url) => handleUpload(modalConfig.type, null, url)}
        onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
      />

      {/* Single source limit warning modal */}
      <Modal
        isOpen={showLimitModal}
        title="One Source Per Notebook"
        placeholder="Each notebook supports one knowledge source at a time for focused interaction. Please create a new notebook (click the + button) to work with a different file or link."
        isConfirm={true}
        onSubmit={() => setShowLimitModal(false)}
        onClose={() => setShowLimitModal(false)}
      />

      <div className={styles.sourceList}>
        {sources.map(src => (
          <div key={src.id} className={`${styles.sourceItem} ${src.status === 'error' ? styles.sourceError : ''}`}>
            <div className={styles.sourceInfo}>
              {src.type === 'pdf' && <File size={16} />}
              {src.type === 'text' && <FileText size={16} />}
              {src.type === 'web' && <Link size={16} />}
              {src.type === 'youtube' && <Video size={16} />}
              {src.type === 'vtt' && <FileText size={16} />}
              <span className={styles.sourceName} title={src.name}>{src.name}</span>
            </div>
            <div className={styles.statusArea}>
              {src.status === 'ready' && (src.type === 'youtube' || src.type === 'web' || src.type === 'pdf' || src.type === 'vtt' || src.type === 'text') && (
                <button
                  className={styles.summarizeBtn}
                  onClick={() => onQuickQuery && onQuickQuery(`Give me a detailed summary of the ${src.type === 'youtube' ? 'YouTube video' : src.type === 'pdf' ? 'PDF document' : src.type === 'vtt' ? 'transcript' : src.type === 'text' ? 'text file' : 'webpage'} source titled "${src.name}". Include the key topics, main points, and any important conclusions.`)}
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
                onClick={async () => {
                  await fetch(`/api/sources/${notebookId}/${src.id}`, { method: 'DELETE' });
                  fetchSources();
                }}
              >
                <X size={14} />
              </button>
            </div>
            {src.status === 'error' && src.error_message && (
              <div className={styles.errorMessage}>{src.error_message}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
