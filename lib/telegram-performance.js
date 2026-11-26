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
const MARKET_STALE_MS = 3 * 60 * 1000;
const CURRENT_REFRESH_MS = 2 * 60 * 1000;
const PERFORMANCE_TRACKING_WINDOW_MS = 26 * 60 * 60 * 1000;
const PERFORMANCE_REFRESH_MINTS_PER_SCAN = 40;
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
      previewId: /^[A-Za-z0-9_-]{20,40}$/.test(String(row.previewId || '')) ? String(row.previewId) : null,
      mint,
      chatId: String(row.chatId || '').slice(0, 64),
      messageId: Math.max(0, Math.floor(Number(row.messageId) || 0)),
      originalMessage: String(row.originalMessage || '').slice(0, 3000),
      tokenName: String(row.tokenName || '').replace(/[\r\n]/g, ' ').slice(0, 48),
      tokenSymbol: String(row.tokenSymbol || '').replace(/[\r\n]/g, ' ').slice(0, 24),
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

function resolveTelegramPublicationBaseline(token, decisionSnapshot, now = Date.now()) {
  const candidates = [
    {
      priceUsd: Number(token?.priceUsd),
      observedAt: Date.parse(token?.marketObservedAt || ''),
      source: token?.marketObservationSource
    },
    ...((Array.isArray(token?.history) ? token.history : []).filter(row => row?.source === 'dexscreener').map(row => ({
      priceUsd: Number(row.priceUsd),
      observedAt: marketObservationTimestamp(row),
      source: row.source
    }))),
    {
      priceUsd: Number(decisionSnapshot?.priceUsd),
      observedAt: Date.parse(decisionSnapshot?.marketObservedAt || ''),
      source: decisionSnapshot?.marketObservationSource
    }
  ].filter(row => positive(row.priceUsd)
    && Number.isFinite(row.observedAt)
    && row.observedAt <= now + 30000
    && now - row.observedAt <= MARKET_STALE_MS
    && typeof row.source === 'string'
    && row.source.length > 0);
  // DexScreener is the canonical publication series. GeckoTerminal remains
  // a discovery/fallback source, but a newer Gecko quote must not replace a
  // still-fresh Dex quote and silently change the price series at publication.
  const canonical = candidates.filter(row => row.source === 'dexscreener');
  canonical.sort((a, b) => b.observedAt - a.observedAt);
  return canonical[0] || null;
}

function createTelegramPerformanceEntry({ mint, chatId, messageId, originalMessage, replyMarkup = null, token, previewId = null, publishedAt = Date.now() }) {
  const basePriceUsd = Number(token?.priceUsd);
  const baselineObservedAt = Date.parse(token?.marketObservedAt || '');
  if (!mint || !chatId || !Number.isInteger(Number(messageId)) || Number(messageId) <= 0
      || !originalMessage || token?.marketObservationSource !== 'dexscreener'
      || !positive(basePriceUsd) || !Number.isFinite(baselineObservedAt)
      || baselineObservedAt > publishedAt + 30000 || publishedAt - baselineObservedAt > MARKET_STALE_MS) return null;
  return {
    id: String(chatId) + ':' + String(messageId),
    previewId: /^[A-Za-z0-9_-]{20,40}$/.test(String(previewId || '')) ? String(previewId) : null,
    mint: String(mint),
    chatId: String(chatId),
    messageId: Number(messageId),
    originalMessage: String(originalMessage).slice(0, 3000),
    tokenName: String(token?.name || '').replace(/[\r\n]/g, ' ').slice(0, 48),
    tokenSymbol: String(token?.symbol || '').replace(/[\r\n]/g, ' ').slice(0, 24),
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

function marketObservationTimestamp(row) {
  const value = Number(row?.at);
  if (Number.isFinite(value) && value > 0) return value;
  const parsed = Date.parse(row?.at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function performanceMarketObservations(token, expectedSource, now = Date.now()) {
  if (!token || !expectedSource) return [];
  const byTimestamp = new Map();
  const currentAt = Date.parse(token.marketObservedAt || '');
  if (token.marketObservationSource === expectedSource && positive(Number(token.priceUsd)) && Number.isFinite(currentAt)) {
    byTimestamp.set(currentAt, { priceUsd: Number(token.priceUsd), observedAt: currentAt, source: expectedSource });
  }
  for (const row of Array.isArray(token.history) ? token.history : []) {
    if (row?.source !== expectedSource || !positive(Number(row.priceUsd))) continue;
    const observedAt = marketObservationTimestamp(row);
    if (observedAt > 0 && observedAt <= now + 30000) {
      byTimestamp.set(observedAt, { priceUsd: Number(row.priceUsd), observedAt, source: expectedSource });
    }
  }
  return [...byTimestamp.values()].filter(row => row.observedAt <= now + 30000)
    .sort((left, right) => left.observedAt - right.observedAt);
}

function selectPerformanceMarketObservation(token, expectedSource, now = Date.now()) {
  const observations = performanceMarketObservations(token, expectedSource, now);
  return observations.length ? observations[observations.length - 1] : null;
}

function selectPerformanceMilestoneObservation(token, expectedSource, targetAt, toleranceMs, now = Date.now()) {
  const candidates = performanceMarketObservations(token, expectedSource, now)
    .filter(row => Math.abs(row.observedAt - targetAt) <= toleranceMs)
    .sort((left, right) => Math.abs(left.observedAt - targetAt) - Math.abs(right.observedAt - targetAt));
  return candidates[0] || null;
}

function selectTelegramPerformanceMints(entries, tokens, now = Date.now(), limit = PERFORMANCE_REFRESH_MINTS_PER_SCAN) {
  const byMint = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const mint = String(entry?.mint || '');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !positive(Number(entry?.basePriceUsd))) continue;
    const age = now - Number(entry.publishedAt || 0);
    if (!Number.isFinite(age) || age < 0 || age > PERFORMANCE_TRACKING_WINDOW_MS) continue;
    const pending = HORIZONS.filter(horizon => !entry.horizons?.[horizon.key]);
    if (!pending.length) continue;
    const token = tokens?.[mint];
    if (!token || !(token.pairAddress || token.geckoPoolAddress)) continue;
    const next = pending.map(horizon => ({ ...horizon, targetAt: Number(entry.publishedAt) + horizon.offsetMs }))
      .sort((a, b) => Math.abs(a.targetAt - now) - Math.abs(b.targetAt - now))[0];
    const dueNow = pending.some(horizon => {
      const targetAt = Number(entry.publishedAt) + horizon.offsetMs;
      return Math.abs(targetAt - now) <= horizon.toleranceMs;
    });
    const upcoming = next.targetAt > now && next.targetAt - now <= 15 * 60 * 1000;
    const canonicalObservation = selectPerformanceMarketObservation(token, 'dexscreener', now);
    const observedAt = canonicalObservation?.observedAt || Number(entry.lastCurrentObservedAt) || 0;
    const staleMs = observedAt > 0 ? Math.max(0, now - observedAt) : Number.MAX_SAFE_INTEGER;
    const row = {
      mint,
      duePriority: dueNow ? 0 : upcoming ? 1 : 2,
      staleMs,
      nextDistanceMs: Math.abs(next.targetAt - now),
      publishedAt: Number(entry.publishedAt) || 0
    };
    const previous = byMint.get(mint);
    if (!previous || row.duePriority < previous.duePriority
      || (row.duePriority === previous.duePriority && row.staleMs > previous.staleMs)) byMint.set(mint, row);
  }
  return [...byMint.values()]
    .sort((a, b) => a.duePriority - b.duePriority
      || b.staleMs - a.staleMs
      || a.nextDistanceMs - b.nextDistanceMs
      || a.publishedAt - b.publishedAt)
    .slice(0, Math.max(1, Math.min(100, Math.floor(Number(limit) || PERFORMANCE_REFRESH_MINTS_PER_SCAN))))
    .map(row => row.mint);
}

function collectTelegramPerformanceUpdates(entries, tokens, now = Date.now()) {
  const updates = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !positive(entry.basePriceUsd) || !finite(entry.publishedAt)) continue;
    const token = tokens?.[entry.mint];
    const observation = selectPerformanceMarketObservation(token, entry.priceSource, now);
    const observedAt = observation?.observedAt || 0;
    const priceUsd = observation?.priceUsd || 0;
    const hasObservation = Boolean(observation);
    const fresh = hasObservation && now - observedAt <= MARKET_STALE_MS;

    if (fresh) {
      entry.lastCurrentPriceUsd = priceUsd;
      entry.lastCurrentObservedAt = observedAt;
    }

    let milestoneChanged = false;
    for (const horizon of HORIZONS) {
      if (entry.horizons?.[horizon.key]) continue;
      const targetAt = entry.publishedAt + horizon.offsetMs;
      const milestoneObservation = selectPerformanceMilestoneObservation(
        token, entry.priceSource, targetAt, horizon.toleranceMs, now
      );
      if (milestoneObservation) {
        entry.horizons ||= {};
        entry.horizons[horizon.key] = {
          priceUsd: milestoneObservation.priceUsd,
          observedAt: milestoneObservation.observedAt,
          returnPct: Number(((milestoneObservation.priceUsd / entry.basePriceUsd - 1) * 100).toFixed(2))
        };
        milestoneChanged = true;
      } else if (hasObservation && observedAt > targetAt + horizon.toleranceMs) {
        entry.horizons ||= {};
        entry.horizons[horizon.key] = { missed: true };
        milestoneChanged = true;
      }
    }

    const signature = milestoneSignature(entry);
    const currentChanged = fresh && entry.lastCurrentObservedAt > (entry.lastRenderedCurrentObservedAt || 0);
    const currentRefreshDue = currentChanged
      && now - (entry.lastEditedAt || 0) >= CURRENT_REFRESH_MS;
    const staleTransitionDue = entry.lastCurrentObservedAt > 0
      && now - entry.lastCurrentObservedAt > MARKET_STALE_MS
      && (entry.lastEditedAt || 0) < entry.lastCurrentObservedAt + MARKET_STALE_MS;
    if (!entry.lastEditedAt || milestoneChanged || signature !== entry.lastRenderedMilestones || currentRefreshDue || staleTransitionDue) {
      updates.push(entry);
    }
  }
  updates.sort((a, b) => {
    const aMilestoneChanged = a.lastRenderedMilestones !== milestoneSignature(a);
    const bMilestoneChanged = b.lastRenderedMilestones !== milestoneSignature(b);
    return Number(bMilestoneChanged) - Number(aMilestoneChanged)
      || (Number(a.lastEditedAt) || 0) - (Number(b.lastEditedAt) || 0)
      || (Number(a.publishedAt) || 0) - (Number(b.publishedAt) || 0);
  });
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

function telegramPerformancePreviewVersion(entry) {
  return String(entry?.lastCurrentObservedAt || 0) + '-' + milestoneSignature(entry || {}).replace(/[^a-zA-Z0-9_-]/g, '') + '-' + String(entry?.lastEditedAt || 0);
}

function buildTelegramPreviewUrl(baseUrl, previewId, version = 0) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const id = String(previewId || '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(base) || !/^[A-Za-z0-9_-]{20,40}$/.test(id)) return '';
  return base + '/telegram-preview/' + id + '?v=' + encodeURIComponent(String(version));
}

function buildTelegramPreviewAnchor(url) {
  return url ? '<a href="' + escapeHtml(url) + '">\u200b</a>' : '';
}

function formatTelegramPerformanceMessage(entry, now = Date.now(), previewBaseUrl = '') {
  const mint = String(entry.mint || '');
  const originalMessage = String(entry.originalMessage || '')
    .split('\n')
    .filter(line => !/Ouvrir sur:/i.test(line)
      && !(/DexScreener/.test(line) && /GMGN/.test(line) && /Axiom/.test(line))
      && !/telegram-preview\/[A-Za-z0-9_-]{20,40}/.test(line))
    .join('\n')
    .trimEnd();
  const platformLinks = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)
    ? '<i><a href="https://dexscreener.com/solana/' + mint + '">DexScreener</a> · <a href="https://gmgn.ai/sol/token/' + mint + '">GMGN</a> · <a href="https://axiom.trade/t/' + mint + '">Axiom</a></i>'
    : '';
  const previewUrl = buildTelegramPreviewUrl(previewBaseUrl, entry.previewId, telegramPerformancePreviewVersion(entry));
  const lines = [originalMessage];
  if (platformLinks) lines.push('', platformLinks);
  if (previewUrl) lines.push(buildTelegramPreviewAnchor(previewUrl));
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
  resolveTelegramPublicationBaseline,
  selectTelegramPerformanceMints,
  collectTelegramPerformanceUpdates,
  selectPerformanceMarketObservation,
  selectPerformanceMilestoneObservation,
  formatTelegramPerformanceMessage,
  buildTelegramPreviewUrl,
  buildTelegramPreviewAnchor,
  telegramPerformancePreviewVersion,
  markTelegramPerformanceRendered
};
