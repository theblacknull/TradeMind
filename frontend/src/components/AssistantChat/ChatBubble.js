import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './ChatBubble.css';
import useAssistant from './useAssistant';
import { Messages, Composer, MemoryList } from './ChatUI';
import { BMark, BrainIcon, ExpandIcon, CloseIcon } from './AssistantParts';

/** Floating quick chat. Hidden on the full-page assistant. */
export default function ChatBubble() {
  const [open, setOpen] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const a = useAssistant();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (pathname.startsWith('/assistant')) return null;

  return (
    <div className="cb-root">
      {open && (
        <section className="cb-panel" role="dialog" aria-label="Quick chat">
          <header className="cb-head">
            <span className="cb-brand"><span className="cb-logo"><BMark size={16} /></span>Chat</span>
            <span className="cb-head-actions">
              <button className={`cb-ghost wide ${showMemory ? 'on' : ''}`} onClick={() => setShowMemory((v) => !v)}
                aria-label="Memory" aria-pressed={showMemory}>
                <BrainIcon /><span>{a.memory.length}</span>
              </button>
              <button className="cb-ghost" onClick={() => navigate('/assistant')} aria-label="Open full page assistant" title="Open full page">
                <ExpandIcon />
              </button>
              <button className="cb-ghost" onClick={() => setOpen(false)} aria-label="Close chat"><CloseIcon /></button>
            </span>
          </header>

          <div className="cb-scroll" aria-live="polite">
            {showMemory
              ? <MemoryList a={a} onClear={() => { a.newChat(); setShowMemory(false); }} />
              : <Messages a={a} />}
          </div>

          <Composer a={a} autoFocus />
        </section>
      )}

      <div className="cb-launch">
        {!open && <span className="cb-tag">Chat with me</span>}
        <button
          className={`cb-fab ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close chat' : 'Open chat'}
          aria-expanded={open}
        >
          <BMark size={30} />
        </button>
      </div>
    </div>
  );
}
