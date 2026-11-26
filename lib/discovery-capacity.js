'use strict';

const DEFAULT_HOT_TOKEN_LIMIT = 2500;
const MIN_HOT_TOKEN_LIMIT = 1200;
const MAX_HOT_TOKEN_LIMIT = 5000;
const DEFAULT_ARCHIVE_SCAN_BATCH = 40;
const MAX_ARCHIVE_SCAN_BATCH = 50;

function boundedInteger(value, fallback, minimum, maximum) {
  const raw = value === undefined || value === null || String(value).trim() === '' ? fallback : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(raw)));
}

function resolveHotTokenLimit(value) {
  return boundedInteger(value, DEFAULT_HOT_TOKEN_LIMIT, MIN_HOT_TOKEN_LIMIT, MAX_HOT_TOKEN_LIMIT);
}

function resolveArchiveScanBatch(value) {
  return boundedInteger(value, DEFAULT_ARCHIVE_SCAN_BATCH, 20, MAX_ARCHIVE_SCAN_BATCH);
}

module.exports = {
  DEFAULT_HOT_TOKEN_LIMIT,
  MIN_HOT_TOKEN_LIMIT,
  MAX_HOT_TOKEN_LIMIT,
  DEFAULT_ARCHIVE_SCAN_BATCH,
  MAX_ARCHIVE_SCAN_BATCH,
  resolveHotTokenLimit,
  resolveArchiveScanBatch
};
