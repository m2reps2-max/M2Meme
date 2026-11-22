'use strict';

const BASE = 'https://api.geckoterminal.com/api/v2';
const QUOTE_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'USD1ttm9pT2f9s5n6h7k8j9m4n3p2q1r0s9t8u7v6w5x'
]);
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;

async function fetchNewPools({ fetchImpl = fetch, page = 1 } = {}) {
  const url = BASE + '/networks/solana/new_pools?page=' + Math.max(1, Math.min(10, Number(page) || 1)) + '&include=base_token,quote_token,dex';
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json;version=20230302', 'user-agent': 'MEME-RADAR/2.2 (+free public data)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('GeckoTerminal HTTP ' + response.status);
  return response.json();
}

function parseNewPools(payload) {
  const included = new Map((payload?.included || []).map(item => [item.id, item]));
  const out = [];
  for (const pool of payload?.data || []) {
    const a = pool.attributes || {};
    const rel = pool.relationships || {};
    const baseId = rel.base_token?.data?.id;
    const quoteId = rel.quote_token?.data?.id;
    const base = included.get(baseId)?.attributes || {};
    const quote = included.get(quoteId)?.attributes || {};
    const baseAddress = String(base.address || baseId || '').replace(/^solana_/, '');
    const quoteAddress = String(quote.address || quoteId || '').replace(/^solana_/, '');
    const useQuote = QUOTE_MINTS.has(baseAddress) && quoteAddress && !QUOTE_MINTS.has(quoteAddress);
    const token = useQuote ? quote : base;
    const address = useQuote ? quoteAddress : baseAddress;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || QUOTE_MINTS.has(address)) continue;
    const createdAt = a.pool_created_at || null;
    const createdMs = createdAt ? Date.parse(createdAt) : NaN;
    out.push({
      tokenAddress: address,
      name: String(token.name || '').slice(0, 100),
      symbol: String(token.symbol || '').slice(0, 24),
      poolAddress: String(a.address || String(pool.id || '').split('_').slice(1).join('_')),
      dexName: String(included.get(rel.dex?.data?.id)?.attributes?.name || '').slice(0, 80),
      poolCreatedAt: createdAt,
      ageHours: Number.isFinite(createdMs) ? Math.max(0, (Date.now() - createdMs) / 3600000) : null,
      liquidityUsd: number(a.reserve_in_usd),
      priceUsd: number(useQuote ? a.quote_token_price_usd : a.base_token_price_usd),
      fdv: number(a.fdv_usd),
      marketCap: number(a.market_cap_usd),
      volume: {
        m5: number(a.volume_usd?.m5),
        h1: number(a.volume_usd?.h1),
        h24: number(a.volume_usd?.h24)
      },
      txns: a.transactions || {},
      priceChange: a.price_change_percentage || {},
      source: 'geckoterminal_new_pool'
    });
  }
  return out;
}

module.exports = { fetchNewPools, parseNewPools };
