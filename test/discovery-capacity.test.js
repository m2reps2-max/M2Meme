'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_HOT_TOKEN_LIMIT,
  DEGRADED_HOT_TOKEN_LIMIT,
  DEFAULT_ARCHIVE_SCAN_BATCH,
  DEFAULT_ARCHIVE_MAX_TOKENS,
  MAX_ARCHIVE_MAX_TOKENS,
  resolveHotTokenLimit,
  resolveArchiveScanBatch
} = require('../lib/discovery-capacity');

test('active token cache defaults to 7000 and remains bounded to 1200..8000', () => {
  assert.equal(DEFAULT_HOT_TOKEN_LIMIT, 7000);
  assert.equal(resolveHotTokenLimit(undefined), 7000);
  assert.equal(resolveHotTokenLimit('6500'), 6500);
  assert.equal(resolveHotTokenLimit('900'), 1200);
  assert.equal(resolveHotTokenLimit('9000'), 8000);
  assert.equal(resolveHotTokenLimit('invalid'), 7000);
  assert.equal(DEGRADED_HOT_TOKEN_LIMIT, 1200);
});

test('archive scan batch defaults to 50 and remains bounded to 20..50', () => {
  assert.equal(DEFAULT_ARCHIVE_SCAN_BATCH, 50);
  assert.equal(resolveArchiveScanBatch(undefined), 50);
  assert.equal(resolveArchiveScanBatch('50'), 50);
  assert.equal(resolveArchiveScanBatch('5'), 20);
  assert.equal(resolveArchiveScanBatch('500'), 50);
  assert.equal(resolveArchiveScanBatch('invalid'), 50);
});

test('cold archive defaults to 50000 tokens and remains bounded to 100000', () => {
  const { resolveArchiveMaxTokens } = require('../lib/discovery-capacity');
  assert.equal(DEFAULT_ARCHIVE_MAX_TOKENS, 50000);
  assert.equal(resolveArchiveMaxTokens(undefined), 50000);
  assert.equal(resolveArchiveMaxTokens('75000'), 75000);
  assert.equal(resolveArchiveMaxTokens('500'), 1000);
  assert.equal(resolveArchiveMaxTokens('250000'), MAX_ARCHIVE_MAX_TOKENS);
  assert.equal(resolveArchiveMaxTokens('invalid'), 50000);
});
