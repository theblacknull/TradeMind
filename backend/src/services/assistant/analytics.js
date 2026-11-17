/**
 * M2 - Analytics module. Pure functions over a daily price series (oldest first).
 * Deterministic, so the LLM only explains numbers and never produces them.
 */
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const pct = (a, b) => (a && b ? (a / b - 1) * 100 : null);
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(d));

function analyze(prices) {
  if (!Array.isArray(prices) || prices.length < 8) return null;
  const clean = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (clean.length < 8) return null;

  const returns = clean.slice(1).map((p, i) => p / clean[i] - 1);
  const sd = std(returns);

  let peak = clean[0];
  let maxDd = 0;
  for (const p of clean) {
    peak = Math.max(peak, p);
    maxDd = Math.min(maxDd, p / peak - 1);
  }

  const n = clean.length;
  const last = clean[n - 1];
  const days = n - 1;

  return {
    windowDays: days,
    volatilityAnnualPct: round(sd * Math.sqrt(365) * 100, 1),
    maxDrawdownPct: round(maxDd * 100, 1),
    sharpe: sd > 0 ? round((mean(returns) / sd) * Math.sqrt(365), 2) : null,
    profitPerDayPct: round(((last / clean[0] - 1) * 100) / days, 3),
    returnWindowPct: round(pct(last, clean[0]), 1),
    change: {
      d1: round(pct(last, clean[n - 2]), 2),
      d7: round(pct(last, clean[Math.max(0, n - 8)]), 2),
      d30: round(pct(last, clean[Math.max(0, n - 31)]), 2),
    },
  };
}

/** Plain risk label from annualised volatility and drawdown. */
function riskLevel(m) {
  if (!m) return 'unknown';
  if (m.volatilityAnnualPct >= 90 || m.maxDrawdownPct <= -45) return 'high';
  if (m.volatilityAnnualPct >= 50 || m.maxDrawdownPct <= -25) return 'medium';
  return 'low';
}

/**
 * Equity curve of the current holdings valued at historical prices ("back-cast").
 * items: [{ symbol, amount, series: [[ts, price], ...] }], totalValueUsd: portfolio value today.
 * The window is as many days as the data allows, so a shorter history shows fewer days.
 */
function buildEquity(items, totalValueUsd) {
  const usable = items.filter((i) => Array.isArray(i.series) && i.series.length >= 8);
  if (!usable.length) return null;

  const valueNow = (i) => i.amount * i.series[i.series.length - 1][1];
  const big = usable.filter((i) => valueNow(i) >= 0.05 * usable.reduce((s, x) => s + valueNow(x), 0));
  const days = Math.min(...(big.length ? big : usable).map((i) => i.series.length));
  const included = usable.filter((i) => i.series.length >= days).sort((a, b) => valueNow(b) - valueNow(a));
  if (days < 8 || !included.length) return null;

  const tail = (i) => i.series.slice(-days);
  const dates = tail(included[0]).map((p) => p[0]);
  const perAsset = included.map((i) => ({ symbol: i.symbol, values: tail(i).map((p) => round(p[1] * i.amount)) }));
  const total = dates.map((_, k) => round(perAsset.reduce((s, a) => s + a.values[k], 0)));

  const m = analyze(total);
  const rets = total.slice(1).map((v, k) => v / total[k] - 1);
  const coveredNow = included.reduce((s, i) => s + valueNow(i), 0);

  const TOP = 5;
  const top = perAsset.slice(0, TOP);
  const rest = perAsset.slice(TOP);
  const series = rest.length
    ? [...top, { symbol: 'Other', values: dates.map((_, k) => round(rest.reduce((s, a) => s + a.values[k], 0))) }]
    : top;

  return {
    days: dates.length,
    dates,
    total,
    series,
    coveragePct: totalValueUsd ? round((coveredNow / totalValueUsd) * 100, 1) : null,
    excluded: usable.length - included.length,
    params: {
      startUsd: total[0],
      endUsd: total[total.length - 1],
      changeUsd: round(total[total.length - 1] - total[0]),
      returnPct: m?.returnWindowPct ?? null,
      profitPerDayUsd: round((total[total.length - 1] - total[0]) / (dates.length - 1)),
      profitPerDayPct: m?.profitPerDayPct ?? null,
      maxDrawdownPct: m?.maxDrawdownPct ?? null,
      volatilityAnnualPct: m?.volatilityAnnualPct ?? null,
      sharpe: m?.sharpe ?? null,
      bestDayPct: round(Math.max(...rets) * 100, 1),
      worstDayPct: round(Math.min(...rets) * 100, 1),
    },
  };
}

module.exports = { analyze, riskLevel, round, buildEquity };
