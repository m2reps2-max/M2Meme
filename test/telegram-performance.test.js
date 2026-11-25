'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HORIZONS,
  extractMintFromAlertId,
  normalizeTelegramPerformance,
  createTelegramPerformanceEntry,
  collectTelegramPerformanceUpdates,
  formatTelegramPerformanceMessage,
  markTelegramPerformanceRendered
} = require('../lib/telegram-performance');

const BASE = Date.UTC(2026, 10, 25, 12, 0, 0);
const mint = '8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump';
function token(price, at) {
  return { priceUsd: price, marketObservedAt: new Date(at).toISOString(), marketObservationSource: 'dexscreener' };
}
function entry() {
  return createTelegramPerformanceEntry({
    mint, chatId: '-1001234567890', messageId: 42,
    originalMessage: '<b>💎 MEMECOIN RETENUE</b>',
    token: token(0.001, BASE - 30000),
    publishedAt: BASE
  });
}

test('extracts the token mint from an ISO-timestamped alert id', () => {
  const alertId = '2026-11-25T18:10:30.123Z:' + mint + ':opportunity';
  assert.equal(extractMintFromAlertId(alertId), mint);
  assert.equal(extractMintFromAlertId('invalid:alert:id'), '');
});

test('captures a lightweight publication baseline without storing a price history', () => {
  const row = entry();
  assert.equal(row.basePriceUsd, 0.001);
  assert.equal(row.publishedAt, BASE);
  assert.deepEqual(row.horizons, {});
  assert.equal(row.messageId, 42);
  assert.equal(createTelegramPerformanceEntry({
    mint, chatId: '-1001234567890', messageId: 43, originalMessage: 'x',
    token: token(0.001, BASE - 10 * 60 * 1000), publishedAt: BASE
  }), null, 'stale market prices must not become publication baselines');
});

test('records six milestone returns from the scanner current market snapshots', () => {
  const row = entry();
  const tokens = { [mint]: token(0.0012, BASE + 60 * 60 * 1000 + 30000) };
  const updates = collectTelegramPerformanceUpdates([row], tokens, BASE + 60 * 60 * 1000 + 30000);
  assert.equal(updates.length, 1);
  assert.equal(row.horizons['1h'].returnPct, 20);
  assert.equal(row.horizons['2h'], undefined);
  assert.equal(HORIZONS.map(x => x.key).join(','), '1h,2h,3h,6h,10h,24h');
});

test('does not mix prices from a different market provider into the same performance series', () => {
  const row = entry();
  const otherProvider = { [mint]: { ...token(0.002, BASE + 60 * 60 * 1000), marketObservationSource: 'geckoterminal' } };
  collectTelegramPerformanceUpdates([row], otherProvider, BASE + 60 * 60 * 1000);
  assert.equal(row.horizons['1h'], undefined);
  assert.equal(row.lastCurrentPriceUsd, 0.001, 'a different provider must not replace the publication source price');
});

test('marks a missed milestone unavailable instead of inventing a return', () => {
  const row = entry();
  collectTelegramPerformanceUpdates([row], { [mint]: token(0.002, BASE + 66 * 60 * 1000) }, BASE + 66 * 60 * 1000);
  assert.deepEqual(row.horizons['1h'], { missed: true });
  assert.equal(row.horizons['2h'], undefined);
});

test('formats the original post and all requested horizons as a compact monospace performance table', () => {
  const row = entry();
  row.horizons['1h'] = { priceUsd: 0.0012, observedAt: BASE + 60 * 60 * 1000, returnPct: 20 };
  row.lastCurrentPriceUsd = 0.0015;
  row.lastCurrentObservedAt = BASE + 60 * 60 * 1000;
  const message = formatTelegramPerformanceMessage(row, BASE + 60 * 60 * 1000);
  assert.match(message, /MEMECOIN RETENUE/);
  assert.match(message, /<pre>PÉRIODE   VARIATION/);
  assert.ok(message.includes('1 h      🟢 +20,00 %'));
  assert.ok(message.includes('2 h      En attente'));
  assert.ok(message.includes('24 h     En attente'));
  assert.ok(message.includes('ACTUEL   🟢 +50,00 %'));
  assert.ok(message.includes('</pre>'));
});

test('migrates legacy tracked messages to a Phantom-only inline keyboard', () => {
  const row = entry();
  row.replyMarkup = { inline_keyboard: [[
    { text: 'DexScreener', url: 'https://dexscreener.com/solana/' + mint },
    { text: 'GMGN', url: 'https://gmgn.ai/sol/token/' + mint },
    { text: 'Axiom', url: 'https://axiom.trade/t/' + mint },
    { text: '👻 Acheter sur Phantom', url: 'https://phantom.com/tokens/solana/' + mint }
  ]] };
  const normalized = normalizeTelegramPerformance([row])[0];
  assert.deepEqual(normalized.replyMarkup, { inline_keyboard: [[
    { text: '👻 Acheter avec Phantom', url: 'https://phantom.com/tokens/solana/' + mint }
  ]] });
});

test('persists only bounded, valid performance entries', () => {
  const row = entry();
  const normalized = normalizeTelegramPerformance([row, null, { id: 'bad' }]);
  assert.equal(normalized.length, 1);
  assert.equal(normalizeTelegramPerformance(Array.from({ length: 1005 }, (_, i) => ({
    ...row, id: 'row-' + i, messageId: i + 1
  }))).length, 1000);
});

test('current return refresh is throttled to hourly updates unless a milestone resolves', () => {
  const row = entry();
  for (const horizon of HORIZONS) row.horizons[horizon.key] = { priceUsd: 0.001, observedAt: BASE + horizon.offsetMs, returnPct: 0 };
  collectTelegramPerformanceUpdates([row], { [mint]: token(0.0011, BASE + 10 * 60 * 1000) }, BASE + 10 * 60 * 1000);
  markTelegramPerformanceRendered(row, BASE + 10 * 60 * 1000);
  assert.equal(collectTelegramPerformanceUpdates([row], { [mint]: token(0.0013, BASE + 20 * 60 * 1000) }, BASE + 20 * 60 * 1000).length, 0);
  assert.equal(collectTelegramPerformanceUpdates([row], { [mint]: token(0.0014, BASE + 70 * 60 * 1000) }, BASE + 70 * 60 * 1000).length, 1);
});
