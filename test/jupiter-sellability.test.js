'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  API,
  USDC_MINT,
  decimalToRaw,
  amountForUsd,
  parseSellQuote,
  fetchJupiterSellQuote
} = require('../lib/jupiter-sellability');

const mint = 'So11111111111111111111111111111111111111112';
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
}

test('converts decimal token amounts to raw units without floating point drift', () => {
  assert.equal(decimalToRaw('123.456789', 6), 123456789n);
  assert.equal(decimalToRaw('0.000000001', 9), 1n);
  assert.equal(decimalToRaw('invalid', 9), null);
});

test('builds a $100 sell test amount and caps it at 0.5% of total supply', () => {
  const amount = amountForUsd({ usd: 100, priceUsd: 0.0001, decimals: 9, supplyUi: '1000000000' });
  assert.equal(amount.amountRaw, '1000000000000000');
  assert.equal(amount.inputAmountUsd, 100);
  const capped = amountForUsd({ usd: 100, priceUsd: 0.1, decimals: 9, supplyUi: '1000' });
  assert.equal(capped.amountRaw, '5000000000');
  assert.equal(capped.inputAmountUsd, 0.5);
});

test('rejects missing price, invalid decimals and unrepresentable amounts', () => {
  assert.equal(amountForUsd({ usd: 100, priceUsd: 0, decimals: 9 }), null);
  assert.equal(amountForUsd({ usd: 100, priceUsd: 1, decimals: 19 }), null);
  assert.equal(amountForUsd({ usd: 100, priceUsd: 1e-12, decimals: 9 }), null);
});

test('parses a read-only route and converts Jupiter decimal price impact into percent', () => {
  const result = parseSellQuote({
    router: 'metis',
    outAmount: '98500000',
    priceImpactPct: '0.015',
    feeBps: 10,
    routePlan: [{ swapInfo: { label: 'Raydium' } }, { swapInfo: { label: 'Meteora' } }]
  }, { mint, inputAmountRaw: '1000000000', inputAmountUsd: 100 });
  assert.equal(result.status, 'route_available');
  assert.equal(result.routeAvailable, true);
  assert.equal(result.outputUsd, 98.5);
  assert.equal(result.priceImpactPct, 1.5);
  assert.deepEqual(result.routeDexes, ['Raydium', 'Meteora']);
  assert.equal(result.transactionRequested, false);
  assert.equal(result.executionSimulated, false);
});

test('flags high price impact and treats a missing route as unknown rather than a honeypot verdict', () => {
  const high = parseSellQuote({ outAmount: '90000000', priceImpactPct: '0.08' }, { mint, inputAmountUsd: 100 });
  assert.equal(high.status, 'high_impact');
  const missing = parseSellQuote({ error: 'No routes found', errorCode: 'NO_ROUTES_FOUND' }, { mint, inputAmountUsd: 100 });
  assert.equal(missing.status, 'no_route');
  assert.equal(missing.routeAvailable, false);
  assert.match(missing.error, /No routes/);
  assert.equal(missing.transactionRequested, false);
});

test('requests a Jupiter Swap V2 order without taker or transaction execution', async () => {
  let request;
  const result = await fetchJupiterSellQuote(mint, '123456789', {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return response({ router: 'metis', outAmount: '2500000', priceImpactPct: '0.002', routePlan: [] });
    }
  });
  assert.equal(request.url.origin + request.url.pathname, API);
  assert.equal(request.url.searchParams.get('inputMint'), mint);
  assert.equal(request.url.searchParams.get('outputMint'), USDC_MINT);
  assert.equal(request.url.searchParams.get('amount'), '123456789');
  assert.equal(request.url.searchParams.has('taker'), false);
  assert.equal(request.options.headers['x-api-key'], 'test-key');
  assert.equal(result.status, 'route_available');
  assert.equal(result.transactionRequested, false);
});

test('maps Jupiter no-route responses separately from rate limits and server failures', async () => {
  const missing = await fetchJupiterSellQuote(mint, '1000', {
    fetchImpl: async () => response({ error: 'No routes found', errorCode: 'NO_ROUTES_FOUND' }, 400)
  });
  assert.equal(missing.status, 'no_route');
  await assert.rejects(
    () => fetchJupiterSellQuote(mint, '1000', { fetchImpl: async () => response({ error: 'rate limited' }, 429) }),
    /Jupiter HTTP 429/
  );
});
