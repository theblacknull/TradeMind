import React, { useEffect, useRef } from 'react';
import {
  ReturnIcon, PlusIcon, FileIcon, SpeakerIcon, RichText, Report,
} from './AssistantParts';

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/** Conversation body shared by the bubble and the full-page assistant. */
export function Messages({ a, suggestions = true }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [a.messages, a.busy, a.activeId]);

  return (
    <>
      {a.messages.length === 0 && (
        <div className="cb-empty">
          <p>Ask anything about crypto. Try:</p>
          {suggestions && (
            <div className="cb-suggest">
              <button onClick={() => a.send('Analyze BTC for me')}>Analyze BTC</button>
              <button onClick={() => a.send('Analyze ETH for me')}>Analyze ETH</button>
              <button onClick={() => a.setDraft('Analyze wallet 0x')}>Analyze a wallet address</button>
            </div>
          )}
        </div>
      )}
      {a.messages.map((m, i) => {
        const key = `${a.activeId}-${i}`;
        return (
          <div key={key} className={`cb-msg ${m.role}`}>
            {m.role === 'user' ? (
              <>
                {m.content && <div className="cb-bubble">{m.content}</div>}
                {m.attachments?.length > 0 && (
                  <div className="cb-chips">
                    {m.attachments.map((f, j) => <span key={j} className="cb-chip"><FileIcon />{f.name}</span>)}
                  </div>
                )}
              </>
            ) : (
              <>
                <RichText text={m.content} />
                {m.reports?.map((r, j) => (
                  <React.Fragment key={j}>
                    {r.cache && (
                      <div className="cb-memtag">
                        <span>From memory · saved {ago(r.cache.savedAt)} · kept for 8 h</span>
                        <button onClick={() => a.refreshReport(r)} disabled={a.busy}>Refresh with live data</button>
                      </div>
                    )}
                    <Report r={r} />
                  </React.Fragment>
                ))}
                {'speechSynthesis' in window && (
                  <button className={`cb-read ${a.speaking === key ? 'on' : ''}`} onClick={() => a.speak(key, m.content)}
                    aria-label="Read aloud"><SpeakerIcon />{a.speaking === key ? 'Stop' : 'Read aloud'}</button>
                )}
              </>
            )}
          </div>
        );
      })}
      {a.busy && (
        <div className="cb-msg assistant cb-typing" aria-label="Assistant is working">
          <i /><i /><i />
          <span className="cb-wait">{a.status || 'Working...'}</span>
        </div>
      )}
      <div ref={endRef} />
    </>
  );
}

export function Composer({ a, autoFocus }) {
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const current = a.models.find((m) => m.id === a.model) || a.models[0];
  const hasImage = a.files.some((f) => f.kind === 'image');

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus, a.activeId]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); a.send(); }
  };

  return (
    <div className="cb-composer">
      {a.files.length > 0 && (
        <div className="cb-chips">
          {a.files.map((f, i) => (
            <span key={i} className="cb-chip">
              <FileIcon />{f.name}
              <button onClick={() => a.setFiles(a.files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        rows={1}
        placeholder="Type a message"
        value={a.draft}
        onChange={(e) => a.setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Message"
      />
      {(a.fileNote || (hasImage && !current.vision)) && (
        <p className="cb-hint">{a.fileNote || 'Images are read by Nemotron 3.5 120B, so it will answer this one.'}</p>
      )}
      <div className="cb-bar">
        <button className="cb-icon" type="button" onClick={() => fileRef.current?.click()} aria-label="Attach files">
          <PlusIcon />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept="image/png,image/jpeg,image/webp,image/gif,.txt,.csv,.tsv,.json,.md,.log,text/plain"
          onChange={(e) => { a.addFiles(e.target.files); e.target.value = ''; }}
        />
        <select value={a.model} onChange={(e) => a.setModel(e.target.value)} aria-label="Model">
          {a.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <span className="cb-spacer" />
        <button
          className="cb-send"
          type="button"
          onClick={() => a.send()}
          disabled={(!a.draft.trim() && a.files.length === 0) || a.busy}
          aria-label="Send message"
        >
          <ReturnIcon />
        </button>
      </div>
    </div>
  );
}

const left = (ts) => {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
};

export function MemoryList({ a, onClear }) {
  const { loadSaved } = a;
  useEffect(() => { loadSaved(); }, [loadSaved]);

  return (
    <div className="cb-memory">
      <h4>Saved reports</h4>
      <p className="rp-note">Reports are kept on the server for 8 hours, by wallet address or asset. Ask about the same one again and the saved report is reused.</p>
      {a.savedList.length === 0 && <p className="cb-empty-note">No reports saved yet.</p>}
      <ul>
        {a.savedList.map((e) => (
          <li key={e.key}>
            <span><b>{e.title}</b><br /><small>{e.kind} · saved {ago(e.savedAt)} · {left(e.expiresAt)}</small></span>
            <button onClick={() => a.forgetReport(e.key)} aria-label={`Forget ${e.title}`}>×</button>
          </li>
        ))}
      </ul>

      <h4 className="cb-memory-gap">What I remember about you</h4>
      <p className="rp-note">Stored only in this browser. Tell the assistant things like “I am a conservative investor” and it will save them.</p>
      {a.memory.length === 0 && <p className="cb-empty-note">Nothing saved yet.</p>}
      <ul>
        {a.memory.map((f, i) => (
          <li key={i}>
            <span>{f}</span>
            <button onClick={() => a.setMemory(a.memory.filter((_, j) => j !== i))} aria-label="Forget this">×</button>
          </li>
        ))}
      </ul>
      {onClear && <button className="cb-text-btn" onClick={onClear}>Clear conversation</button>}
    </div>
  );
}
