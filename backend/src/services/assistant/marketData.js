/**
 * M1 - Market data module.
 * One module, two adapters: CoinGecko (prices, history) and Blockscout (Ethereum wallets).
 * Responses are cached and shared between users, so storage and API usage stay small.
 */
const axios = require('axios');

const CG_BASE = 'https://api.coingecko.com/api/v3';
const BS_BASE = 'https://eth.blockscout.com/api/v2';

const cache = new Map();
const TTL = { price: 60 * 1000, history: 15 * 60 * 1000, wallet: 2 * 60 * 1000 };
const MAX_CACHE = 500;

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  cache.delete(key);
  return null;
}

function cacheSet(key, value, ttl) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { value, exp: Date.now() + ttl });
}

// CoinGecko's free tier is strict: serialise real network calls with a gap between them.
let cgChain = Promise.resolve();
let cgGap = 700;          // ms between real CoinGecko calls
let cgSlowUntil = 0;      // after a 429 we slow down for a minute
const nextGap = () => (Date.now() < cgSlowUntil ? 2500 : cgGap);

function cgRequest(path, params) {
  const run = async () => {
    const headers = {};
    if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
    try {
      // Retry inside this turn of the queue. Re-queuing from here would wait behind itself forever.
      for (let attempt = 0; ; attempt += 1) {
        try {
          const res = await axios.get(CG_BASE + path, { params, headers, timeout: 15000 });
          return res.data;
        } catch (err) {
          if (err.response?.status === 429 && attempt < 2) {
            cgSlowUntil = Date.now() + 60 * 1000;
            await new Promise((r) => setTimeout(r, 6000));
          } else {
            throw err;
          }
        }
      }
    } finally {
      await new Promise((r) => setTimeout(r, nextGap()));
    }
  };
  const next = cgChain.then(run, run);
  cgChain = next.catch(() => {});
  return next;
}

async function cached(key, ttl, loader) {
  const hit = cacheGet(key);
  if (hit) return hit;
  const value = await loader();
  cacheSet(key, value, ttl);
  return value;
}

/** Spot data for a CoinGecko coin id. */
function getCoinMarket(id) {
  return cached(`cg:market:${id}`, TTL.price, async () => {
    const data = await cgRequest('/coins/markets', {
      vs_currency: 'usd',
      ids: id,
      price_change_percentage: '24h,7d,30d',
    });
    const c = data[0];
    if (!c) throw new Error(`Unknown asset ${id}`);
    return {
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      priceUsd: c.current_price,
      marketCapUsd: c.market_cap,
      rank: c.market_cap_rank,
      athChangePct: c.ath_change_percentage,
      change: {
        d1: c.price_change_percentage_24h_in_currency,
        d7: c.price_change_percentage_7d_in_currency,
        d30: c.price_change_percentage_30d_in_currency,
      },
    };
  });
}

/** CoinGecko id -> Binance spot symbol. Binance has no strict rate limit and answers in ~1s. */
const BINANCE_BY_ID = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB', ripple: 'XRP', cardano: 'ADA',
  dogecoin: 'DOGE', 'avalanche-2': 'AVAX', chainlink: 'LINK', polkadot: 'DOT', litecoin: 'LTC',
  cosmos: 'ATOM', uniswap: 'UNI', tron: 'TRX', near: 'NEAR', arbitrum: 'ARB', optimism: 'OP',
  sui: 'SUI', aptos: 'APT', 'the-open-network': 'TON',
};

/** Well-known ERC-20 contracts with a trustworthy Binance pair. Matching by contract avoids look-alike tokens. */
const BINANCE_BY_CONTRACT = {
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
  '0x2260fac5e5542a773aa44fbfeedf7c193bc2c599': 'BTC',   // WBTC
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'ETH',   // WETH
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'ETH',   // stETH
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': 'PEPE',
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': 'SHIB',
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': 'MKR',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'AAVE',
  '0x5a98fcbea516cf06857215779fd812ca3bef1b32': 'LDO',
  '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72': 'ENS',
  '0xc944e90c64b2c07662a292be6244bdf05cda44a7': 'GRT',
};

/** Stablecoins: history is assumed flat at $1 instead of spending API calls on it. */
const STABLE_CONTRACTS = new Set([
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
]);
const isStable = (contract) => STABLE_CONTRACTS.has(String(contract || '').toLowerCase());

async function binanceDaily(symbol, days) {
  const res = await axios.get('https://api.binance.com/api/v3/klines', {
    params: { symbol: `${symbol}USDT`, interval: '1d', limit: days },
    timeout: 8000,
  });
  const rows = res.data.map((k) => [k[0], Number(k[4])]).filter((p) => Number.isFinite(p[1]) && p[1] > 0);
  if (rows.length < 8) throw new Error('too little data');
  return rows;
}

function flatSeries(days) {
  const end = Date.now();
  return Array.from({ length: days }, (_, i) => [end - (days - 1 - i) * 86400000, 1]);
}

/** Daily closes as [timestampMs, price] pairs, oldest first. */
function getHistoryById(id, days = 90) {
  return cached(`hist:${id}:${days}`, TTL.history, async () => {
    const sym = BINANCE_BY_ID[id];
    if (sym) {
      try { return await binanceDaily(sym, days); } catch (e) { /* fall back to CoinGecko */ }
    }
    const data = await cgRequest(`/coins/${id}/market_chart`, { vs_currency: 'usd', days, interval: 'daily' });
    return data.prices.filter((p) => Number.isFinite(p[1]));
  });
}

function getHistoryByContract(address, days = 90) {
  const a = address.toLowerCase();
  return cached(`hist:c:${a}:${days}`, TTL.history, async () => {
    if (isStable(a)) return flatSeries(days);
    const sym = BINANCE_BY_CONTRACT[a];
    if (sym) {
      try { return await binanceDaily(sym, days); } catch (e) { /* fall back to CoinGecko */ }
    }
    const data = await cgRequest(`/coins/ethereum/contract/${a}/market_chart`, {
      vs_currency: 'usd',
      days,
      interval: 'daily',
    });
    return data.prices.filter((p) => Number.isFinite(p[1]));
  });
}

/** Resolve a ticker or name to a CoinGecko id (exact ticker match preferred). */
function searchCoin(query) {
  const q = String(query).trim().toLowerCase();
  return cached(`cg:search:${q}`, 60 * 60 * 1000, async () => {
    const data = await cgRequest('/search', { query: q });
    const coins = data.coins || [];
    const exact = coins.find((c) => c.symbol.toLowerCase() === q || c.id === q || c.name.toLowerCase() === q);
    return (exact || coins[0])?.id || null;
  });
}

async function bs(path, attempt = 0) {
  try {
    // Huge wallets (exchanges) can take 30s+ on the public indexer, so allow for it.
    const res = await axios.get(BS_BASE + path, { timeout: 75000 });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    if (attempt < 1 && (status === 429 || status >= 500)) return bs(path, attempt + 1);
    throw err;
  }
}

const ETHPLORER = 'https://api.ethplorer.io';

/**
 * ENS name for an address. Ethplorer does not return it and Blockscout is too slow for big wallets,
 * so this uses a small dedicated lookup. It never blocks the report: failure just means no name.
 */
function resolveEns(a) {
  return cached(`ens:${a}`, 60 * 60 * 1000, async () => {
    try {
      const res = await axios.get(`https://api.ensideas.com/ens/resolve/${a}`, { timeout: 3500 });
      const name = res.data?.name;
      return typeof name === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name) ? name : null;
    } catch (e) {
      return null;
    }
  });
}

/** Fast path: Ethplorer answers in under a second even for exchange-sized wallets. */
async function walletFromEthplorer(a) {
  const [info, counters, ens] = await Promise.all([
    axios.get(`${ETHPLORER}/getAddressInfo/${a}`, { params: { apiKey: process.env.ETHPLORER_API_KEY || 'freekey' }, timeout: 12000 })
      .then((r) => r.data),
    axios.get(`${BS_BASE}/addresses/${a}/counters`, { timeout: 6000 }).then((r) => r.data).catch(() => ({})),
    resolveEns(a),
  ]);
  if (!info || info.error) throw new Error('ethplorer failed');
  const tokens = (info.tokens || []).map((t) => {
    const ti = t.tokenInfo || {};
    const decimals = Number(ti.decimals || 18);
    const amount = Number(t.balance) / Math.pow(10, decimals);
    const rate = ti.price && Number(ti.price.rate) ? Number(ti.price.rate) : null;
    return {
      contract: ti.address,
      symbol: ti.symbol || '?',
      name: ti.name || ti.symbol || 'Unknown',
      amount,
      priceUsd: rate,
      valueUsd: rate ? amount * rate : null,
    };
  });
  return {
    address: a,
    ens,
    isContract: false,
    ethBalance: Number(info.ETH?.balance) || 0,
    ethPriceUsd: Number(info.ETH?.price?.rate) || null,
    tokens,
    txCount: Number(counters.transactions_count) || Number(info.countTxs) || 0,
    transferCount: Number(counters.token_transfers_count) || 0,
  };
}

/** Slow fallback through Blockscout. */
async function walletFromBlockscout(a) {
  const [info, tokens, counters] = await Promise.all([
    bs(`/addresses/${a}`),
    bs(`/addresses/${a}/token-balances`).catch(() => []),
    bs(`/addresses/${a}/counters`).catch(() => ({})),
  ]);
  return {
    address: a,
    ens: info.ens_domain_name || null,
    isContract: !!info.is_contract,
    ethBalance: Number(info.coin_balance || 0) / 1e18,
    ethPriceUsd: Number(info.exchange_rate) || null,
    tokens: (Array.isArray(tokens) ? tokens : [])
      .filter((t) => t.token?.type === 'ERC-20')
      .map((t) => {
        const decimals = Number(t.token.decimals || 18);
        const amount = Number(t.value) / Math.pow(10, decimals);
        const rate = Number(t.token.exchange_rate) || null;
        return {
          contract: t.token.address_hash || t.token.address,
          symbol: t.token.symbol || '?',
          name: t.token.name || t.token.symbol || 'Unknown',
          amount,
          priceUsd: rate,
          valueUsd: rate ? amount * rate : null,
        };
      }),
    txCount: Number(counters.transactions_count) || 0,
    transferCount: Number(counters.token_transfers_count) || 0,
  };
}

/** Ethereum wallet snapshot: native balance, ERC-20 balances, activity counters. */
function getWallet(address) {
  const a = address.toLowerCase();
  return cached(`wallet:${a}`, TTL.wallet, async () => {
    try { return await walletFromEthplorer(a); } catch (e) { return walletFromBlockscout(a); }
  });
}

module.exports = { isStable, searchCoin, getCoinMarket, getHistoryById, getHistoryByContract, getWallet };
