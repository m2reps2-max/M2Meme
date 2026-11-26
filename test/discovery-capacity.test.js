'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_HOT_TOKEN_LIMIT,
  DEFAULT_ARCHIVE_SCAN_BATCH,
  resolveHotTokenLimit,
  resolveArchiveScanBatch
} = require('../lib/discovery-capacity');

test('active token cache defaults to 2500 and remains bounded to 1200..5000', () => {
  assert.equal(DEFAULT_HOT_TOKEN_LIMIT, 2500);
  assert.equal(resolveHotTokenLimit(undefined), 2500);
  assert.equal(resolveHotTokenLimit('3500'), 3500);
  assert.equal(resolveHotTokenLimit('900'), 1200);
  assert.equal(resolveHotTokenLimit('9000'), 5000);
  assert.equal(resolveHotTokenLimit('invalid'), 2500);
});

test('archive scan batch defaults to 40 and remains bounded to 20..50', () => {
  assert.equal(DEFAULT_ARCHIVE_SCAN_BATCH, 40);
  assert.equal(resolveArchiveScanBatch(undefined), 40);
  assert.equal(resolveArchiveScanBatch('50'), 50);
  assert.equal(resolveArchiveScanBatch('5'), 20);
  assert.equal(resolveArchiveScanBatch('500'), 50);
  assert.equal(resolveArchiveScanBatch('invalid'), 40);
});
