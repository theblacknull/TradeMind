import { useCallback, useEffect, useState } from 'react';
import {
  API, FALLBACK_MODELS, MAX_FILES, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, TEXT_EXT, load, save, readFile, getClientId,
} from './AssistantParts';

const STORE = {
  convs: 'trademind.convs.v1',
  active: 'trademind.active.v1',
  memory: 'trademind.memory.v1',
};
const MAX_CONVS = 30;
const MAX_MSGS = 40;

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const titleOf = (text) => (text.trim().replace(/\s+/g, ' ').slice(0, 42) || 'New chat');

/**
 * Shared chat state for the quick bubble and the full-page assistant.
 * Conversations, memory facts and saved reports live in this browser only (local-first).
 */
export default function useAssistant() {
  const [convs, setConvs] = useState(() => load(STORE.convs, []));
  const [activeId, setActiveId] = useState(() => load(STORE.active, null));
  const [memory, setMemory] = useState(() => load(STORE.memory, []));
  const [savedList, setSavedList] = useState([]);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [model, setModel] = useState(FALLBACK_MODELS[0].id);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const [fileNote, setFileNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [speaking, setSpeaking] = useState(null);

  const active = convs.find((c) => c.id === activeId) || null;
  const messages = active ? active.messages : [];

  useEffect(() => {
    fetch(`${API}/models`).then((r) => r.json()).then((d) => {
      if (Array.isArray(d?.data?.message) && d.data.message.length) setModels(d.data.message);
    }).catch(() => {});
  }, []);

  // Persist without attachment payloads, which can be large.
  useEffect(() => {
    save(STORE.convs, convs.slice(0, MAX_CONVS).map((c) => ({
      ...c,
      messages: c.messages.slice(-MAX_MSGS).map((m) => ({
        ...m, attachments: m.attachments?.map((a) => ({ name: a.name, kind: a.kind })),
      })),
    })));
  }, [convs]);
  useEffect(() => { save(STORE.active, activeId); }, [activeId]);
  useEffect(() => { save(STORE.memory, memory); }, [memory]);

  const newChat = useCallback(() => { setActiveId(null); setDraft(''); setFiles([]); setFileNote(''); }, []);
  const openConv = useCallback((id) => { setActiveId(id); setFileNote(''); }, []);
  const removeConv = useCallback((id) => {
    setConvs((cur) => cur.filter((c) => c.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);
  /** Reports the server is keeping for this browser (valid for 8 hours). */
  const loadSaved = useCallback(() => {
    fetch(`${API}/memory/reports`, { headers: { 'X-Client-Id': getClientId() } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.data?.message)) setSavedList(d.data.message); })
      .catch(() => {});
  }, []);
  const forgetReport = useCallback((key) => {
    fetch(`${API}/memory/reports/${encodeURIComponent(key)}`, { method: 'DELETE', headers: { 'X-Client-Id': getClientId() } })
      .then(loadSaved).catch(() => {});
  }, [loadSaved]);

  const addFiles = async (list) => {
    setFileNote('');
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) { setFileNote(`Up to ${MAX_FILES} files per message.`); break; }
      const isImg = /^image\/(png|jpe?g|webp|gif)$/.test(f.type);
      const isText = f.type.startsWith('text/') || f.type === 'application/json' || TEXT_EXT.test(f.name);
      if (!isImg && !isText) { setFileNote(`${f.name}: only images and text, CSV or JSON files are supported.`); continue; }
      if (isImg && f.size > MAX_IMAGE_BYTES) { setFileNote(`${f.name} is larger than 3 MB.`); continue; }
      if (isText && f.size > MAX_TEXT_BYTES) { setFileNote(`${f.name} is larger than 300 KB.`); continue; }
      try { next.push(await readFile(f)); } catch (e) { setFileNote(`Could not read ${f.name}.`); }
    }
    setFiles(next);
  };

  /** Read the server's event stream and hand each event to a handler. */
  const streamChat = async (body, handlers) => {
    const res = await fetch(`${API}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) throw new Error('stream unavailable');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i = buf.indexOf('\n\n');
      while (i >= 0) {
        const ev = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m = ev.match(/^event: (.*)\ndata: ([\s\S]*)$/);
        if (m) handlers[m[1]]?.(JSON.parse(m[2]));
        i = buf.indexOf('\n\n');
      }
    }
  };

  const send = async (override) => {
    const text = (override ?? draft).trim();
    if ((!text && files.length === 0) || busy) return;

    const userMsg = {
      role: 'user',
      content: text,
      attachments: files.map((f) => ({ name: f.name, kind: f.kind, text: f.text, dataUrl: f.dataUrl })),
    };

    let id = activeId;
    const history = [...messages, userMsg];
    if (!active) {
      id = newId();
      setConvs((cur) => [{ id, title: titleOf(text || files[0]?.name || ''), updatedAt: Date.now(), messages: [userMsg] }, ...cur]);
      setActiveId(id);
    } else {
      setConvs((cur) => cur.map((c) => (c.id === id
        ? { ...c, updatedAt: Date.now(), messages: [...c.messages, userMsg] } : c)));
    }

    setDraft('');
    setFiles([]);
    setFileNote('');

    setBusy(true);
    setStatus('Thinking...');

    const reply = { role: 'assistant', content: '', reports: [] };
    let placed = false;
    const commit = () => {
      const snapshot = { ...reply, reports: [...reply.reports] };
      setConvs((cur) => cur.map((c) => {
        if (c.id !== id) return c;
        const msgs = placed ? c.messages.slice(0, -1) : c.messages;
        return { ...c, updatedAt: Date.now(), messages: [...msgs, snapshot] };
      }));
      placed = true;
    };

    const body = {
      model,
      memory,
      messages: history.slice(-12).map((m) => ({ role: m.role, content: m.content, attachments: m.attachments })),
    };

    try {
      await streamChat(body, {
        status: (d) => setStatus(d.text),
        report: (r) => { reply.reports.push(r); commit(); },
        text: (d) => { reply.content = d.text; commit(); },
        memory: (d) => setMemory((cur) => [...new Set([...cur, d.fact])].slice(-20)),
        error: (d) => { reply.content = d.message; commit(); },
        done: (d) => { reply.model = d.model; },
      });
    } catch (e) {
      if (!reply.content) reply.content = 'Sorry, I could not reach the assistant. Please try again.';
    }
    if (!placed || reply.content) commit();

    setStatus('');
    setBusy(false);
  };

  /** Ask for fresh data on a report that was served from memory. */
  const refreshReport = (report) => {
    const q = report.type === 'wallet'
      ? `Refresh the analysis of wallet ${report.address} with the latest data`
      : `Refresh the analysis of ${report.assets[0].symbol} with the latest data`;
    send(q);
  };

  const speak = (key, text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (speaking === key) { setSpeaking(null); return; }
    const u = new SpeechSynthesisUtterance(String(text).replace(/\*\*/g, ''));
    u.onend = () => setSpeaking(null);
    setSpeaking(key);
    window.speechSynthesis.speak(u);
  };

  return {
    convs, active, activeId, messages, memory, setMemory, savedList, loadSaved, forgetReport, refreshReport,
    models, model, setModel, draft, setDraft, files, setFiles, fileNote, addFiles,
    busy, status, send, speaking, speak, newChat, openConv, removeConv,
  };
}
