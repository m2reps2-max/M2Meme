'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchJupiterPrices } = require('../lib/jupiter-price');
const mint = 'So11111111111111111111111111111111111111112';
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
}
test('fetches Jupiter v3 prices in a bounded batch and parses valid USD prices', async () => {
  let request;
  const prices = await fetchJupiterPrices([mint, mint], {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => { request = { url, options }; return response({ [mint]: { usdPrice: 12.5, liquidity: 40000, priceChange24h: 8.2, decimals: 9, blockId: 123 } }); }
  });
  assert.match(request.url, /price\/v3\?ids=/);
  assert.equal(request.options.headers['x-api-key'], 'test-key');
  assert.equal(prices[mint].priceUsd, 12.5);
  assert.equal(prices[mint].liquidityUsd, 40000);
  assert.equal(prices[mint].decimals, 9);
});
test('supports keyless access and ignores omitted or invalid prices', async () => {
  let headers;
  const prices = await fetchJupiterPrices([mint], {
    apiKey: '',
    fetchImpl: async (_url, options) => { headers = options.headers; return response({ data: { [mint]: { usdPrice: 0 } } }); }
  });
  assert.deepEqual(headers, {});
  assert.deepEqual(prices, {});
});
test('rejects non-success HTTP responses', async () => {
  await assert.rejects(() => fetchJupiterPrices([mint], { fetchImpl: async () => response({}, 429) }), /Jupiter HTTP 429/);
});
