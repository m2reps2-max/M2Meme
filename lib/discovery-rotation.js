'use strict';

function selectRotatingBatch(values, cursor = 0, limit = 100) {
  const items = Array.isArray(values) ? values : [];
  if (!items.length) return { items: [], nextCursor: 0 };
  const boundedLimit = Math.max(1, Math.min(items.length, Math.floor(Number(limit) || 100)));
  const rawCursor = Math.floor(Number(cursor) || 0);
  const start = ((rawCursor % items.length) + items.length) % items.length;
  const selected = Array.from({ length: boundedLimit }, (_, index) => items[(start + index) % items.length]);
  return { items: selected, nextCursor: (start + boundedLimit) % items.length };
}

function selectFreshDiscoveryBatch(discoveredValues, priorityValues = [], cursor = 0, limit = 100) {
  const priority = new Set(Array.isArray(priorityValues) ? priorityValues : []);
  const seen = new Set();
  const candidates = [];
  for (const value of Array.isArray(discoveredValues) ? discoveredValues : []) {
    if (typeof value !== 'string' || !value || priority.has(value) || seen.has(value)) continue;
    seen.add(value);
    candidates.push(value);
  }
  candidates.sort();
  return selectRotatingBatch(candidates, cursor, limit);
}

function buildMarketRefreshBatch({
  telegramPerformance = [],
  watchlist = [],
  recentLaunches = [],
  scoreFocus = [],
  social = [],
  archived = [],
  tracked = [],
  fresh = [],
  limit = 320
} = {}) {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 320)));
  const seen = new Set();
  const selected = [];
  // Reserve the first places for follow-up obligations and newly launched tokens.
  // Fresh discovery is deliberately placed before the broad tracked-token lane.
  for (const group of [telegramPerformance, watchlist, recentLaunches, scoreFocus, social, archived, tracked, fresh]) {
    for (const mint of Array.isArray(group) ? group : []) {
      if (typeof mint !== 'string' || !mint || seen.has(mint)) continue;
      seen.add(mint);
      selected.push(mint);
      if (selected.length >= boundedLimit) return selected;
    }
  }
  return selected;
}

function selectScoreFocusCandidates(tokens, configuredMinScore = 80, limit = 30) {
  const minScore = Number(configuredMinScore) || 80;
  const focusFloor = Math.max(55, minScore - 15);
  const boundedLimit = Math.max(1, Math.min(30, Math.floor(Number(limit) || 30)));
  const candidates = (Array.isArray(tokens) ? tokens : Object.values(tokens || {}))
    .filter(token =>
      token
      && Boolean(token.pairAddress || token.geckoPoolAddress)
      && token.analysis?.hardBlocked !== true
      && token.analysis?.risk !== 'high'
      && Number.isFinite(Number(token.analysis?.score))
      && Number(token.analysis.score) >= focusFloor
    );
  candidates.sort((a, b) =>
    Number(b.analysis.score) - Number(a.analysis.score)
    || (Number(b.liquidityUsd) || 0) - (Number(a.liquidityUsd) || 0)
    || String(a.mint || '').localeCompare(String(b.mint || ''))
  );
  return candidates.slice(0, boundedLimit);
}

module.exports = { selectRotatingBatch, selectFreshDiscoveryBatch, selectScoreFocusCandidates, buildMarketRefreshBatch };
