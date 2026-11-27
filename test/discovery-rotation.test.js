'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRotatingBatch, selectFreshDiscoveryBatch } = require('../lib/discovery-rotation');

test('fresh discovery enrichment rotates through all discovered mints', () => {
  const mints = Array.from({ length: 170 }, (_, index) => 'mint-' + index);
  const first = selectRotatingBatch(mints, 0, 100);
  const second = selectRotatingBatch(mints, first.nextCursor, 100);
  assert.equal(first.items.length, 100);
  assert.equal(second.items.length, 100);
  assert.equal(new Set([...first.items, ...second.items]).size, 170);
  assert.deepEqual(first.items.slice(0, 3), ['mint-0', 'mint-1', 'mint-2']);
  assert.deepEqual(second.items.slice(0, 3), ['mint-100', 'mint-101', 'mint-102']);
  assert.equal(second.nextCursor, 30);
});

test('fresh discovery rotation wraps around and stays bounded', () => {
  const mints = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(selectRotatingBatch(mints, 4, 3), { items: ['e', 'a', 'b'], nextCursor: 2 });
  assert.deepEqual(selectRotatingBatch(mints, 99, 10), { items: ['e', 'a', 'b', 'c', 'd'], nextCursor: 4 });
  assert.deepEqual(selectRotatingBatch([], 5, 10), { items: [], nextCursor: 0 });
});


test('fresh discovery batch excludes tokens already prioritized elsewhere', () => {
  const discovered = ['watch', 'tracked', 'fresh-c', 'fresh-a', 'fresh-b', 'fresh-a', 'recent'];
  const priority = ['watch', 'tracked', 'recent'];
  const first = selectFreshDiscoveryBatch(discovered, priority, 0, 2);
  const second = selectFreshDiscoveryBatch(discovered, priority, first.nextCursor, 2);
  assert.deepEqual(first.items, ['fresh-a', 'fresh-b']);
  assert.deepEqual(second.items, ['fresh-c', 'fresh-a']);
  assert.equal(first.items.some(mint => priority.includes(mint)), false);
  assert.equal(new Set(first.items).size, first.items.length);
});


test('near-threshold score focus prioritizes linked candidates without admitting hard-blocked or high-risk tokens', () => {
  const { selectScoreFocusCandidates } = require('../lib/discovery-rotation');
  const candidates = [
    { mint: 'below-floor', pairAddress: 'pair-a', analysis: { score: 64, risk: 'low' } },
    { mint: 'at-floor', pairAddress: 'pair-b', liquidityUsd: 1000, analysis: { score: 65, risk: 'low' } },
    { mint: 'best', geckoPoolAddress: 'pool-c', liquidityUsd: 500, analysis: { score: 92, risk: 'medium' } },
    { mint: 'blocked', pairAddress: 'pair-d', analysis: { score: 99, risk: 'low', hardBlocked: true } },
    { mint: 'high-risk', pairAddress: 'pair-e', analysis: { score: 98, risk: 'high' } },
    { mint: 'unlinked', analysis: { score: 97, risk: 'low' } },
    { mint: 'unknown-score', pairAddress: 'pair-f', analysis: { risk: 'low' } }
  ];
  const selected = selectScoreFocusCandidates(candidates, 80, 30);
  assert.deepEqual(selected.map(token => token.mint), ['best', 'at-floor']);
});

test('score focus adapts its floor to the dashboard minimum and remains capped at thirty', () => {
  const { selectScoreFocusCandidates } = require('../lib/discovery-rotation');
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    mint: 'mint-' + index,
    pairAddress: 'pair-' + index,
    liquidityUsd: index,
    analysis: { score: 95 - index, risk: 'low', hardBlocked: false }
  }));
  assert.equal(selectScoreFocusCandidates(candidates, 95).length, 16);
  assert.equal(selectScoreFocusCandidates(candidates, 70).length, 30);
  assert.equal(selectScoreFocusCandidates(candidates, 70).at(-1).analysis.score, 66);
});


test('market refresh allocation reserves room for fresh launches after follow-up lanes', () => {
  const { buildMarketRefreshBatch } = require('../lib/discovery-rotation');
  const rows = buildMarketRefreshBatch({
    telegramPerformance: Array.from({ length: 40 }, (_, i) => 'perf-' + i),
    watchlist: Array.from({ length: 20 }, (_, i) => 'watch-' + i),
    recentLaunches: Array.from({ length: 20 }, (_, i) => 'launch-' + i),
    scoreFocus: Array.from({ length: 30 }, (_, i) => 'score-' + i),
    social: Array.from({ length: 40 }, (_, i) => 'social-' + i),
    archived: Array.from({ length: 50 }, (_, i) => 'archive-' + i),
    tracked: Array.from({ length: 60 }, (_, i) => 'tracked-' + i),
    fresh: Array.from({ length: 240 }, (_, i) => 'fresh-' + i),
    limit: 360
  });
  assert.equal(rows.length, 360);
  assert.equal(new Set(rows).size, 320);
  assert.equal(rows[0], 'perf-0');
  assert.equal(rows[60], 'launch-0');
  assert.equal(rows[260], 'fresh-0');
  assert.equal(rows.at(-1), 'fresh-99');
});

test('market refresh allocation deduplicates overlapping priority lanes', () => {
  const { buildMarketRefreshBatch } = require('../lib/discovery-rotation');
  assert.deepEqual(buildMarketRefreshBatch({
    telegramPerformance: ['a', 'b'],
    recentLaunches: ['b', 'c'],
    tracked: ['c', 'd'],
    fresh: ['d', 'e'],
    limit: 10
  }), ['a', 'b', 'c', 'd', 'e']);
});
