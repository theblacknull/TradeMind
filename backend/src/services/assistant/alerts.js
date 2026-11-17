/**
 * M6 - Alert rules (demo). Evaluated whenever a report is built.
 * Delivery to Telegram / messages is not connected; here alerts are listed inside the report.
 */
const LEVEL = { critical: 3, warning: 2, info: 1 };

function evaluate(report, news, forecast) {
  const out = [];
  const add = (level, text) => out.push({ level, text });

  for (const a of report.assets) {
    const c = a.change || {};
    if (c.d1 != null && Math.abs(c.d1) >= 8) add('warning', `${a.symbol} moved ${c.d1 > 0 ? '+' : ''}${c.d1}% in 24h.`);
    if (c.d7 != null && Math.abs(c.d7) >= 20) add('warning', `${a.symbol} moved ${c.d7 > 0 ? '+' : ''}${c.d7}% in 7 days.`);
    if (a.metrics && a.metrics.maxDrawdownPct <= -40) add('warning', `${a.symbol} drew down ${a.metrics.maxDrawdownPct}% from its recent peak.`);
    if (a.holding?.sharePct >= 60) add('warning', `${a.symbol} is ${a.holding.sharePct}% of the portfolio: high concentration.`);
  }

  const eq = report.equity;
  if (eq?.params?.maxDrawdownPct <= -25) {
    add('warning', `Portfolio equity drew down ${eq.params.maxDrawdownPct}% over ${eq.days} days.`);
  }

  const watched = new Set(report.assets.map((a) => a.symbol));
  for (const n of news?.items || []) {
    if (n.asset && watched.has(n.asset) && n.category === 'security') {
      add('critical', `Security-related headline about ${n.asset}: "${n.title}"`);
    } else if (n.asset && watched.has(n.asset) && (n.category === 'regulatory' || n.category === 'team')) {
      add('warning', `${n.category === 'team' ? 'Team' : 'Regulatory'} headline about ${n.asset}: "${n.title}"`);
    }
  }

  if (forecast?.sector.direction === 'down' && forecast.sector.probUpPct <= 35) {
    add('info', 'Sector trend (BTC/ETH/SOL) leans down over the next 7 days in the demo model.');
  }

  out.sort((a, b) => LEVEL[b.level] - LEVEL[a.level]);
  return {
    items: out.slice(0, 8),
    delivery: 'Telegram / message delivery is not connected yet (demo).',
  };
}

module.exports = { evaluate };
