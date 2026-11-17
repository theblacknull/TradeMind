import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ChatBubble.css';
import './AssistantPage.css';
import useAssistant from './useAssistant';
import { Messages, Composer, MemoryList } from './ChatUI';
import { BMark, BrainIcon, PlusIcon, TrashIcon, CloseIcon } from './AssistantParts';

const DAY = 24 * 60 * 60 * 1000;
const groupOf = (ts) => {
  const age = Date.now() - ts;
  if (age < DAY) return 'Today';
  if (age < 2 * DAY) return 'Yesterday';
  if (age < 7 * DAY) return 'Previous 7 days';
  return 'Older';
};
const ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
);

/** Full-page assistant: history on the left, one conversation in the middle. */
export default function AssistantPage() {
  const a = useAssistant();
  const navigate = useNavigate();
  const [sideOpen, setSideOpen] = useState(false);
  const [showMemory, setShowMemory] = useState(false);

  useEffect(() => { document.title = 'TradeMind Assistant'; return () => { document.title = 'TradeMind'; }; }, []);

  const sorted = [...a.convs].sort((x, y) => y.updatedAt - x.updatedAt);
  const groups = ORDER
    .map((g) => ({ g, items: sorted.filter((c) => groupOf(c.updatedAt) === g) }))
    .filter((x) => x.items.length);

  const pick = (id) => { a.openConv(id); setShowMemory(false); setSideOpen(false); };

  return (
    <div className="ap-root">
      <aside className={`ap-side ${sideOpen ? 'open' : ''}`} aria-label="Conversation history">
        <div className="ap-side-top">
          <button className="ap-back" onClick={() => navigate('/')}><BackIcon />Home</button>
          <button className="ap-close-side" onClick={() => setSideOpen(false)} aria-label="Close history"><CloseIcon /></button>
        </div>

        <button className="ap-new" onClick={() => { a.newChat(); setShowMemory(false); setSideOpen(false); }}>
          <PlusIcon />New chat
        </button>

        <nav className="ap-list">
          {groups.length === 0 && <p className="ap-none">Your conversations will appear here.</p>}
          {groups.map(({ g, items }) => (
            <div key={g} className="ap-group">
              <h5>{g}</h5>
              {items.map((c) => (
                <div key={c.id} className={`ap-item ${c.id === a.activeId && !showMemory ? 'active' : ''}`}>
                  <button className="ap-item-main" onClick={() => pick(c.id)} title={c.title}>{c.title}</button>
                  <button className="ap-item-del" onClick={() => a.removeConv(c.id)} aria-label={`Delete ${c.title}`}><TrashIcon /></button>
                </div>
              ))}
            </div>
          ))}
        </nav>

        <button className={`ap-mem ${showMemory ? 'on' : ''}`} onClick={() => setShowMemory((v) => !v)} aria-pressed={showMemory}>
          <BrainIcon />Memory <span>{a.memory.length}</span>
        </button>
      </aside>
      {sideOpen && <div className="ap-scrim" onClick={() => setSideOpen(false)} />}

      <main className="ap-main">
        <header className="ap-head">
          <button className="ap-menu" onClick={() => setSideOpen(true)} aria-label="Open history"><MenuIcon /></button>
          <span className="cb-brand"><span className="cb-logo"><BMark size={18} /></span>TradeMind Assistant</span>
        </header>

        <div className="ap-scroll" aria-live="polite">
          <div className="ap-column">
            {showMemory
              ? <MemoryList a={a} />
              : <Messages a={a} />}
          </div>
        </div>

        <div className="ap-composer">
          <Composer a={a} autoFocus />
          <p className="ap-foot">Analysis and education only, not investment advice.</p>
        </div>
      </main>
    </div>
  );
}
