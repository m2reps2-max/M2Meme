'use strict';

const HORIZONS = [
  { key: '1h', label: '1 h', offsetMs: 60 * 60 * 1000, toleranceMs: 5 * 60 * 1000 },
  { key: '2h', label: '2 h', offsetMs: 2 * 60 * 60 * 1000, toleranceMs: 5 * 60 * 1000 },
  { key: '3h', label: '3 h', offsetMs: 3 * 60 * 60 * 1000, toleranceMs: 5 * 60 * 1000 },
  { key: '6h', label: '6 h', offsetMs: 6 * 60 * 60 * 1000, toleranceMs: 7 * 60 * 1000 },
  { key: '10h', label: '10 h', offsetMs: 10 * 60 * 60 * 1000, toleranceMs: 10 * 60 * 1000 },
  { key: '24h', label: '24 h', offsetMs: 24 * 60 * 60 * 1000, toleranceMs: 15 * 60 * 1000 }
];
const MAX_TRACKED = 1000;
const MARKET_STALE_MS = 5 * 60 * 1000;
const CURRENT_REFRESH_MS = 60 * 60 * 1000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => finite(value) && value > 0;

function extractMintFromAlertId(alertId) {
  const value = String(alertId || '');
  const levelSeparator = value.lastIndexOf(':');
  const mintSeparator = levelSeparator > 0 ? value.lastIndexOf(':', levelSeparator - 1) : -1;
  if (mintSeparator < 0 || levelSeparator <= mintSeparator + 1) return '';
  const mint = value.slice(mintSeparator + 1, levelSeparator);
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? mint : '';
}

function normalizePerformanceReplyMarkup(value, mint) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.inline_keyboard)) return null;
  const validMint = String(mint || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(validMint)) return null;
  const phantom = value.inline_keyboard.flat().find(button => {
    const label = String(button?.text || '');
    const url = String(button?.url || '');
    return (label === '👻 Acheter avec Phantom' || label === '👻 Acheter sur Phantom')
      && url === 'https://phantom.com/tokens/solana/' + validMint;
  });
  return phantom ? { inline_keyboard: [[{ text: '👻 Acheter avec Phantom', url: 'https://phantom.com/tokens/solana/' + validMint }]] } : null;
}

function normalizeTelegramPerformance(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(row => row && typeof row === 'object').slice(-MAX_TRACKED).map(row => {
    const horizons = {};
    const mint = String(row.mint || '').slice(0, 64);
    for (const { key } of HORIZONS) {
      const outcome = row.horizons?.[key];
      if (outcome?.missed === true) horizons[key] = { missed: true };
      else if (positive(outcome?.priceUsd) && finite(outcome?.observedAt) && finite(outcome?.returnPct)) {
        horizons[key] = { priceUsd: outcome.priceUsd, observedAt: outcome.observedAt, returnPct: outcome.returnPct };
      }
    }
    return {
      id: String(row.id || '').slice(0, 180),
      mint,
      chatId: String(row.chatId || '').slice(0, 64),
      messageId: Math.max(0, Math.floor(Number(row.messageId) || 0)),
      originalMessage: String(row.originalMessage || '').slice(0, 3000),
      tokenName: String(row.tokenName || '').replace(/[\\r\\n]/g, ' ').slice(0, 48),
      tokenSymbol: String(row.tokenSymbol || '').replace(/[\\r\\n]/g, ' ').slice(0, 24),
      replyMarkup: normalizePerformanceReplyMarkup(row.replyMarkup, mint),
      basePriceUsd: Number(row.basePriceUsd),
      priceSource: typeof row.priceSource === 'string' ? row.priceSource.slice(0, 24) : null,
      baselineObservedAt: Number(row.baselineObservedAt) || 0,
      publishedAt: Number(row.publishedAt) || 0,
      horizons,
      lastCurrentPriceUsd: positive(Number(row.lastCurrentPriceUsd)) ? Number(row.lastCurrentPriceUsd) : null,
      lastCurrentObservedAt: Number(row.lastCurrentObservedAt) || 0,
      lastEditedAt: Number(row.lastEditedAt) || 0,
      lastRenderedCurrentObservedAt: Number(row.lastRenderedCurrentObservedAt) || 0,
      lastRenderedMilestones: typeof row.lastRenderedMilestones === 'string' ? row.lastRenderedMilestones : null,
      lastError: typeof row.lastError === 'string' ? row.lastError.slice(0, 180) : null
    };
  }).filter(row => row.id && row.mint && row.chatId && row.messageId > 0
    && row.originalMessage && positive(row.basePriceUsd) && row.publishedAt > 0);
}

function createTelegramPerformanceEntry({ mint, chatId, messageId, originalMessage, replyMarkup = null, token, publishedAt = Date.now() }) {
  const basePriceUsd = Number(token?.priceUsd);
  const baselineObservedAt = Date.parse(token?.marketObservedAt || '');
  if (!mint || !chatId || !Number.isInteger(Number(messageId)) || Number(messageId) <= 0
      || !originalMessage || !positive(basePriceUsd) || !Number.isFinite(baselineObservedAt)
      || baselineObservedAt > publishedAt + 30000 || publishedAt - baselineObservedAt > MARKET_STALE_MS) return null;
  return {
    id: String(chatId) + ':' + String(messageId),
    mint: String(mint),
    chatId: String(chatId),
    messageId: Number(messageId),
    originalMessage: String(originalMessage).slice(0, 3000),
    tokenName: String(token?.name || '').replace(/[\\r\\n]/g, ' ').slice(0, 48),
    tokenSymbol: String(token?.symbol || '').replace(/[\\r\\n]/g, ' ').slice(0, 24),
    replyMarkup: replyMarkup && typeof replyMarkup === 'object' ? replyMarkup : null,
    basePriceUsd,
    priceSource: typeof token.marketObservationSource === 'string' ? token.marketObservationSource.slice(0, 24) : null,
    baselineObservedAt,
    publishedAt,
    horizons: {},
    lastCurrentPriceUsd: basePriceUsd,
    lastCurrentObservedAt: baselineObservedAt,
    lastEditedAt: 0,
    lastRenderedCurrentObservedAt: 0,
    lastRenderedMilestones: null,
    lastError: null
  };
}

function milestoneSignature(entry) {
  return HORIZONS.map(({ key }) => {
    const outcome = entry.horizons?.[key];
    return outcome?.missed ? key + ':missed'
      : outcome && finite(outcome.returnPct) ? key + ':' + outcome.returnPct
      : key + ':pending';
  }).join('|');
}

function collectTelegramPerformanceUpdates(entries, tokens, now = Date.now()) {
  const updates = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !positive(entry.basePriceUsd) || !finite(entry.publishedAt)) continue;
    const token = tokens?.[entry.mint];
    const observedAt = Date.parse(token?.marketObservedAt || '');
    const priceUsd = Number(token?.priceUsd);
    const sourceMatches = !entry.priceSource || token?.marketObservationSource === entry.priceSource;
    const hasObservation = sourceMatches && positive(priceUsd) && Number.isFinite(observedAt)
      && observedAt <= now + 30000;
    const fresh = hasObservation && now - observedAt <= MARKET_STALE_MS;

    if (fresh) {
      entry.lastCurrentPriceUsd = priceUsd;
      entry.lastCurrentObservedAt = observedAt;
    }

    let milestoneChanged = false;
    for (const horizon of HORIZONS) {
      if (entry.horizons?.[horizon.key]) continue;
      const targetAt = entry.publishedAt + horizon.offsetMs;
      if (!hasObservation || observedAt < targetAt) continue;
      if (observedAt <= targetAt + horizon.toleranceMs) {
        entry.horizons ||= {};
        entry.horizons[horizon.key] = {
          priceUsd,
          observedAt,
          returnPct: Number(((priceUsd / entry.basePriceUsd - 1) * 100).toFixed(2))
        };
        milestoneChanged = true;
      } else if (observedAt > targetAt + horizon.toleranceMs) {
        entry.horizons ||= {};
        entry.horizons[horizon.key] = { missed: true };
        milestoneChanged = true;
      }
    }

    const signature = milestoneSignature(entry);
    const currentChanged = fresh && entry.lastCurrentObservedAt > (entry.lastRenderedCurrentObservedAt || 0);
    const currentRefreshDue = currentChanged
      && now - (entry.lastEditedAt || 0) >= CURRENT_REFRESH_MS;
    if (!entry.lastEditedAt || milestoneChanged || signature !== entry.lastRenderedMilestones || currentRefreshDue) {
      updates.push(entry);
    }
  }
  return updates;
}

function formatCompactPercent(value) {
  if (!finite(value)) return '—';
  const rounded = Number(value.toFixed(1));
  const sign = rounded > 0 ? '+' : '';
  const marker = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '•';
  return marker + sign + rounded.toFixed(1).replace('.', ',') + '%';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatTelegramPerformanceMessage(entry, now = Date.now()) {
  const currentPrice = positive(Number(entry.lastCurrentPriceUsd)) ? Number(entry.lastCurrentPriceUsd) : null;
  const currentReturn = currentPrice === null ? null : (currentPrice / entry.basePriceUsd - 1) * 100;
  const currentIsStale = !entry.lastCurrentObservedAt || now - entry.lastCurrentObservedAt > MARKET_STALE_MS;
  const identity = [entry.tokenName, entry.tokenSymbol ? '$' + entry.tokenSymbol : '']
    .filter(Boolean).join(' · ');
  const lines = [entry.originalMessage];
  if (identity) lines.push('', '🪙 <i>' + escapeHtml(identity) + '</i>');
  lines.push(
    '',
    '━━━━━━━━━━━━━━━━━━',
    '<b>📈 PERFORMANCE</b>',
    '<b>Depuis publication : ' + formatCompactPercent(currentReturn) + '</b>'
  );
  const horizonValues = HORIZONS.map(({ key }) => {
    const outcome = entry.horizons?.[key];
    const value = outcome?.missed ? 'N/D'
      : finite(outcome?.returnPct) ? formatCompactPercent(outcome.returnPct)
      : '—';
    return key.toUpperCase() + ' ' + value;
  });
  lines.push(
    '<code>' + horizonValues.slice(0, 3).join('  ·  ') + '</code>',
    '<code>' + horizonValues.slice(3).join('  ·  ') + '</code>'
  );
  if (currentIsStale && currentPrice !== null) {
    lines.push('<i>Dernier relevé · ' + new Date(entry.lastCurrentObservedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</i>');
  }
  return lines.join('\n').slice(0, 4096);
}

function markTelegramPerformanceRendered(entry, now = Date.now()) {
  if (!entry) return false;
  entry.lastEditedAt = now;
  entry.lastRenderedCurrentObservedAt = entry.lastCurrentObservedAt || 0;
  entry.lastRenderedMilestones = milestoneSignature(entry);
  entry.lastError = null;
  return true;
}

module.exports = {
  HORIZONS,
  MAX_TRACKED,
  extractMintFromAlertId,
  normalizeTelegramPerformance,
  createTelegramPerformanceEntry,
  collectTelegramPerformanceUpdates,
  formatTelegramPerformanceMessage,
  markTelegramPerformanceRendered
};
