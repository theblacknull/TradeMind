import React, { useEffect, useRef, useState } from 'react';

const API = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/assistant";

const FALLBACK_MODELS = [
  { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b', label: 'Nemotron 3.5 120B', vision: true },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 550B', vision: false },
];

const MAX_FILES = 4;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_BYTES = 300 * 1024;
const TEXT_EXT = /\.(txt|csv|json|md|log|tsv)$/i;
const STORE = { chat: 'trademind.chat.v1', memory: 'trademind.memory.v1' };

/* local-first storage: never let a blocked or full store break the chat */
const load = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; }
};
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } };

/* anonymous id so the server can keep this browser's saved reports (no login needed) */
let memoryClientId = null;
const getClientId = () => {
  try {
    let id = localStorage.getItem('trademind.client.v1');
    if (!id) {
      id = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '');
      localStorage.setItem('trademind.client.v1', id);
    }
    return id;
  } catch (e) {
    if (!memoryClientId) memoryClientId = `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return memoryClientId;
  }
};

/* ---------- icons (one stroke style) ---------- */
const Svg = ({ children, size = 18, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);
const ReturnIcon = () => <Svg><path d="M20 4v7a4 4 0 0 1-4 4H4" /><path d="m9 10-5 5 5 5" /></Svg>;
const PlusIcon = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
const CloseIcon = () => <Svg><path d="m6 6 12 12M18 6 6 18" /></Svg>;
const ExpandIcon = () => <Svg size={16}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></Svg>;
const ShrinkIcon = () => <Svg size={16}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></Svg>;
const FileIcon = () => <Svg size={14}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Svg>;
const BrainIcon = () => <Svg size={16}><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1Z" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" /></Svg>;
const SpeakerIcon = () => <Svg size={15}><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></Svg>;
const TrashIcon = () => <Svg size={14}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>;

/* Bitcoin-style B mark: tilted B with two tick marks top and bottom. */
const BMark = ({ size = 28 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g transform="rotate(12 12 12)">
      <path d="M8.5 5.5v13" />
      <path d="M8.5 5.5h5a3.1 3.1 0 0 1 0 6.2h-5" />
      <path d="M8.5 11.7h5.8a3.4 3.4 0 0 1 0 6.8H8.5" />
      <path d="M11 3.2v2.3M14 3.2v2.3M11 18.5v2.3M14 18.5v2.3" />
    </g>
  </svg>
);

/* ---------- formatting ---------- */
const usd = (n) => {
  if (n == null) return 'n/a';
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return `${n < 0 ? '-' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d })}`;
};
const pct = (n) => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const tone = (n) => (n == null ? '' : n > 0 ? 'up' : n < 0 ? 'down' : '');
const day = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/* ---------- tiny safe markdown: **bold**, "- " lists ---------- */
function inline(text, key) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
      : part
  );
}
function RichText({ text }) {
  const lines = String(text || '').split('\n');
  const out = [];
  let list = [];
  const flush = (k) => { if (list.length) { out.push(<ul key={`u${k}`}>{list}</ul>); list = []; } };
  lines.forEach((ln, i) => {
    const m = ln.match(/^\s*[-*•]\s+(.*)$/);
    if (m) { list.push(<li key={i}>{inline(m[1], i)}</li>); return; }
    flush(i);
    if (ln.trim()) out.push(<p key={i}>{inline(ln.replace(/^#+\s*/, ''), i)}</p>);
  });
  flush('end');
  return <div className="cb-rich">{out}</div>;
}

/* ---------- report pieces ---------- */
const Metric = ({ label, value, cls }) => (
  <div className="rp-metric"><span>{label}</span><b className={cls}>{value}</b></div>
);

const PALETTE = ['#F9B64D', '#38bdf8', '#a78bfa', '#fb7185', '#34d399', '#94a3b8'];

/* Stacked equity chart: one band per asset, bold line for the total. */
function EquityChart({ eq }) {
  const [hover, setHover] = useState(null);
  const W = 640; const H = 220; const padL = 8; const padR = 8; const padT = 12; const padB = 22;
  const n = eq.total.length;
  const max = Math.max(...eq.total) * 1.04;
  const min = 0;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);

  const cum = eq.series.map(() => new Array(n).fill(0));
  eq.series.forEach((s, si) => {
    for (let i = 0; i < n; i += 1) cum[si][i] = (si ? cum[si - 1][i] : 0) + s.values[i];
  });
  const band = (si) => {
    const top = cum[si].map((v, i) => `${x(i)},${y(v)}`);
    const bottom = (si ? cum[si - 1] : new Array(n).fill(0)).map((v, i) => `${x(i)},${y(v)}`).reverse();
    return `M${top.join('L')}L${bottom.join('L')}Z`;
  };
  const line = eq.total.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((rel * W - padL) / (W - padL - padR)) * (n - 1)))));
  };

  const p = eq.params;
  const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);

  return (
    <div className="eq">
      <div className="eq-head">
        <h4>Portfolio equity <small>{eq.days} days</small></h4>
        <span className="eq-note">Current holdings valued at past prices</span>
      </div>

      <div className="eq-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Portfolio equity over ${eq.days} days`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="eq-grid" />
              <text x={W - padR} y={y(t) - 3} textAnchor="end" className="eq-tick">{usd(Math.round(t))}</text>
            </g>
          ))}
          {eq.series.map((s, si) => (
            <path key={s.symbol} d={band(si)} fill={PALETTE[si % PALETTE.length]} fillOpacity="0.28" className="eq-band" />
          ))}
          <path d={line} className="eq-line" />
          <text x={padL} y={H - 5} className="eq-tick">{day(eq.dates[0])}</text>
          <text x={W - padR} y={H - 5} textAnchor="end" className="eq-tick">{day(eq.dates[n - 1])}</text>
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="eq-cross" />
              <circle cx={x(hover)} cy={y(eq.total[hover])} r="4" className="eq-dot" />
            </g>
          )}
        </svg>
        {hover != null && (
          <div className="eq-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{day(eq.dates[hover])}</b>
            <span>Total {usd(eq.total[hover])}</span>
            {eq.series.map((s, si) => (
              <span key={s.symbol}><i style={{ background: PALETTE[si % PALETTE.length] }} />{s.symbol} {usd(s.values[hover])}</span>
            ))}
          </div>
        )}
      </div>

      <div className="eq-legend">
        {eq.series.map((s, si) => (
          <span key={s.symbol}><i style={{ background: PALETTE[si % PALETTE.length] }} />{s.symbol}</span>
        ))}
      </div>

      <div className="eq-params">
        <Metric label="Start → end" value={`${usd(p.startUsd)} → ${usd(p.endUsd)}`} />
        <Metric label={`Return (${eq.days}d)`} value={pct(p.returnPct)} cls={tone(p.returnPct)} />
        <Metric label="Profit / day" value={`${usd(p.profitPerDayUsd)} (${p.profitPerDayPct}%)`} cls={tone(p.profitPerDayUsd)} />
        <Metric label="Max drawdown" value={`${p.maxDrawdownPct}%`} cls="down" />
        <Metric label="Volatility (yr)" value={`${p.volatilityAnnualPct}%`} />
        <Metric label="Sharpe" value={p.sharpe ?? 'n/a'} cls={tone(p.sharpe)} />
        <Metric label="Best day" value={pct(p.bestDayPct)} cls="up" />
        <Metric label="Worst day" value={pct(p.worstDayPct)} cls="down" />
      </div>
      <p className="rp-note">
        Covers {eq.coveragePct}% of the wallet value with price history{eq.excluded ? `; ${eq.excluded} asset(s) with a shorter history were left out` : ''}.
      </p>
    </div>
  );
}

const TREND_LABEL = { up: 'Up', down: 'Down', sideways: 'Sideways' };

function AssetCard({ a, wallet }) {
  const m = a.metrics;
  const ch = a.change || {};
  const f = a.forecast;
  return (
    <article className="rp-card">
      <header className="rp-card-head">
        <div>
          <h4>{a.symbol} <small>{a.name}</small></h4>
          <p className="rp-price">{usd(a.priceUsd)}</p>
        </div>
        <span className={`rp-risk ${a.risk}`}>{a.risk === 'unknown' ? 'not analyzed' : `${a.risk} risk`}</span>
      </header>

      {wallet && a.holding && (
        <div className="rp-holding">
          <div className="rp-holding-row">
            <span>{a.holding.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} {a.symbol}</span>
            <b>{usd(a.holding.valueUsd)}</b>
          </div>
          <div className="rp-bar" aria-label={`${a.holding.sharePct}% of portfolio`}>
            <i style={{ width: `${Math.min(100, a.holding.sharePct || 0)}%` }} />
          </div>
          <span className="rp-share">{a.holding.sharePct}% of portfolio</span>
        </div>
      )}

      {(ch.d1 != null || ch.d7 != null || ch.d30 != null) && (
        <div className="rp-changes">
          <Metric label="24h" value={pct(ch.d1)} cls={tone(ch.d1)} />
          <Metric label="7d" value={pct(ch.d7)} cls={tone(ch.d7)} />
          <Metric label="30d" value={pct(ch.d30)} cls={tone(ch.d30)} />
        </div>
      )}

      {m ? (
        <div className="rp-grid">
          <Metric label="Volatility (yr)" value={`${m.volatilityAnnualPct}%`} />
          <Metric label="Max drawdown" value={`${m.maxDrawdownPct}%`} cls="down" />
          <Metric label="Sharpe" value={m.sharpe ?? 'n/a'} cls={tone(m.sharpe)} />
          <Metric label="Profit / day" value={`${m.profitPerDayPct}%`} cls={tone(m.profitPerDayPct)} />
        </div>
      ) : (
        <p className="rp-note">{a.analyzed === false ? 'Smaller position, price history not analyzed.' : 'Price history unavailable.'}</p>
      )}

      {a.stable && <p className="rp-note">Stablecoin: price history is assumed pegged at $1.</p>}

      {f && (
        <p className={`rp-trend ${f.direction}`}>
          7-day trend (demo): <b>{TREND_LABEL[f.direction]}</b> · {f.probUpPct}% chance up
        </p>
      )}
    </article>
  );
}

function Alerts({ alerts }) {
  if (!alerts?.items?.length) return null;
  return (
    <div className="rp-section">
      <h4>Alerts</h4>
      <ul className="rp-alerts">
        {alerts.items.map((x, i) => <li key={i} className={x.level}><span>{x.level}</span>{x.text}</li>)}
      </ul>
      <p className="rp-note">{alerts.delivery}</p>
    </div>
  );
}

function Forecast({ f }) {
  if (!f) return null;
  return (
    <div className="rp-section">
      <h4>Short-term outlook <small>{f.horizonDays} days · demo model</small></h4>
      <div className="rp-leaders">
        <div className={`rp-lead sector ${f.sector.direction}`}>
          <span>Sector (BTC, ETH, SOL)</span>
          <b>{TREND_LABEL[f.sector.direction]}</b>
          <em>{f.sector.probUpPct}% up</em>
        </div>
        {f.leaders.map((l) => (
          <div key={l.symbol} className={`rp-lead ${l.direction}`}>
            <span>{l.symbol}</span>
            <b>{TREND_LABEL[l.direction]}</b>
            <em>{l.probUpPct}% up</em>
            {l.backtest && <small>hit {l.backtest.hitRatePct}% vs {l.backtest.baselineHitRatePct}% baseline · {l.backtest.samples} tests</small>}
          </div>
        ))}
      </div>
      <p className="rp-note">{f.note}</p>
    </div>
  );
}

function News({ n }) {
  if (!n?.items?.length) return null;
  return (
    <div className="rp-section">
      <h4>News <small>{n.matched ? 'about these assets' : 'general market'}</small></h4>
      <ul className="rp-news">
        {n.items.map((it, i) => (
          <li key={i}>
            <a href={it.link} target="_blank" rel="noopener noreferrer">{it.title}</a>
            <span>{it.source}{it.publishedAt ? ` · ${day(it.publishedAt)}` : ''} · <em className={`cat-${it.category}`}>{it.category}</em></span>
          </li>
        ))}
      </ul>
      <p className="rp-note">Source: {n.source}. {n.note}</p>
    </div>
  );
}

function Report({ r }) {
  const s = r.summary;
  return (
    <section className="rp">
      <header className="rp-head">
        <h3>{r.type === 'wallet' ? 'Wallet report' : 'Asset report'}: {r.title}</h3>
        <span>90-day window · {r.sources.join(', ')}</span>
      </header>

      {s && (
        <div className="rp-summary">
          <Metric label="Total value" value={usd(s.totalUsd)} />
          <Metric label="Assets" value={s.assetsCount} />
          <Metric label="Transactions" value={s.txCount ? s.txCount.toLocaleString('en-US') : 'n/a'} />
          <Metric label="Top holding" value={s.topSharePct != null ? `${s.topSharePct}%` : 'n/a'} />
        </div>
      )}

      {r.equity && <EquityChart eq={r.equity} />}
      <Alerts alerts={r.alerts} />

      <div className="rp-cards">
        {r.assets.map((a, i) => <AssetCard key={`${a.symbol}-${i}`} a={a} wallet={r.type === 'wallet'} />)}
      </div>

      {s?.otherAssets?.count > 0 && (
        <p className="rp-note">+ {s.otherAssets.count} smaller positions worth {usd(s.otherAssets.valueUsd)} in total
          {s.unpricedTokens ? `, and ${s.unpricedTokens} tokens without a market price (often spam)` : ''}.</p>
      )}
      {!s?.otherAssets?.count && s?.unpricedTokens > 0 && (
        <p className="rp-note">{s.unpricedTokens} tokens without a market price were left out (often spam).</p>
      )}

      <Forecast f={r.forecast} />
      <News n={r.news} />
      <p className="rp-foot">{r.disclaimer}</p>
    </section>
  );
}

/* ---------- attachments ---------- */
const readFile = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onerror = () => reject(new Error('read failed'));
  if (file.type.startsWith('image/')) {
    fr.onload = () => resolve({ name: file.name, kind: 'image', dataUrl: fr.result });
    fr.readAsDataURL(file);
  } else {
    fr.onload = () => resolve({ name: file.name, kind: 'text', text: String(fr.result) });
    fr.readAsText(file);
  }
});


export {
  API, FALLBACK_MODELS, MAX_FILES, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, TEXT_EXT, load, save,
  ReturnIcon, PlusIcon, CloseIcon, ExpandIcon, ShrinkIcon, FileIcon, BrainIcon, SpeakerIcon, TrashIcon, BMark,
  RichText, Report, readFile, day, getClientId,
};
