import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import SourcePanel from './components/SourcePanel';
import ChatInterface from './components/ChatInterface';
import SourceViewer from './components/SourceViewer';
import Modal from './components/Modal';
import './index.css';

function App() {
  const [notebooks, setNotebooks] = useState([]);
  const [activeNotebook, setActiveNotebook] = useState(null);
  const [activeCitation, setActiveCitation] = useState(null); // { type, url, page, timestamp }
  const [pendingQuery, setPendingQuery] = useState(null);

  useEffect(() => {
    fetchNotebooks();
  }, []);

  const fetchNotebooks = async () => {
    try {
      const res = await fetch('/api/notebooks/');
      const data = await res.json();
      setNotebooks(data);
      if (data.length > 0 && !activeNotebook) {
        setActiveNotebook(data[0]);
      }
    } catch (e) {
      console.error("Failed to fetch notebooks", e);
    }
  };

  const createNotebook = async (name) => {
    try {
      const res = await fetch('/api/notebooks/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res.ok) {
        console.error("Backend Error:", await res.text());
        alert("Failed to create notebook. Check browser console for details.");
        return;
      }
      const newNb = await res.json();
      setNotebooks([...notebooks, newNb]);
      setActiveNotebook(newNb);
    } catch (e) {
      console.error("Network or Proxy Error:", e);
      alert("Network error: Could not reach the backend. Did you restart the frontend?");
    }
  };

  const [deleteModal, setDeleteModal] = useState({ isOpen: false, targetId: null });

  const confirmDeleteNotebook = async (id) => {
    setDeleteModal({ isOpen: true, targetId: id });
  };

  const handleExecuteDelete = async () => {
    const id = deleteModal.targetId;
    if (!id) return;
    try {
      const res = await fetch(`/api/notebooks/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        console.error("Failed to delete notebook", await res.text());
        return;
      }
      const newNotebooks = notebooks.filter(nb => nb.id !== id);
      setNotebooks(newNotebooks);
      if (activeNotebook?.id === id) {
        setActiveNotebook(newNotebooks.length > 0 ? newNotebooks[0] : null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
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
        placeholder="Are you sure you want to delete this notebook? All indexed sources and chat history will be permanently lost."
        isConfirm={true}
        onSubmit={handleExecuteDelete}
        onClose={() => setDeleteModal({ isOpen: false, targetId: null })}
      />
      
      {activeNotebook ? (
        <div style={{ display: 'flex', flex: 1, flexDirection: 'row' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflowY: 'auto' }}>
            <SourcePanel 
              notebookId={activeNotebook.id} 
              onQuickQuery={setPendingQuery} 
            />
            <div style={{ flex: 1, marginTop: '20px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
              <ChatInterface 
                notebookId={activeNotebook.id} 
                onCitationClick={setActiveCitation} 
                externalQuery={pendingQuery}
                onExternalQueryHandled={() => setPendingQuery(null)}
              />
            </div>
          </div>
          
          {activeCitation && (
            <div style={{ width: '40%', borderLeft: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
              <SourceViewer citation={activeCitation} onClose={() => setActiveCitation(null)} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
          Select or create a notebook to begin
        </div>
      )}
    </div>
  );
}

export default App;
