/**
 * M4 - News collector (demo).
 * Target design uses the paid X API. Until that is connected this module reads free RSS feeds,
 * filters by asset, and tags each headline so the alert module can react to security events.
 * Headlines are shown to the user but never passed to the language model as instructions.
 */
const axios = require('axios');

const FEEDS = [
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
];

const TTL = 10 * 60 * 1000;
let cache = { at: 0, items: [] };

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/<[^>]+>/g, '').trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};

const CATEGORIES = [
  ['security', /hack|exploit|drain|breach|stolen|rug ?pull|vulnerab|attack|scam/i],
  ['regulatory', /sec\b|lawsuit|ban\b|regulat|probe|investigat|sanction|etf|court/i],
  ['team', /resign|steps down|ceo|founder|layoff|arrest|charged/i],
  ['listing', /listing|lists|delist|launch|mainnet|upgrade|partnership/i],
];

const categorize = (title) => (CATEGORIES.find(([, re]) => re.test(title)) || ['market'])[0];

async function loadFeeds() {
  if (Date.now() - cache.at < TTL && cache.items.length) return cache.items;
  const all = [];
  await Promise.all(FEEDS.map(async (f) => {
    try {
      const res = await axios.get(f.url, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'text' });
      const items = String(res.data).split(/<item[ >]/i).slice(1, 41);
      items.forEach((it) => {
        const title = tag(it, 'title');
        const link = tag(it, 'link');
        const date = new Date(tag(it, 'pubDate'));
        if (title && /^https?:\/\//.test(link)) {
          all.push({
            title: title.slice(0, 180), link, source: f.name,
            publishedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
            category: categorize(title),
          });
        }
      });
    } catch (e) { /* one feed failing is fine */ }
  }));
  all.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  cache = { at: Date.now(), items: all };
  return all;
}

/** Latest headlines mentioning any of the given assets ({symbol, name}). */
async function newsFor(assets, limit = 6) {
  const items = await loadFeeds();
  const terms = assets.map((a) => ({
    symbol: a.symbol,
    re: new RegExp(`\\b(${a.name.replace(/[^a-z0-9 ]/gi, '')}|${a.symbol})\\b`, a.symbol.length <= 4 ? 'i' : 'i'),
  }));
  const out = [];
  for (const n of items) {
    const hit = terms.find((t) => t.re.test(n.title));
    if (hit) out.push({ ...n, asset: hit.symbol });
    if (out.length >= limit) break;
  }
  // Fall back to the general market feed when nothing mentions the assets.
  const general = out.length ? [] : items.slice(0, 4).map((n) => ({ ...n, asset: null }));
  return {
    source: 'RSS (Cointelegraph, Decrypt)',
    note: 'X (Twitter) collection is not connected yet; it needs a paid API plan.',
    items: [...out, ...general],
    matched: out.length > 0,
  };
}

module.exports = { newsFor };
