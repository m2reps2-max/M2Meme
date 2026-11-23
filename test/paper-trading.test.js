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

test('keeps lifetime realized PnL when the bounded recent-trade history is trimmed', () => {
  const state = fixture();
  state.paperTrading.trades = Array.from({ length: 200 }, (_, i) => ({ pnlUsd: 1, closedAt: new Date(now - i * 1000).toISOString() }));
  state.paperTrading.realizedPnlUsd = 200;
  state.paperTrading.closedTradeCount = 200;
  stepPaperTrading(state, selection(), now);
  state.tokens[mint].history.push({ at: new Date(now + 60000).toISOString(), priceUsd: 1.8 });
  const result = stepPaperTrading(state, { best: [] }, now + 60000);
  assert.equal(state.paperTrading.trades.length, 200);
  assert.equal(state.paperTrading.closedTradeCount, 201);
  assert.ok(state.paperTrading.realizedPnlUsd > 200);
  assert.equal(result.realizedPnlUsd, Number(state.paperTrading.realizedPnlUsd.toFixed(2)));
});


test('captures point-in-time selection factors and reports realized paper-trade feedback by score band', () => {
  const state = fixture();
  const candidate = {
    ...selection().best[0],
    analysis: {
      score: 82, learnedScore: 77,
      factors: { activity: 88, momentum: 72, market: 65, liquidityQuality: 91, security: 95 }
    }
  };
  stepPaperTrading(state, { best: [candidate] }, now);
  const opened = state.paperTrading.positions[0];
  assert.equal(opened.entrySnapshot.score, 82);
  assert.equal(opened.entrySnapshot.learnedScore, 77);
  assert.equal(opened.entrySnapshot.features.activity, 88);
  state.tokens[mint].history.push({ at: new Date(now + 60000).toISOString(), priceUsd: 1.8 });
  const result = stepPaperTrading(state, { best: [] }, now + 60000);
  assert.equal(state.paperTrading.trades[0].entrySnapshot.score, 82);
  assert.equal(result.learningFeedback.sampleSize, 1);
  assert.equal(result.learningFeedback.byScore['75–84'].trades, 1);
  assert.equal(result.learningFeedback.status, 'insufficient_sample');
  assert.equal(result.learningFeedback.automaticModelTraining, false);
});

test('paper-trade feedback ignores legacy trades without entry snapshots and deduplicates repeated mints', () => {
  const { buildPaperLearningSummary } = require('../lib/paper-trading');
  const book = {
    trades: [
      { mint: 'a', openedAt: '2026-01-01T00:00:00Z', pnlPct: 10, entrySnapshot: { score: 80, features: { activity: 90 } } },
      { mint: 'a', openedAt: '2026-01-02T00:00:00Z', pnlPct: -50, entrySnapshot: { score: 80, features: { activity: 90 } } },
      { mint: 'legacy', pnlPct: 30 }
    ],
    closedTradeCount: 3
  };
  const feedback = buildPaperLearningSummary(book);
  assert.equal(feedback.sampleSize, 1);
  assert.equal(feedback.overall.averageNetReturnPct, 10);
  assert.equal(feedback.byFactor.activity.high.trades, 1);
  assert.equal(feedback.lifetimeClosedTrades, 3);
});
