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
  buildTelegramPreviewUrl,
  telegramPerformancePreviewVersion,
  markTelegramPerformanceRendered
} = require('../lib/telegram-performance');

const BASE = Date.UTC(2026, 10, 25, 12, 0, 0);
const mint = '8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump';
function token(price, at) {
  return { priceUsd: price, marketObservedAt: new Date(at).toISOString(), marketObservationSource: 'dexscreener', name: 'Test Coin', symbol: 'TEST' };
}
function entry() {
  return createTelegramPerformanceEntry({
    mint, chatId: '-1001234567890', messageId: 42,
    originalMessage: '<b>💎 MEMECOIN RETENUE</b>',
    previewId: 'Abcdefghijklmnopqrstuvwx',
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

test('keeps the Telegram message compact and exposes a native preview link', () => {
  const row = entry();
  row.horizons['1h'] = { priceUsd: 0.0012, observedAt: BASE + 60 * 60 * 1000, returnPct: 20 };
  row.lastCurrentPriceUsd = 0.0015;
  row.lastCurrentObservedAt = BASE + 60 * 60 * 1000;
  const baseUrl = 'https://m2meme.fadehost.app';
  const message = formatTelegramPerformanceMessage(row, BASE + 60 * 60 * 1000, baseUrl);
  assert.match(message, /MEMECOIN RETENUE/);
  assert.ok(message.includes('DexScreener</a> · <a href="https://gmgn.ai/'));
  assert.ok(message.includes('Axiom</a>'));
  assert.ok(message.includes('<a href="https://m2meme.fadehost.app/telegram-preview/Abcdefghijklmnopqrstuvwx?v='));
  assert.doesNotMatch(message, /<b>📈 PERFORMANCE|Depuis publication|1H ▲|<pre>|Ouvrir sur/);
  assert.equal(buildTelegramPreviewUrl('http://m2meme.fadehost.app', row.previewId, 1), '');
  assert.equal(buildTelegramPreviewUrl(baseUrl, 'invalid id', 1), '');
  assert.ok(telegramPerformancePreviewVersion(row).startsWith(String(row.lastCurrentObservedAt) + '-1h20'));
});

test('normalizes only opaque preview identifiers', () => {
  const row = entry();
  const valid = normalizeTelegramPerformance([row])[0];
  assert.equal(valid.previewId, row.previewId);
  const invalid = normalizeTelegramPerformance([{ ...row, previewId: 'https://evil.example' }])[0];
  assert.equal(invalid.previewId, null);
});

test('renders a premium PNG and labels every unavailable milestone instead of leaving blank cells', () => {
  const { renderTelegramPerformancePng, buildTelegramPreviewMetrics } = require('../lib/telegram-preview-image');
  const row = entry();
  const metrics = buildTelegramPreviewMetrics(row, BASE);
  assert.equal(metrics.currentState, 'a jour');
  assert.equal(metrics.cells[0].value, 'EN ATTENTE');
  assert.equal(metrics.cells[5].value, 'EN ATTENTE');
  const png = renderTelegramPerformancePng(row, BASE);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.length > 1000);
});

test('does not present an old market snapshot as a current return', () => {
  const { buildTelegramPreviewMetrics } = require('../lib/telegram-preview-image');
  const row = entry();
  row.lastCurrentObservedAt = BASE - 10 * 60 * 1000;
  row.lastCurrentPriceUsd = 0.002;
  const metrics = buildTelegramPreviewMetrics(row, BASE);
  assert.equal(metrics.currentReturn, null);
  assert.equal(metrics.currentState, 'donnee ancienne');
  assert.equal(metrics.observedAt, 0);
});

test('labels a missed market observation explicitly after the capture window', () => {
  const { buildTelegramPreviewMetrics } = require('../lib/telegram-preview-image');
  const row = entry();
  const metrics = buildTelegramPreviewMetrics(row, BASE + 70 * 60 * 1000);
  assert.equal(metrics.cells[0].value, 'NON CAPTURE');
  row.horizons['1h'] = { missed: true };
  assert.equal(buildTelegramPreviewMetrics(row, BASE + 70 * 60 * 1000).cells[0].value, 'N/D');
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
