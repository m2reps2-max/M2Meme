'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNewPools } = require('../lib/gecko-discovery');

test('GeckoTerminal new pools resolves Solana base token and market fields', () => {
  const payload = {
    data: [{ id: 'solana_pool123', attributes: { address: 'pool123', pool_created_at: '2026-11-22T10:00:00Z', reserve_in_usd: '25000', base_token_price_usd: '0.01', fdv_usd: '1000000', volume_usd: { h1: '5000', h24: '30000' }, transactions: { h1: { buys: 30, sells: 10 } } }, relationships: { base_token: { data: { id: 'solana_token12345678901234567890123456789012' } }, quote_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } }, dex: { data: { id: 'solana_raydium' } } } }],
    included: [{ id: 'solana_token12345678901234567890123456789012', attributes: { address: 'Token1234567891234567891234567891233', name: 'Test Cat', symbol: 'TCAT' } }, { id: 'solana_raydium', attributes: { name: 'Raydium' } }]
  };
  const rows = parseNewPools(payload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokenAddress, 'Token1234567891234567891234567891233');
  assert.equal(rows[0].dexName, 'Raydium');
  assert.equal(rows[0].liquidityUsd, 25000);
  assert.equal(rows[0].txns.h1.buys, 30);
});

test('GeckoTerminal ignores a pool whose base token is a quote asset', () => {
  const payload = { data: [{ id: 'solana_pool', attributes: {}, relationships: { base_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } }, quote_token: { data: { id: 'solana_AnotherToken11111111111111111111111111' } } } }], included: [{ id: 'solana_AnotherToken11111111111111111111111111', attributes: { address: 'AnotherToken11111111111111111111111111', name: 'Other', symbol: 'OTH' } }] };
  const rows = parseNewPools(payload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokenAddress, 'AnotherToken11111111111111111111111111');
});
