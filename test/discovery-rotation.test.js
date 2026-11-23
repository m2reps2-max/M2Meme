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
