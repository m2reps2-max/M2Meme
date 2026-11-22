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

module.exports = { constantTimeEqual, validateHistoricalPayload, mergeHistoricalBenchmarks };
