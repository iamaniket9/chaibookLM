import { useState } from 'react';
import { Plus, Book, Trash2 } from 'lucide-react';
import styles from './Sidebar.module.css';

export default function Sidebar({ notebooks, activeNotebook, setActiveNotebook, onCreate, onDelete }) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    if (newName.trim()) {
      onCreate(newName);
      setNewName('');
      setIsCreating(false);
    }
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <h2>ChaiBookLM</h2>
        <button className={styles.addButton} onClick={() => setIsCreating(true)}>
          <Plus size={20} />
        </button>
      </div>
      
      {isCreating && (
        <form onSubmit={handleCreate} className={styles.createForm}>
          <input 
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Notebook name..."
            onBlur={() => setIsCreating(false)}
          />
        </form>
      )}

      <div className={styles.notebookList}>
        {notebooks.map(nb => (
          <div 
            key={nb.id} 
            className={`${styles.notebookItem} ${activeNotebook?.id === nb.id ? styles.active : ''}`}
            onClick={() => setActiveNotebook(nb)}
          >
            <div className={styles.notebookNameWrapper}>
              <Book size={18} />
              <span className={styles.notebookName}>{nb.name}</span>
            </div>
            <button 
              className={styles.deleteNbBtn}
              onClick={(e) => { e.stopPropagation(); onDelete(nb.id); }}
              title="Delete Notebook"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
