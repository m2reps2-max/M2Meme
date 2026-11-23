'use strict';

const { readJsonLimited } = require('./http-body');

const API = 'https://api.jup.ag/swap/v2/order';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const MAX_RESPONSE_BYTES = 96 * 1024;
const DEFAULT_TEST_USD = 100;
const MAX_SUPPLY_SHARE_BPS = 50;

function decimalToRaw(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const scale = 10n ** BigInt(decimals);
  const fractional = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * scale + BigInt(fractional || '0');
}

function amountForUsd({ usd = DEFAULT_TEST_USD, priceUsd, decimals, supplyUi }) {
  const notional = Number(usd);
  const price = Number(priceUsd);
  if (!Number.isFinite(notional) || notional <= 0 || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const priceScaledNumber = Math.round(price * 1e9);
  if (!Number.isSafeInteger(priceScaledNumber) || priceScaledNumber <= 0) return null;
  const notionalMicros = BigInt(Math.round(notional * 1e6));
  const priceScaled = BigInt(priceScaledNumber);
  const scale = 10n ** BigInt(decimals);
  let amount = (notionalMicros * 1000n * scale) / priceScaled;
  if (amount <= 0n) return null;
  const supply = supplyUi == null ? null : decimalToRaw(supplyUi, decimals);
  if (supply !== null && supply > 0n) {
    const cap = supply * BigInt(MAX_SUPPLY_SHARE_BPS) / 10000n;
    amount = amount > cap && cap > 0n ? cap : amount;
    if (amount > supply) amount = supply;
  }
  if (amount <= 0n) return null;
  const actualUsd = Number(amount) / (10 ** decimals) * price;
  if (!Number.isFinite(actualUsd) || actualUsd <= 0) return null;
  return { amountRaw: amount.toString(), inputAmountUsd: Number(actualUsd.toFixed(4)), requestedUsd: notional };
}

function parseSellQuote(payload, { inputAmountUsd, inputAmountRaw, mint } = {}) {
  const outAmountRaw = String(payload?.outAmount || '');
  if (!/^\d+$/.test(outAmountRaw) || BigInt(outAmountRaw) <= 0n) {
    const errorCode = String(payload?.errorCode || payload?.code || 'NO_ROUTE');
    const error = String(payload?.error || payload?.message || 'Jupiter n’a retourné aucune route de vente').slice(0, 180);
    return { status: 'no_route', errorCode, error, routeAvailable: false, inputAmountRaw, inputAmountUsd, mint, transactionRequested: false, executionSimulated: false };
  }
  const impactRaw = Number(payload.priceImpactPct);
  const priceImpactPct = Number.isFinite(impactRaw) && impactRaw >= 0 ? Number((impactRaw * 100).toFixed(4)) : null;
  const routeDexes = [...new Set((Array.isArray(payload.routePlan) ? payload.routePlan : [])
    .map(row => String(row?.swapInfo?.label || '').trim())
    .filter(Boolean))].slice(0, 8);
  const outputUsd = Number(outAmountRaw) / (10 ** USDC_DECIMALS);
  const effectiveLossPct = Number.isFinite(inputAmountUsd) && inputAmountUsd > 0
    ? Number(((1 - outputUsd / inputAmountUsd) * 100).toFixed(4))
    : null;
  const status = priceImpactPct !== null && priceImpactPct > 5 ? 'high_impact' : 'route_available';
  return {
    status,
    routeAvailable: true,
    inputAmountRaw,
    inputAmountUsd,
    outputAmountRaw: outAmountRaw,
    outputUsd: Number.isFinite(outputUsd) ? Number(outputUsd.toFixed(6)) : null,
    priceImpactPct,
    effectiveLossPct,
    router: typeof payload.router === 'string' ? payload.router : null,
    routeDexes,
    feeBps: Number.isFinite(Number(payload.feeBps)) ? Number(payload.feeBps) : null,
    mint,
    checkedAt: new Date().toISOString(),
    transactionRequested: false,
    executionSimulated: false
  };
}

async function fetchJupiterSellQuote(mint, amountRaw, {
  apiKey = process.env.JUPITER_API_KEY,
  fetchImpl = globalThis.fetch,
  outputMint = USDC_MINT
} = {}) {
  if (typeof mint !== 'string' || mint.length < 32 || mint.length > 64) throw new Error('Mint invalide');
  if (typeof outputMint !== 'string' || outputMint.length < 32 || outputMint.length > 64) throw new Error('Mint de sortie invalide');
  if (!/^\d+$/.test(String(amountRaw)) || BigInt(amountRaw) <= 0n) throw new Error('Montant brut invalide');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponible');
  const url = API + '?' + new URLSearchParams({
    inputMint: mint,
    outputMint,
    amount: String(amountRaw)
  }).toString();
  const headers = {};
  if (String(apiKey || '').trim()) headers['x-api-key'] = String(apiKey).trim();
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8000) });
  const payload = await readJsonLimited(response, MAX_RESPONSE_BYTES);
  if (!response.ok) {
    const message = String(payload?.error || payload?.message || 'Jupiter HTTP ' + response.status).slice(0, 180);
    if (response.status === 400 && /no route|no routes|not tradable|token_not_tradable|could not find/i.test(message + ' ' + String(payload?.errorCode || ''))) {
      return parseSellQuote({ error: message, errorCode: payload?.errorCode || 'NO_ROUTE' }, { mint, inputAmountRaw: String(amountRaw) });
    }
    throw new Error('Jupiter HTTP ' + response.status + ': ' + message);
  }
  return parseSellQuote(payload, { mint, inputAmountRaw: String(amountRaw) });
}

module.exports = {
  API,
  USDC_MINT,
  USDC_DECIMALS,
  DEFAULT_TEST_USD,
  MAX_SUPPLY_SHARE_BPS,
  decimalToRaw,
  amountForUsd,
  parseSellQuote,
  fetchJupiterSellQuote
};
