'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTelegramPublicationAudit } = require('../lib/telegram-audit');

const mint = '8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump';
const publishedAt = Date.UTC(2026, 10, 25, 12, 0, 0);
const entry = {
  id: '-100:42', mint, tokenName: 'Audit Coin', tokenSymbol: 'AUD',
  publishedAt, basePriceUsd: 0.001, priceSource: 'dexscreener',
  originalMessage: 'MEMECOIN RETENUE', horizons: { '1h': { returnPct: -40, priceUsd: 0.0006, observedAt: publishedAt + 3600000 } }
};
const alert = {
  mint, at: new Date(publishedAt + 1000).toISOString(), level: 'opportunity',
  score: 84, coverage: 90, classification: 'promising',
  flags: [{ level: 'warning', message: 'Momentum très élevé' }],
  reasons: ['Tous les critères sont validés.'],
  qualification: { eligible: true },
  decisionSnapshot: { priceUsd: 0.001, liquidityUsd: 20000, ageMinutes: 9, factors: { momentum: 95 } }
};
const token = {
  priceUsd: 0.0005,
  marketObservedAt: new Date(publishedAt + 10 * 60000).toISOString(),
  marketObservationSource: 'dexscreener',
  history: []
};

test('joins a Telegram publication to its nearest alert and reports the exact current return', () => {
  const [row] = buildTelegramPublicationAudit({
    performance: [entry], alerts: [alert], tokens: { [mint]: token },
    now: publishedAt + 2 * 3600000
  });
  assert.equal(row.alert.score, 84);
  assert.equal(row.alert.decisionSnapshot.factors.momentum, 95);
  assert.equal(row.currentReturnPct, -50);
  assert.equal(row.currentState, 'fresh');
  assert.equal(row.horizons['1h'].returnPct, -40);
});

test('does not invent a current return when the market observation is stale', () => {
  const [row] = buildTelegramPublicationAudit({
    performance: [entry], alerts: [alert], tokens: { [mint]: token },
    now: publishedAt + 20 * 60000
  });
  assert.equal(row.currentReturnPct, null);
  assert.equal(row.currentState, 'stale');
});

test('does not attach an unrelated alert for the same mint', () => {
  const [row] = buildTelegramPublicationAudit({
    performance: [entry], alerts: [{ ...alert, at: new Date(publishedAt - 3600000).toISOString() }],
    tokens: {}, now: publishedAt + 2 * 3600000
  });
  assert.equal(row.alert, null);
  assert.equal(row.currentReturnPct, null);
});

test('limits output and sorts newest publications first', () => {
  const older = { ...entry, id: '-100:41', publishedAt: publishedAt - 1000 };
  const result = buildTelegramPublicationAudit({
    performance: [older, entry], alerts: [], tokens: {}, limit: 1, now: publishedAt
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, entry.id);
});
