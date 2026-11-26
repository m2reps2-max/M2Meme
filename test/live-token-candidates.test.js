'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLiveTokenCandidates } = require('../lib/live-token-candidates');

test('resolves lightweight selection cards to canonical token records', () => {
  const mint = 'So11111111111111111111111111111111111111112';
  const liveToken = {
    mint,
    priceUsd: 0.00005,
    security: { data: { decimals: 6, supply: '1000000000' } },
    jupiterPrice: { priceUsd: 0.00005 },
    sellabilityChecks: []
  };
  const selectionCard = { mint, analysis: { score: 79 }, freshness: { marketAgeMinutes: 0.2 } };
  const resolved = resolveLiveTokenCandidates([selectionCard], { [mint]: liveToken });

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0], liveToken);
  assert.equal(resolved[0].priceUsd, 0.00005);
  assert.equal(resolved[0].security.data.decimals, 6);
  assert.notEqual(resolved[0], selectionCard);
});

test('ignores missing tokens and duplicate selection cards without changing priority order', () => {
  const firstMint = 'So11111111111111111111111111111111111111112';
  const secondMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const first = { mint: firstMint, priceUsd: 1 };
  const second = { mint: secondMint, priceUsd: 2 };
  const resolved = resolveLiveTokenCandidates(
    [{ mint: firstMint }, { mint: 'missing' }, { mint: secondMint }, { mint: firstMint }],
    { [firstMint]: first, [secondMint]: second }
  );

  assert.deepEqual(resolved, [first, second]);
});

test('returns an empty list for invalid candidate or state inputs', () => {
  assert.deepEqual(resolveLiveTokenCandidates(null, {}), []);
  assert.deepEqual(resolveLiveTokenCandidates([], null), []);
});
