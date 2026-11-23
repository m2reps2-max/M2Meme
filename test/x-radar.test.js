'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSolanaMints, normalizeXPosts } = require('../lib/x-radar');

test('extracts unique base58 Solana addresses from X posts', () => {
  const mint = 'So11111111111111111111111111111111111111112';
  assert.deepEqual(extractSolanaMints('New token CA: ' + mint + ' ' + mint), [mint]);
  assert.deepEqual(extractSolanaMints('short abc123 and invalid 0OIl'), []);
});

test('normalizes recent X posts and drops duplicates and stale posts', () => {
  const now = Date.now();
  const rows = [
    { id: '1', text: 'Solana community is growing', url: 'https://x.com/a/status/1', author: 'a', publishedAt: new Date(now - 60000).toISOString(), likes: 4 },
    { id: '1', text: 'duplicate', url: 'https://x.com/a/status/1', author: 'a', publishedAt: new Date(now - 60000).toISOString() },
    { id: '2', text: 'old', author: 'b', publishedAt: new Date(now - 25 * 3600000).toISOString() },
    { id: '3', text: 'future', author: 'c', publishedAt: new Date(now + 120000).toISOString() }
  ];
  const result = normalizeXPosts(rows, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'X');
  assert.equal(result[0].author, 'a');
  assert.equal(result[0].likes, 4);
});

test('does not accept a link outside x.com', () => {
  const result = normalizeXPosts([{ id: '1', text: 'hello', url: 'https://evil.example/x', publishedAt: new Date().toISOString() }]);
  assert.equal(result[0].link, null);
});
