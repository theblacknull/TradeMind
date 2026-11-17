/**
 * M3 - Short-term trend forecast (DEMO baseline).
 * The trained DDRN model is not part of this build. This stand-in blends momentum and
 * mean reversion on daily closes so the report layout, API and backtest display are in place.
 * Replace `forecastSeries` with the DDRN inference call later; the output shape stays the same.
 */
const { getHistoryById } = require('./marketData');

const HORIZON = 7;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const logistic = (z) => 1 / (1 + Math.exp(-z));

/** Probability that price is higher after HORIZON days, using only data up to index t. */
function signalAt(p, t) {
  const win = p.slice(Math.max(0, t - 30), t + 1);
  if (win.length < 15) return null;
  const rets = win.slice(1).map((x, i) => x / win[i] - 1);
  const sd = std(rets) || 1e-9;
  const mom = mean(rets.slice(-7)) / sd * Math.sqrt(7);
  const dev = (p[t] - mean(win)) / (std(win) || 1e-9);
  return logistic(0.9 * mom - 0.35 * dev);
}

function forecastSeries(prices) {
  const p = prices.filter((x) => Number.isFinite(x) && x > 0);
  if (p.length < 40) return null;

  const probUp = signalAt(p, p.length - 1);

  // Walk-forward: how often did the signal call the sign of the next HORIZON-day move?
  let hit = 0; let base = 0; let n = 0;
  for (let t = 30; t < p.length - HORIZON; t += 1) {
    const s = signalAt(p, t);
    if (s == null) continue;
    const fwd = p[t + HORIZON] / p[t] - 1;
    const prev = p[t] / p[t - HORIZON] - 1;
    n += 1;
    if ((s > 0.5) === (fwd > 0)) hit += 1;
    if ((prev > 0) === (fwd > 0)) base += 1; // baseline: "the last move continues"
  }

  const dir = probUp >= 0.58 ? 'up' : probUp <= 0.42 ? 'down' : 'sideways';
  return {
    horizonDays: HORIZON,
    direction: dir,
    probUpPct: +(probUp * 100).toFixed(0),
    confidence: Math.abs(probUp - 0.5) >= 0.2 ? 'higher' : Math.abs(probUp - 0.5) >= 0.08 ? 'medium' : 'low',
    backtest: n ? {
      samples: n,
      hitRatePct: +((hit / n) * 100).toFixed(0),
      baselineHitRatePct: +((base / n) * 100).toFixed(0),
    } : null,
  };
}

const SECTOR = [
  { symbol: 'BTC', id: 'bitcoin' },
  { symbol: 'ETH', id: 'ethereum' },
  { symbol: 'SOL', id: 'solana' },
];

/** Sector view: BTC, ETH and SOL stand in for the whole market, as in the architecture doc. */
let sectorCache = { at: 0, value: null };
const SECTOR_TTL = 30 * 60 * 1000;

async function sectorForecast() {
  if (sectorCache.value && Date.now() - sectorCache.at < SECTOR_TTL) return sectorCache.value;
  const value = await computeSector();
  if (value) sectorCache = { at: Date.now(), value };
  return value;
}

/** Warm the sector view in the background so reports do not wait for it. */
function prewarm() {
  const run = () => sectorForecast().catch(() => {});
  run();
  setInterval(run, 20 * 60 * 1000).unref();
}

async function computeSector() {
  const legs = [];
  for (const s of SECTOR) {
    const hist = await getHistoryById(s.id, 90).catch(() => null);
    const f = hist ? forecastSeries(hist.map((x) => x[1])) : null;
    if (f) legs.push({ symbol: s.symbol, ...f });
  }
  if (!legs.length) return null;
  const avg = legs.reduce((a, l) => a + l.probUpPct, 0) / legs.length;
  return {
    model: 'demo-baseline',
    note: 'Demo momentum / mean-reversion baseline. The trained DDRN model is not connected yet.',
    horizonDays: HORIZON,
    sector: {
      direction: avg >= 58 ? 'up' : avg <= 42 ? 'down' : 'sideways',
      probUpPct: Math.round(avg),
    },
    leaders: legs,
  };
}

module.exports = { forecastSeries, sectorForecast, prewarm };
