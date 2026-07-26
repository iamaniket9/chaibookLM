import { useState, useEffect, useCallback } from 'react';
import { PanelRightClose } from 'lucide-react';
import Sidebar from './components/Sidebar';
import SourcePanel from './components/SourcePanel';
import ChatInterface from './components/ChatInterface';
import SourceViewer from './components/SourceViewer';
import Modal from './components/Modal';
import { BACKEND_URL } from './config';
import styles from './App.module.css';

function App() {
  const [notebooks, setNotebooks] = useState([]);
  const [activeNotebook, setActiveNotebook] = useState(null);
  const [activeCitation, setActiveCitation] = useState(null); // { type, url, page, timestamp, text }
  const [pendingQuery, setPendingQuery] = useState(null);
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, targetId: null });
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchNotebooks();
  }, []);

  const fetchNotebooks = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/notebooks/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected response');
      setNotebooks(data);
      setActiveNotebook(prev => prev ?? data[0] ?? null);
      setError(null);
    } catch (e) {
      console.error('Failed to fetch notebooks', e);
      setError('Could not reach the backend. Is the API server running?');
    }
  };

  const createNotebook = async (name) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/notebooks/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res.ok) {
        const detail = await res.text();
        console.error('Backend Error:', detail);
        setError('Failed to create the notebook. See the browser console for details.');
        return;
      }
      const newNb = await res.json();
      setNotebooks(prev => [...prev, newNb]);
      setActiveNotebook(newNb);
      setError(null);
    } catch (e) {
      console.error('Network or proxy error', e);
      setError('Network error: could not reach the backend.');
    }
  };

  const confirmDeleteNotebook = (id) => {
    setDeleteModal({ isOpen: true, targetId: id });
  };

  const handleExecuteDelete = async () => {
    const id = deleteModal.targetId;
    setDeleteModal({ isOpen: false, targetId: null });
    if (!id) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/notebooks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setNotebooks(prev => {
        const remaining = prev.filter(nb => nb.id !== id);
        setActiveNotebook(current => (current?.id === id ? remaining[0] ?? null : current));
        return remaining;
      });
      setActiveCitation(null);
      setError(null);
    } catch (e) {
      console.error('Failed to delete notebook', e);
      setError('Could not delete that notebook.');
    }
  };

  // Quick actions pass a fresh object every time so asking the same question
  // twice still reaches the chat (identical state would be a no-op re-render).
  const requestQuery = useCallback((text) => {
    setPendingQuery({ text });
  }, []);

  return (
    <div className={styles.app}>
      <Sidebar
        notebooks={notebooks}
        activeNotebook={activeNotebook}
        setActiveNotebook={setActiveNotebook}
        onCreate={createNotebook}
        onDelete={confirmDeleteNotebook}
      />

      <Modal
        isOpen={deleteModal.isOpen}
        title="Delete Notebook"
        placeholder="Are you sure you want to delete this notebook? All indexed sources and its chat history will be permanently lost."
        isConfirm={true}
        onSubmit={handleExecuteDelete}
        onClose={() => setDeleteModal({ isOpen: false, targetId: null })}
      />

      {error && (
        <div className={styles.globalError} role="alert">{error}</div>
      )}

      {activeNotebook ? (
        <div className={styles.workspace}>
          <div className={styles.mainColumn}>
            <SourcePanel
              notebookId={activeNotebook.id}
              onQuickQuery={requestQuery}
            />
            <div className={styles.chatCard}>
              <ChatInterface
                notebookId={activeNotebook.id}
                onCitationClick={setActiveCitation}
                externalQuery={pendingQuery}
                onExternalQueryHandled={() => setPendingQuery(null)}
              />
            </div>
          </div>

          {activeCitation && (
            <>
              {/* Backdrop only exists on narrow screens, where the viewer is an overlay. */}
              <div
                className={styles.viewerBackdrop}
                onClick={() => setActiveCitation(null)}
                aria-hidden="true"
              />
              <aside className={styles.viewerColumn}>
                <SourceViewer citation={activeCitation} onClose={() => setActiveCitation(null)} />
              </aside>
            </>
          )}
        </div>
      ) : (
        <div className={styles.emptyWorkspace}>
          <PanelRightClose size={28} />
          <p>Select or create a notebook to begin</p>
        </div>
      )}
    </div>
  );
}

export default App;
