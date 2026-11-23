'use strict';
const { readJsonLimited } = require('./http-body');
const API = 'https://api.jup.ag/price/v3';
const MAX_MINTS = 5;
const MAX_RESPONSE_BYTES = 64 * 1024;
async function fetchJupiterPrices(mints, { apiKey = process.env.JUPITER_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  const unique = [...new Set((Array.isArray(mints) ? mints : []).filter(mint => typeof mint === 'string' && mint.length >= 32 && mint.length <= 64))].slice(0, MAX_MINTS);
  if (!unique.length) return {};
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponible');
  const headers = {};
  if (String(apiKey || '').trim()) headers['x-api-key'] = String(apiKey).trim();
  const url = API + '?ids=' + unique.map(encodeURIComponent).join(',');
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8000) });
  const payload = await readJsonLimited(response, MAX_RESPONSE_BYTES);
  if (!response.ok) throw new Error('Jupiter HTTP ' + response.status);
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const result = {};
  for (const mint of unique) {
    const row = data?.[mint];
    const price = Number(row?.usdPrice);
    if (!row || !Number.isFinite(price) || price <= 0) continue;
    result[mint] = {
      priceUsd: price,
      liquidityUsd: Number.isFinite(Number(row.liquidity)) ? Number(row.liquidity) : null,
      priceChange24hPct: Number.isFinite(Number(row.priceChange24h)) ? Number(row.priceChange24h) : null,
      confidenceLevel: typeof row.confidenceLevel === 'string' ? row.confidenceLevel : null,
      decimals: Number.isInteger(Number(row.decimals)) && Number(row.decimals) >= 0 && Number(row.decimals) <= 18 ? Number(row.decimals) : null,
      blockId: Number.isFinite(Number(row.blockId)) ? Number(row.blockId) : null
    };
  }
  return result;
}
module.exports = { fetchJupiterPrices, MAX_MINTS };
