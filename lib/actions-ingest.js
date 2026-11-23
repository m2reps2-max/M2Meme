'use strict';

function constantTimeEqual(expected, supplied) {
  if (typeof expected !== 'string' || typeof supplied !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && a.length > 0 && require('node:crypto').timingSafeEqual(a, b);
}

function validateHistoricalPayload(payload, allowedSymbols) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Invalid payload' };
  if (payload.schemaVersion !== 1) return { ok: false, error: 'Unsupported schema version' };
  if (!payload.historicalBenchmarks || typeof payload.historicalBenchmarks !== 'object' || Array.isArray(payload.historicalBenchmarks)) {
    return { ok: false, error: 'Missing historical benchmark map' };
  }
  const entries = Object.entries(payload.historicalBenchmarks);
  if (!entries.length || entries.length > allowedSymbols.size) return { ok: false, error: 'Invalid benchmark count' };
  for (const [symbol, row] of entries) {
    if (!allowedSymbols.has(symbol) || !row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: 'Unknown or invalid benchmark entry' };
    }
    if (row.symbol !== symbol) return { ok: false, error: 'Benchmark symbol mismatch' };
    if (row.completed === true) {
      if (!Number.isFinite(row.terminalReturnPct) || !Number.isFinite(row.maxDrawdownPct) ||
          !Array.isArray(row.signals) || row.signals.length > 180) {
        return { ok: false, error: 'Invalid completed benchmark metrics' };
      }
    } else if (typeof row.error !== 'string' || row.error.length > 300) {
      return { ok: false, error: 'Invalid incomplete benchmark entry' };
    }
  }
  return { ok: true };
}

function validateArchiveLearningPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.schemaVersion !== 1) {
    return { ok: false, error: 'Invalid archive learning schema' };
  }
  if (!Number.isFinite(Date.parse(payload.generatedAt || ''))) return { ok: false, error: 'Invalid archive learning timestamp' };
  const summary = payload.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return { ok: false, error: 'Missing archive learning summary' };
  for (const key of ['archiveTokensScanned', 'tokensWithForecasts', 'uniqueResolvedTokens1h']) {
    if (!Number.isInteger(summary[key]) || summary[key] < 0 || summary[key] > 250000) {
      return { ok: false, error: 'Invalid archive learning count: ' + key };
    }
  }
  if (!Number.isInteger(summary.forecasts) || summary.forecasts < 0 || summary.forecasts > 2000000) {
    return { ok: false, error: 'Invalid archive forecast count' };
  }
  const allowedHorizons = ['15m', '1h', '6h', '24h', '7d'];
  const validateMetric = (row, maxCount = 2000000) => Boolean(row &&
    Number.isInteger(row.resolved) && row.resolved >= 0 && row.resolved <= maxCount &&
    [row.averageReturnPct, row.positive15Pct, row.loss20Pct].every(value =>
      value === null || (Number.isFinite(value) && value >= -10000 && value <= 10000)));
  const horizons = summary.horizons;
  if (!horizons || typeof horizons !== 'object' || Array.isArray(horizons) ||
      allowedHorizons.some(key => !validateMetric(horizons[key])) ||
      Object.keys(horizons).some(key => !allowedHorizons.includes(key))) {
    return { ok: false, error: 'Invalid archive learning horizons' };
  }
  const allowedBands = ['0-44', '45-64', '65-79', '80-100'];
  const bands = summary.scoreBands;
  if (!bands || typeof bands !== 'object' || Array.isArray(bands) ||
      allowedBands.some(key => !validateMetric(bands[key])) ||
      Object.keys(bands).some(key => !allowedBands.includes(key))) {
    return { ok: false, error: 'Invalid archive score bands' };
  }
  const sources = summary.bySource;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources) || Object.keys(sources).length > 30) {
    return { ok: false, error: 'Invalid archive source aggregates' };
  }
  for (const [source, row] of Object.entries(sources)) {
    if (!source || source.length > 80 || !validateMetric(row)) return { ok: false, error: 'Invalid archive source metric' };
  }
  const walk = summary.walkForward;
  if (!walk || typeof walk !== 'object' || Array.isArray(walk) ||
      !Number.isInteger(walk.trainingTokens) || !Number.isInteger(walk.validationTokens) ||
      walk.trainingTokens < 0 || walk.validationTokens < 0 ||
      walk.trainingTokens + walk.validationTokens > 250000 ||
      !validateMetric(walk.validation, 250000)) {
    return { ok: false, error: 'Invalid archive walk-forward summary' };
  }
  if (typeof summary.limitations !== 'string' || summary.limitations.length > 2000) {
    return { ok: false, error: 'Invalid archive learning limitations' };
  }
  return { ok: true };
}

function mergeHistoricalBenchmarks(existing, incoming, now = Date.now()) {
  const merged = { ...(existing || {}) };
  for (const [symbol, row] of Object.entries(incoming || {})) {
    const previous = merged[symbol];
    const previousFresh = previous?.completed === true &&
      Number.isFinite(Date.parse(previous.fetchedAt || '')) &&
      now - Date.parse(previous.fetchedAt) < 7 * 86400000;
    if (row.completed === true || !previousFresh) merged[symbol] = row;
  }
  return merged;
}

module.exports = { constantTimeEqual, validateHistoricalPayload, validateArchiveLearningPayload, mergeHistoricalBenchmarks };
