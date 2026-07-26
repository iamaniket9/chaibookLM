import { useState, useRef, useEffect } from 'react';
import { Send, Trash2 } from 'lucide-react';
import styles from './ChatInterface.module.css';

const INITIAL_MSG = { role: 'assistant', content: 'Hello! Ask me anything about your uploaded sources.' };

export default function ChatInterface({ notebookId, onCitationClick, externalQuery, onExternalQueryHandled }) {
  const [messages, setMessages] = useState([INITIAL_MSG]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const currentCitationsRef = useRef({});

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Reset messages when notebook changes
  useEffect(() => {
    setMessages([INITIAL_MSG]);
  }, [notebookId]);

  // Handle external query injection (e.g. YouTube quick summary)
  useEffect(() => {
    if (externalQuery && !isLoading) {
      submitMessage(externalQuery);
      if (onExternalQueryHandled) onExternalQueryHandled();
    }
  }, [externalQuery]);

  const clearChat = () => {
    setMessages([INITIAL_MSG]);
  };

  const submitMessage = async (text) => {
    if (!text.trim() || isLoading) return;

    const userMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '', citations: {} }]);
    currentCitationsRef.current = {};

    try {
      // Send the last few exchanges so the LLM understands follow-up questions
      const recentHistory = messages
        .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(1)   // Skip the initial greeting
        .slice(-6); // Last 6 messages (3 exchanges) max
      const response = await fetch(`/api/chat/${notebookId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          history: recentHistory.map(m => ({ role: m.role, content: m.content }))
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6);
            if (dataStr === '[DONE]') break;
            try {
              const data = JSON.parse(dataStr);
              if (data.type === 'citations') {
                currentCitationsRef.current = data.citations;
                setMessages(prev => {
                  const newMsgs = [...prev];
                  newMsgs[newMsgs.length - 1] = { ...newMsgs[newMsgs.length - 1], citations: data.citations };
                  return newMsgs;
                });
              } else if (data.type === 'message') {
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastIndex = newMsgs.length - 1;
                  newMsgs[lastIndex] = {
                    ...newMsgs[lastIndex],
                    content: newMsgs[lastIndex].content + data.content
                  };
                  return newMsgs;
                });
              }
            } catch (err) {
              console.error('Error parsing stream data', err);
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitMessage(input);
  };

  const renderMessageContent = (text, citations) => {
    if (!text) return null;
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const citationId = match[1];
        const citeData = citations ? citations[citationId] : null;
        if (citeData) {
          return (
            <span key={i} className={styles.citationBadge} onClick={() => onCitationClick(citeData)}>
              {citationId}
            </span>
          );
        }
        return <span key={i} className={styles.citationBadge}>{citationId}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className={styles.chatContainer}>
      {/* Chat header with clear button */}
      <div className={styles.chatHeader}>
        <span className={styles.chatTitle}>Chat</span>
        <button
          className={styles.clearChatBtn}
          onClick={clearChat}
          title="Clear chat history"
          disabled={isLoading}
        >
          <Trash2 size={15} />
          Clear chat
        </button>
      </div>

      <div className={styles.messagesList}>
        {messages.map((msg, idx) => (
          <div key={idx} className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.user : styles.assistant}`}>
            <div className={`${styles.messageBubble} ${isLoading && idx === messages.length - 1 && msg.role === 'assistant' && !msg.content ? styles.typing : ''}`}>
              {msg.role === 'assistant'
                ? (msg.content
                    ? renderMessageContent(msg.content, msg.citations)
                    : <span className={styles.typingDots}><span/><span/><span/></span>)
                : msg.content
              }
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your sources..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()} className={styles.sendBtn}>
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
