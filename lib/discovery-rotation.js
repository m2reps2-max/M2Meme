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

module.exports = { selectRotatingBatch };
