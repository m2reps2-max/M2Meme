'use strict';

const DEFAULT_HOT_TOKEN_LIMIT = 5000;
const MIN_HOT_TOKEN_LIMIT = 1200;
const DEGRADED_HOT_TOKEN_LIMIT = 1200;
const MAX_HOT_TOKEN_LIMIT = 5000;
const DEFAULT_ARCHIVE_SCAN_BATCH = 40;
const DEFAULT_ARCHIVE_MAX_TOKENS = 50000;
const MAX_ARCHIVE_SCAN_BATCH = 50;
const MAX_ARCHIVE_MAX_TOKENS = 100000;

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

function resolveArchiveMaxTokens(value) {
  return boundedInteger(value, DEFAULT_ARCHIVE_MAX_TOKENS, 1000, MAX_ARCHIVE_MAX_TOKENS);
}

module.exports = {
  DEFAULT_HOT_TOKEN_LIMIT,
  MIN_HOT_TOKEN_LIMIT,
  DEGRADED_HOT_TOKEN_LIMIT,
  MAX_HOT_TOKEN_LIMIT,
  DEFAULT_ARCHIVE_SCAN_BATCH,
  DEFAULT_ARCHIVE_MAX_TOKENS,
  MAX_ARCHIVE_MAX_TOKENS,
  MAX_ARCHIVE_SCAN_BATCH,
  resolveHotTokenLimit,
  resolveArchiveScanBatch,
  resolveArchiveMaxTokens
};
