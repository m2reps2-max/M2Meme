'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSolanaMints, normalizeXPosts, XSocialRadar, DEFAULT_QUERIES } = require('../lib/x-radar');

test('extracts unique base58 Solana addresses from X posts', () => {
  const mint = 'So11111111111111111111111111111111111111112';
  assert.deepEqual(extractSolanaMints('New token CA: ' + mint + ' ' + mint), [mint]);
  assert.deepEqual(extractSolanaMints('short abc123 and invalid 0OIl'), []);
});

test('normalizes recent X posts and drops duplicates and stale posts', () => {
  const now = Date.now();
  const rows = [
    { id: '1', text: 'Solana community is growing', url: 'https://x.com/a/status/1', author: 'a', created_at: new Date(now - 60000).toISOString(), likes: 4 },
    { id: '1', text: 'duplicate', url: 'https://x.com/a/status/1', author: 'a', created_at: new Date(now - 60000).toISOString() },
    { id: '2', text: 'old', author: 'b', created_at: new Date(now - 25 * 3600000).toISOString() },
    { id: '3', text: 'future', author: 'c', created_at: new Date(now + 120000).toISOString() }
  ];
  const result = normalizeXPosts(rows, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'X');
  assert.equal(result[0].author, 'a');
  assert.equal(result[0].likes, 4);
});

test('does not accept a link outside x.com', () => {
  const result = normalizeXPosts([{ id: '1', text: 'hello', url: 'https://evil.example/x', created_at: new Date().toISOString() }]);
  assert.equal(result[0].link, null);
});

test('keeps X disabled when session credentials are absent', async () => {
  const radar = new XSocialRadar({ env: {} });
  const result = await radar.search();
  assert.equal(result.available, false);
  assert.equal(result.configured, false);
  assert.equal(result.posts.length, 0);
});

test('rotates one bounded query per cycle', () => {
  const radar = new XSocialRadar({ env: {} });
  assert.equal(radar.queries().length, 3);
  assert.equal(DEFAULT_QUERIES.length, 3);
});


test('uses one bounded X search and caches its result', async () => {
  let searches = 0;
  let options;
  const now = Date.now();
  const radar = new XSocialRadar({
    env: { X_AUTH_TOKEN: 'test-auth', X_CT0: 'test-csrf' },
    clientFactory: async value => {
      options = value;
      return {
        search: async (query, count, product) => {
          searches++;
          assert.equal(count, 20);
          assert.equal(product, 'Latest');
          assert.ok(query.length > 0);
          return [{ id: '42', text: 'A new Solana token', author: 'builder', created_at: new Date(now - 30000).toISOString(), likes: 3, retweets: 2, replies: 1, url: 'https://x.com/builder/status/42' }];
        }
      };
    }
  });
  const first = await radar.search();
  const second = await radar.search();
  assert.equal(searches, 1);
  assert.equal(first.available, true);
  assert.equal(second.posts[0].id, '42');
  assert.equal(first.mentions1h, 1);
  assert.equal(first.uniqueAuthors24h, 1);
  assert.equal(first.engagement24h, 6);
  assert.equal(options.retries, 1);
});
