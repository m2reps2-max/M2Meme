'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stepPaperTrading, setPaperTradingEnabled } = require('../lib/paper-trading');

const now = Date.parse('2026-11-23T00:00:00Z');
const mint = 'TokenMint111111111111111111111111111111111';
function fixture(price = 1) {
  return {
    tokens: { [mint]: { mint, symbol: 'TEST', name: 'Test token', priceUsd: price, updatedAt: new Date(now).toISOString(), history: [{ at: new Date(now).toISOString(), priceUsd: price }], jupiterPrice: { priceUsd: price, checkedAt: new Date(now).toISOString(), divergencePct: 0 } } },
    paperTrading: { enabled: true, initialCapitalUsd: 1000, cashUsd: 1000, positions: [], trades: [] }
  };
}
function selection() { return { best: [{ mint, symbol: 'TEST', name: 'Test token' }] }; }

test('opens a bounded paper position from a fresh qualified candidate and accounts for entry costs', () => {
  const state = fixture();
  const result = stepPaperTrading(state, selection(), now);
  assert.equal(result.openPositions, 1);
  assert.equal(state.paperTrading.positions[0].notionalUsd, 100);
  assert.ok(state.paperTrading.cashUsd < 900);
  assert.equal(state.paperTrading.trades.length, 0);
});

test('does not open stale or duplicate candidates', () => {
  const state = fixture();
  state.tokens[mint].history[0].at = new Date(now - 6 * 60 * 1000).toISOString();
  assert.equal(stepPaperTrading(state, selection(), now).openPositions, 0);
  state.tokens[mint].history[0].at = new Date(now).toISOString();
  stepPaperTrading(state, selection(), now);
  assert.equal(stepPaperTrading(state, selection(), now + 1000).openPositions, 1);
});

test('closes at take profit and records net result after exit costs', () => {
  const state = fixture();
  stepPaperTrading(state, selection(), now);
  state.tokens[mint].history.push({ at: new Date(now + 60000).toISOString(), priceUsd: 1.8 });
  const result = stepPaperTrading(state, { best: [] }, now + 60000);
  assert.equal(result.openPositions, 0);
  assert.equal(state.paperTrading.trades[0].reason, 'take_profit');
  assert.ok(state.paperTrading.trades[0].pnlUsd > 0);
});

test('closes at stop loss and reports the realized loss', () => {
  const state = fixture();
  stepPaperTrading(state, selection(), now);
  state.tokens[mint].history.push({ at: new Date(now + 60000).toISOString(), priceUsd: 0.7 });
  const result = stepPaperTrading(state, { best: [] }, now + 60000);
  assert.equal(result.openPositions, 0);
  assert.equal(state.paperTrading.trades[0].reason, 'stop_loss');
  assert.ok(state.paperTrading.trades[0].pnlUsd < 0);
});

test('can pause and resume without deleting the simulation ledger', () => {
  const state = fixture();
  stepPaperTrading(state, selection(), now);
  assert.equal(setPaperTradingEnabled(state, false), false);
  assert.equal(stepPaperTrading(state, selection(), now + 1000).status, 'paused');
  assert.equal(state.paperTrading.positions.length, 1);
  assert.equal(setPaperTradingEnabled(state, true), true);
});

test('requires a fresh Jupiter corroboration and rejects excessive price divergence', () => {
  const state = fixture();
  delete state.tokens[mint].jupiterPrice;
  assert.equal(stepPaperTrading(state, selection(), now).openPositions, 0);
  state.tokens[mint].jupiterPrice = { priceUsd: 1, checkedAt: new Date(now - 6 * 60 * 1000).toISOString(), divergencePct: 0 };
  assert.equal(stepPaperTrading(state, selection(), now).openPositions, 0);
  state.tokens[mint].jupiterPrice = { priceUsd: 1.3, checkedAt: new Date(now).toISOString(), divergencePct: 30 };
  assert.equal(stepPaperTrading(state, selection(), now).openPositions, 0);
});
