/**
 * M8 - Report memory (server side).
 * Every report is saved per anonymous client id and per subject (wallet address or asset), and is
 * reused for 8 hours. Stored in a small JSON file so it survives restarts; swap for a database
 * when accounts exist.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../../../data/memory-reports.json');
const TTL_MS = 8 * 60 * 60 * 1000;
const MAX_PER_CLIENT = 30;
const MAX_CLIENTS = 2000;

let db = { clients: {} };
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!db.clients) db = { clients: {} };
} catch (e) { /* first run: start empty */ }

let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error('Memory store write failed:', err.code || err.message);
    }
  }, 400);
  timer.unref?.();
}

const valid = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

function bucket(clientId, create = false) {
  if (!valid(clientId)) return null;
  if (!db.clients[clientId]) {
    if (!create) return null;
    const ids = Object.keys(db.clients);
    if (ids.length >= MAX_CLIENTS) delete db.clients[ids[0]];
    db.clients[clientId] = {};
  }
  return db.clients[clientId];
}

function prune(b) {
  const now = Date.now();
  Object.keys(b).forEach((k) => { if (now - b[k].savedAt > TTL_MS) delete b[k]; });
}

/** A saved report younger than 8 hours, or null. */
function get(clientId, key) {
  const b = bucket(clientId);
  if (!b) return null;
  prune(b);
  return b[key] || null;
}

function put(clientId, key, entry) {
  const b = bucket(clientId, true);
  if (!b) return;
  prune(b);
  b[key] = { ...entry, key, savedAt: Date.now() };
  const keep = Object.values(b).sort((x, y) => y.savedAt - x.savedAt).slice(0, MAX_PER_CLIENT);
  db.clients[clientId] = Object.fromEntries(keep.map((e) => [e.key, e]));
  persist();
}

function setText(clientId, key, text) {
  const e = get(clientId, key);
  if (e) { e.text = String(text).slice(0, 4000); persist(); }
}

function list(clientId) {
  const b = bucket(clientId);
  if (!b) return [];
  prune(b);
  return Object.values(b)
    .sort((x, y) => y.savedAt - x.savedAt)
    .map((e) => ({
      key: e.key, kind: e.kind, title: e.title, savedAt: e.savedAt, expiresAt: e.savedAt + TTL_MS,
    }));
}

function remove(clientId, key) {
  const b = bucket(clientId);
  if (b && b[key]) { delete b[key]; persist(); }
}

module.exports = { get, put, setText, list, remove, valid, TTL_MS };
