'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryBudget } = require('../lib/scanner');

test('1 GiB FadeHost profile exposes a conservative memory safety margin', () => {
  const budget = memoryBudget();
  assert.equal(budget.maxHeapMiB, 420);
  assert.equal(budget.maxExternalMiB, 120);
  assert.equal(budget.maxRssMiB, 720);
});

test('memory guard still rejects work when a configured budget is exceeded', () => {
  const budget = memoryBudget({ maxHeapMiB: 0, maxExternalMiB: 0, maxRssMiB: 0 });
  assert.equal(budget.ok, false);
});
