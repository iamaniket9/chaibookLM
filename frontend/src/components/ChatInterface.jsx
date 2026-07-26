import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, Square, AlertTriangle } from 'lucide-react';
import MarkdownMessage from './MarkdownMessage';
import styles from './ChatInterface.module.css';

const GREETING = {
  role: 'assistant',
  content: 'Hello! Ask me anything about your uploaded sources.',
  greeting: true,
};

// How many prior turns to replay so the model can resolve follow-up questions.
const HISTORY_TURNS = 6;

// Treat the user as "reading" (rather than following the stream) once they've
// scrolled this far from the bottom, and stop auto-scrolling.
const PIN_THRESHOLD_PX = 120;

export default function ChatInterface({ notebookId, onCitationClick, externalQuery, onExternalQueryHandled }) {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  const messagesEndRef = useRef(null);
  const listRef = useRef(null);
  const abortRef = useRef(null);
  // Mirrors `messages` so the streaming code can read the latest history
  // without being recreated (and going stale) on every render.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Set when a new notebook's history loads, so we jump to the bottom once
  // even though the user is technically scrolled to the top.
  const forceScrollRef = useRef(true);

  // Load persisted history, and abandon whatever the previous notebook was
  // streaming. The cleanup also runs on unmount.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setMessages([GREETING]);
    setNotice(null);
    setIsLoading(false);
    forceScrollRef.current = true;

    (async () => {
      try {
        const res = await fetch(`/api/chat/${notebookId}/history`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;
        // If the user already started a question while this was in flight,
        // replacing the list would strand the streaming bubble and append
        // tokens onto an old message instead.
        if (abortRef.current) return;
        setMessages(data.length ? [GREETING, ...data] : [GREETING]);
      } catch (e) {
        if (cancelled || e.name === 'AbortError') return;
        console.error('Failed to load chat history', e);
        setNotice('Could not load previous messages for this notebook.');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [notebookId]);

  // Keep the newest message in view without fighting a user who scrolled up,
  // and don't animate mid-stream — a smooth scroll per token is visibly janky.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (!forceScrollRef.current && distanceFromBottom > PIN_THRESHOLD_PX) return;

    messagesEndRef.current?.scrollIntoView({
      behavior: forceScrollRef.current || isLoading ? 'auto' : 'smooth',
      block: 'end',
    });
    forceScrollRef.current = false;
  }, [messages, isLoading]);

  const submitMessage = useCallback(async (text) => {
    if (!text.trim() || abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;

    // Only apply state updates while this request is still the active one; a
    // notebook switch or Stop replaces the controller and orphans this run.
    const isCurrent = () => abortRef.current === controller;

    // Snapshot the history *before* the new turn is appended.
    const recentHistory = messagesRef.current
      .filter(m => !m.greeting && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-HISTORY_TURNS)
      .map(m => ({ role: m.role, content: m.content }));

    setNotice(null);
    setInput('');
    setIsLoading(true);
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', citations: {} },
    ]);

    // Append to the streaming assistant bubble, which is always last.
    const appendToAnswer = (chunk) => {
      setMessages(prev => {
        const next = [...prev];
        const last = next.length - 1;
        next[last] = { ...next[last], content: next[last].content + chunk };
        return next;
      });
    };

    try {
      const response = await fetch(`/api/chat/${notebookId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, history: recentHistory }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      // Events are separated by a blank line and can straddle reads, so an
      // incomplete tail stays buffered rather than being parsed and lost.
      let buffer = '';
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = done ? '' : events.pop();

        for (const rawEvent of events) {
          for (const line of rawEvent.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6);

            if (payload === '[DONE]') {
              finished = true;
              break;
            }

            let data;
            try {
              data = JSON.parse(payload);
            } catch (err) {
              console.error('Error parsing stream data', err, payload);
              continue;
            }

            if (!isCurrent()) return;

            if (data.type === 'citations') {
              setMessages(prev => {
                const next = [...prev];
                const last = next.length - 1;
                next[last] = { ...next[last], citations: data.citations };
                return next;
              });
            } else if (data.type === 'message') {
              appendToAnswer(data.content);
            }
          }
          if (finished) break;
        }

        if (done) break;
      }
    } catch (e) {
      // A deliberate stop or a notebook switch is not an error worth showing.
      if (e.name !== 'AbortError' && isCurrent()) {
        console.error('Chat request failed', e);
        setNotice(`Something went wrong talking to the server. ${e.message}`);
        setMessages(prev => {
          const next = [...prev];
          const last = next.length - 1;
          if (next[last]?.role === 'assistant' && !next[last].content) {
            next[last] = { ...next[last], content: '_No answer was received._', failed: true };
          }
          return next;
        });
      }
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        setIsLoading(false);
      }
    }
  }, [notebookId]);

  // A quick-action click arrives as a fresh object, so an identical question
  // asked twice still re-triggers this effect.
  useEffect(() => {
    if (!externalQuery?.text) return;
    submitMessage(externalQuery.text);
    onExternalQueryHandled?.();
    // Intentionally keyed on externalQuery alone: re-running when submitMessage
    // is recreated would resend the same question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalQuery]);

  const handleStop = () => {
    // The backend keeps whatever it already streamed, so the partial answer on
    // screen matches what gets reloaded later.
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  };

  const clearChat = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setMessages([GREETING]);
    setNotice(null);

    try {
      const res = await fetch(`/api/chat/${notebookId}/history`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error('Failed to clear chat history', e);
      setNotice('Chat cleared on screen, but the server copy could not be deleted.');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitMessage(input);
  };

  return (
    <div className={styles.chatContainer}>
      {/* Chat header with clear button */}
      <div className={styles.chatHeader}>
        <span className={styles.chatTitle}>Chat</span>
        <button
          className={styles.clearChatBtn}
          onClick={clearChat}
          title="Delete this notebook's chat history"
        >
          <Trash2 size={15} />
          Clear chat
        </button>
      </div>

      {notice && (
        <div className={styles.notice} role="status">
          <AlertTriangle size={14} />
          <span>{notice}</span>
        </div>
      )}

      <div className={styles.messagesList} ref={listRef}>
        {messages.map((msg, idx) => {
          return (
            <div
              key={msg.id ?? `local-${idx}`}
              className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.user : styles.assistant}`}
            >
              <div className={`${styles.messageBubble} ${msg.failed ? styles.failed : ''}`}>
                {msg.role === 'assistant'
                  ? (msg.content
                      ? <MarkdownMessage
                          content={msg.content}
                          citations={msg.citations}
                          onCitationClick={onCitationClick}
                        />
                      : <span className={styles.typingDots}><span/><span/><span/></span>)
                  : msg.content
                }
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your sources..."
            disabled={isLoading}
            aria-label="Ask a question about your sources"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={handleStop}
              className={styles.stopBtn}
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={styles.sendBtn}
              title="Send"
              aria-label="Send question"
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
