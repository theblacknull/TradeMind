/**
 * M5 - Report module. These are the tools the AI model calls.
 * Every number comes from M1 (data), M2 (analytics), M3 (forecast) and M4 (news), never from the model.
 */
const {
  searchCoin, getCoinMarket, getHistoryById, getHistoryByContract, getWallet, isStable,
} = require('./marketData');
const { analyze, riskLevel, round, buildEquity } = require('./analytics');
const { forecastSeries, sectorForecast } = require('./forecast');
const { newsFor } = require('./news');
const { evaluate } = require('./alerts');
const store = require('./memoryStore');

const KNOWN = {
  btc: 'bitcoin', bitcoin: 'bitcoin', eth: 'ethereum', ethereum: 'ethereum', sol: 'solana', solana: 'solana',
  bnb: 'binancecoin', xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', avax: 'avalanche-2', link: 'chainlink',
  dot: 'polkadot', ltc: 'litecoin', atom: 'cosmos', uni: 'uniswap', trx: 'tron', ton: 'the-open-network',
  near: 'near', arb: 'arbitrum', op: 'optimism', sui: 'sui', apt: 'aptos', usdt: 'tether', usdc: 'usd-coin',
};

const DISCLAIMER = 'Information and analysis only, not investment advice. Data may be delayed.';
const closes = (series) => (series ? series.map((p) => p[1]) : null);

/** Start M3 (sector view) and M4 (news) early so they run while price history loads. */
function startSide(assets) {
  return Promise.all([
    sectorForecast().catch(() => null),
    newsFor(assets.slice(0, 5).map((a) => ({ symbol: a.symbol, name: a.name }))).catch(() => null),
  ]);
}

/** M6 alerts on top of a finished report. Failures in these optional modules never break the report. */
async function enrich(report, side) {
  const [forecast, news] = await (side || startSide(report.assets));
  report.forecast = forecast;
  report.news = news;
  report.alerts = evaluate(report, news, forecast);
  return report;
}

async function assetReport(input, progress = () => {}) {
  const key = String(input || '').trim().toLowerCase();
  if (!key) throw new Error('Asset symbol is required');
  const id = KNOWN[key] || (await searchCoin(key));
  if (!id) throw new Error(`Could not find an asset matching "${input}"`);

  progress(`Fetching market data for ${key.toUpperCase()}...`);
  const [market, series] = await Promise.all([getCoinMarket(id), getHistoryById(id, 90).catch(() => null)]);
  const prices = closes(series);
  const metrics = analyze(prices);

  progress('Checking trend, news and alerts...');
  return enrich({
    type: 'asset',
    memoryKey: `asset:${id}`,
    title: `${market.name} (${market.symbol})`,
    generatedAt: new Date().toISOString(),
    sources: ['CoinGecko', 'RSS news'],
    assets: [{
      symbol: market.symbol,
      name: market.name,
      priceUsd: market.priceUsd,
      rank: market.rank,
      marketCapUsd: market.marketCapUsd,
      athChangePct: round(market.athChangePct, 1),
      change: {
        d1: round(market.change.d1), d7: round(market.change.d7), d30: round(market.change.d30),
      },
      metrics,
      forecast: prices ? forecastSeries(prices) : null,
      risk: riskLevel(metrics),
    }],
    disclaimer: DISCLAIMER,
  });
}

async function walletReport(address, progress = () => {}) {
  const a = String(address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) throw new Error('A valid Ethereum address (0x...) is required');

  progress('Reading wallet balances...');
  const w = await getWallet(a);

  const holdings = [];
  if (w.ethBalance > 0) {
    holdings.push({
      symbol: 'ETH', name: 'Ethereum', amount: w.ethBalance, priceUsd: w.ethPriceUsd,
      valueUsd: w.ethPriceUsd ? w.ethBalance * w.ethPriceUsd : null, coingeckoId: 'ethereum',
    });
  }
  const priced = w.tokens.filter((t) => t.valueUsd && t.valueUsd >= 1).sort((x, y) => y.valueUsd - x.valueUsd);
  const unpriced = w.tokens.length - priced.length;
  priced.forEach((t) => holdings.push({ ...t }));

  holdings.sort((x, y) => (y.valueUsd || 0) - (x.valueUsd || 0));
  const totalUsd = holdings.reduce((s, h) => s + (h.valueUsd || 0), 0);

  // Deep analysis for the largest positions only, to keep API usage small.
  const TOP = 5;
  const deepList = holdings.slice(0, TOP);
  const side = startSide(holdings.map((h) => ({ symbol: h.symbol, name: h.name })));
  progress(`Analyzing price history of ${deepList.length} assets...`);
  const histories = await Promise.all(deepList.map((h) => (h.coingeckoId
    ? getHistoryById(h.coingeckoId, 90)
    : getHistoryByContract(h.contract, 90)).catch(() => null)));

  const assets = [];
  const equityInputs = [];
  holdings.forEach((h, i) => {
    const series = i < TOP ? histories[i] : null;
    const metrics = analyze(closes(series));
    const forecast = series ? forecastSeries(closes(series)) : null;
    if (series) equityInputs.push({ symbol: h.symbol, amount: h.amount, series });
    assets.push({
      symbol: h.symbol,
      name: h.name,
      priceUsd: h.priceUsd,
      holding: {
        amount: round(h.amount, 6),
        valueUsd: round(h.valueUsd),
        sharePct: totalUsd ? round(((h.valueUsd || 0) / totalUsd) * 100, 1) : null,
      },
      change: metrics?.change || null,
      metrics,
      forecast,
      risk: riskLevel(metrics),
      analyzed: i < TOP,
      stable: isStable(h.contract),
    });
  });

  const equity = buildEquity(equityInputs, totalUsd);

  // Keep the report readable: the largest positions get their own entry, the rest are rolled up.
  const SHOWN = 8;
  const rest = assets.slice(SHOWN);
  assets.length = Math.min(assets.length, SHOWN);

  return enrich({
    type: 'wallet',
    memoryKey: `wallet:${a.toLowerCase()}`,
    title: w.ens || `${a.slice(0, 6)}...${a.slice(-4)}`,
    address: a,
    generatedAt: new Date().toISOString(),
    sources: ['CoinGecko', 'Ethplorer (Ethereum mainnet)', 'Binance', 'RSS news'],
    summary: {
      totalUsd: round(totalUsd),
      assetsCount: assets.length + rest.length,
      otherAssets: {
        count: rest.length,
        valueUsd: round(rest.reduce((s, x) => s + (x.holding.valueUsd || 0), 0)),
      },
      unpricedTokens: unpriced,
      txCount: w.txCount,
      tokenTransfers: w.transferCount,
      topSharePct: assets[0]?.holding.sharePct ?? null,
    },
    equity,
    assets,
    disclaimer: DISCLAIMER,
  }, side);
}

/** Compact version handed back to the model: no chart arrays, no headline text (untrusted). */
function forModel(report) {
  const copy = JSON.parse(JSON.stringify(report, (k, v) => (
    ['sources', 'disclaimer', 'dates', 'total', 'series', 'news'].includes(k) ? undefined : v
  )));
  copy.newsHeadlines = report.news?.items?.length || 0;
  if (report.cache) copy.fromMemoryMinutesAgo = Math.round((Date.now() - report.cache.savedAt) / 60000);
  // A shorter payload makes the commentary noticeably faster.
  if (copy.assets.length > 6) copy.assets = copy.assets.slice(0, 6);
  if (copy.forecast?.leaders) copy.forecast.leaders.forEach((l) => { delete l.backtest; });
  return copy;
}

const REFRESH = {
  type: 'boolean',
  description: 'True only if the user asks to refresh, update or get the latest data. Otherwise a report saved in the last 8 hours is reused.',
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'analyze_asset',
      description: 'Report for one crypto asset: price, 24h/7d/30d change, 90-day volatility, max drawdown, Sharpe, profit per day, risk, short-term trend, news and alerts. Reuses a report saved in memory within 8 hours. Use for requests like "analyze BTC".',
      parameters: {
        type: 'object',
        properties: { symbol: { type: 'string', description: 'Ticker or name, e.g. BTC, ETH, SOL' }, refresh: REFRESH },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_wallet',
      description: 'Analyze an Ethereum wallet: portfolio equity curve with parameters plus one entry per asset held, news and alerts. Reuses a report saved in memory within 8 hours.',
      parameters: {
        type: 'object',
        properties: { address: { type: 'string', description: 'Ethereum address starting with 0x' }, refresh: REFRESH },
        required: ['address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_report',
      description: 'Memory lookup. With a subject (wallet address or asset) returns the report saved in the last 8 hours, if any. With no subject lists everything saved. Use when the user asks what you have saved or wants to see an earlier report.',
      parameters: {
        type: 'object',
        properties: { subject: { type: 'string', description: 'Wallet address or asset ticker. Omit to list all saved reports.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Save a durable fact about the user (risk appetite, goals, preferred assets, language, holding period) so future chats can use it. Only save things the user stated about themselves.',
      parameters: {
        type: 'object',
        properties: { fact: { type: 'string', description: 'One short sentence about the user' } },
        required: ['fact'],
      },
    },
  },
];

/** Memory key for a subject the user named: wallet address or asset. */
async function subjectKey(subject) {
  const t = String(subject || '').trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return `wallet:${t.toLowerCase()}`;
  const k = t.toLowerCase();
  const id = KNOWN[k] || (k ? await searchCoin(k).catch(() => null) : null);
  return id ? `asset:${id}` : null;
}

const fresh = (clientId, key, refresh) => (refresh ? null : store.get(clientId, key));
const cachedResult = (e) => ({
  report: { ...e.report, cache: { savedAt: e.savedAt, key: e.key } },
  memoryKey: e.key,
  cached: { savedAt: e.savedAt, text: e.text || '' },
});

async function liveResult(report, clientId) {
  const entry = { kind: report.type, title: report.title, report, text: '' };
  store.put(clientId, report.memoryKey, entry);
  return { report, memoryKey: report.memoryKey };
}

/**
 * Returns { report, memoryKey, cached? } for report tools, { memory } for remember,
 * and { list } or { report... } for recall_report.
 */
async function runTool(name, args, progress, ctx = {}) {
  const { clientId } = ctx;

  if (name === 'analyze_asset') {
    const key = await subjectKey(args.symbol);
    const hit = key && fresh(clientId, key, args.refresh);
    if (hit) return cachedResult(hit);
    return liveResult(await assetReport(args.symbol, progress), clientId);
  }

  if (name === 'analyze_wallet') {
    const key = await subjectKey(args.address);
    const hit = key && fresh(clientId, key, args.refresh);
    if (hit) return cachedResult(hit);
    return liveResult(await walletReport(args.address, progress), clientId);
  }

  if (name === 'recall_report') {
    if (!String(args.subject || '').trim()) {
      return { list: store.list(clientId) };
    }
    const key = await subjectKey(args.subject);
    const hit = key && store.get(clientId, key);
    return hit ? cachedResult(hit) : { notFound: true };
  }

  if (name === 'remember') {
    const fact = String(args.fact || '').trim().slice(0, 200);
    if (!fact) throw new Error('Nothing to remember');
    return { memory: fact };
  }
  throw new Error(`Unknown tool ${name}`);
}

module.exports = { TOOLS, runTool, forModel };
