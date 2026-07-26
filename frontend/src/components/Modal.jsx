import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

export default function Modal({ isOpen, title, placeholder, initialValue = '', onSubmit, onClose, isConfirm = false }) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isConfirm && !value.trim()) return;
    onSubmit(value);
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>{title}</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.body}>
          {!isConfirm ? (
            <input
              autoFocus
              type="text"
              className={styles.input}
              placeholder={placeholder || 'Enter URL...'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <p className={styles.confirmText}>{placeholder}</p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn}>
              {isConfirm ? 'Confirm' : 'Add Source'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
