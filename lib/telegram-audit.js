'use strict';

const { selectPerformanceMarketObservation } = require('./telegram-performance');

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function positive(value) { return finite(value) && value > 0; }
function timestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}
function compactSnapshot(alert) {
  const snapshot = alert?.decisionSnapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  return snapshot;
}

function buildTelegramPublicationAudit({ performance = [], alerts = [], tokens = {}, limit = 50, now = Date.now() } = {}) {
  const rows = Array.isArray(performance) ? performance : [];
  const alertRows = Array.isArray(alerts) ? alerts : [];
  const max = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  return rows.slice(-1000).map(entry => {
    const publishedAt = timestamp(entry?.publishedAt);
    const mint = String(entry?.mint || '');
    const related = alertRows
      .filter(alert => alert?.mint === mint && timestamp(alert.at) > 0)
      .map(alert => ({ alert, delta: Math.abs(timestamp(alert.at) - publishedAt) }))
      .filter(item => item.delta <= 30 * 60 * 1000)
      .sort((a, b) => a.delta - b.delta)[0]?.alert || null;
    const token = tokens?.[mint] || null;
    const observation = token ? selectPerformanceMarketObservation(token, entry.priceSource, now) : null;
    const observationFresh = Boolean(observation && now - observation.observedAt <= 5 * 60 * 1000);
    const currentPriceUsd = observationFresh ? observation.priceUsd : null;
    const currentReturnPct = positive(currentPriceUsd) && positive(Number(entry.basePriceUsd))
      ? Number(((currentPriceUsd / Number(entry.basePriceUsd) - 1) * 100).toFixed(2)) : null;
    return {
      id: String(entry.id || ''),
      mint,
      name: String(entry.tokenName || token?.name || 'Token inconnu'),
      symbol: String(entry.tokenSymbol || token?.symbol || ''),
      publishedAt,
      basePriceUsd: positive(Number(entry.basePriceUsd)) ? Number(entry.basePriceUsd) : null,
      priceSource: entry.priceSource || null,
      currentPriceUsd,
      currentObservedAt: observationFresh ? observation.observedAt : null,
      currentReturnPct,
      currentState: observationFresh ? 'fresh' : observation ? 'stale' : 'unavailable',
      horizons: entry.horizons && typeof entry.horizons === 'object' ? entry.horizons : {},
      originalMessage: String(entry.originalMessage || ''),
      alert: related ? {
        at: related.at,
        level: related.level || null,
        score: finite(related.score) ? related.score : null,
        coverage: finite(related.coverage) ? related.coverage : null,
        classification: related.classification || null,
        flags: Array.isArray(related.flags) ? related.flags : [],
        reasons: Array.isArray(related.reasons) ? related.reasons : [],
        qualification: related.qualification || null,
        decisionSnapshot: compactSnapshot(related)
      } : null
    };
  }).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, max);
}

module.exports = { buildTelegramPublicationAudit };
