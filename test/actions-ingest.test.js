'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { constantTimeEqual, validateHistoricalPayload, mergeHistoricalBenchmarks } = require('../lib/actions-ingest');

const allowed = new Set(['BONK', 'WIF']);
const completed = { symbol: 'BONK', completed: true, terminalReturnPct: 20, maxDrawdownPct: -30, signals: [], fetchedAt: new Date().toISOString() };

test('actions ingest compares bearer secrets without accepting mismatched values', () => {
  assert.equal(constantTimeEqual('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(constantTimeEqual('a'.repeat(32), 'b'.repeat(32)), false);
  assert.equal(constantTimeEqual('secret', 'secret-longer'), false);
});

test('actions ingest accepts only known symbols and bounded completed rows', () => {
  assert.equal(validateHistoricalPayload({ schemaVersion: 1, historicalBenchmarks: { BONK: completed } }, allowed).ok, true);
  assert.equal(validateHistoricalPayload({ schemaVersion: 2, historicalBenchmarks: { BONK: completed } }, allowed).ok, false);
  assert.equal(validateHistoricalPayload({ schemaVersion: 1, historicalBenchmarks: { UNKNOWN: completed } }, allowed).ok, false);
  assert.equal(validateHistoricalPayload({ schemaVersion: 1, historicalBenchmarks: { BONK: { ...completed, signals: Array(181).fill({}) } } }, allowed).ok, false);
});

test('actions ingest keeps a recent completed benchmark when a later run only has a failure', () => {
  const old = { BONK: completed };
  const failed = { BONK: { symbol: 'BONK', completed: false, error: '429', fetchedAt: new Date().toISOString() } };
  assert.equal(mergeHistoricalBenchmarks(old, failed)[ 'BONK' ].completed, true);
  assert.equal(mergeHistoricalBenchmarks({}, failed).BONK.completed, false);
});
