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

module.exports = { selectRotatingBatch, selectFreshDiscoveryBatch };
