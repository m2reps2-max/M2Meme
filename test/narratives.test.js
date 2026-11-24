'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeSummary } = require('../lib/narratives');

const mint = 'So11111111111111111111111111111111111111112';

test('narrative trends use independent, token-matched public posts and exclude promotional Telegram channels', () => {
  const now = Date.now();
  const token = {
    mint, symbol: 'AGENTDOG', name: 'Agent Dog', firstSeenAt: new Date(now - 10 * 60000).toISOString(),
    socialIntel: { posts: [
      { source: 'Bluesky', author: 'alice.bsky.social', text: 'New AI agent token ' + mint, publishedAt: new Date(now - 60000).toISOString(), link: 'bsky:1' },
      { source: 'Bluesky', author: 'copycat.bsky.social', text: 'New AI agent token ' + mint, publishedAt: new Date(now - 90000).toISOString(), link: 'bsky:duplicate' },
      { source: 'Nostr', author: 'nostr-author-1', text: 'AI agent community ' + mint, publishedAt: new Date(now - 120000).toISOString(), link: 'nostr:1' },
      { source: 'Telegram', channel: 'solcommunitychat', channelType: 'unverified', text: 'AI agent project ' + mint, publishedAt: new Date(now - 180000).toISOString(), link: 'telegram:1' },
      { source: 'Telegram', channel: 'solcallsgems', channelType: 'promotional', text: 'AI agent 100x ' + mint, publishedAt: new Date(now - 240000).toISOString(), link: 'telegram:promo' },
      { source: 'Bluesky', author: 'unrelated.bsky.social', text: 'AI agent discussion unrelated ticker', publishedAt: new Date(now - 300000).toISOString(), link: 'bsky:unrelated' }
    ] }
  };
  const result = narrativeSummary([token], now);
  const ai = result.find(row => row.theme === 'IA / agents');
  assert.ok(ai);
  assert.equal(ai.tokens1h, 1);
  assert.equal(ai.tokens24h, 1);
  assert.equal(ai.mentions1h, 3);
  assert.equal(ai.mentions24h, 3);
  assert.equal(ai.uniqueAuthors24h, 3);
  assert.equal(ai.uniqueSources24h, 3);
  assert.equal(ai.duplicatePostsExcluded, 1);
  assert.equal(ai.trend, 'accélération observée');
  assert.equal(ai.evidence, 'mentions publiques token-matchées, non promotionnelles');
});

test('narrative summary ignores stale tokens and unrelated or ticker-only social matches', () => {
  const now = Date.now();
  const stale = { mint, symbol: 'OLD', name: 'Old Agent', firstSeenAt: new Date(now - 48 * 3600000).toISOString(), socialIntel: { posts: [] } };
  const weak = {
    mint, symbol: 'CAT', name: 'Cat Coin', firstSeenAt: new Date(now - 60000).toISOString(),
    socialIntel: { posts: [{ source: 'Bluesky', author: 'alice', text: 'CAT is an ordinary word', publishedAt: new Date(now - 1000).toISOString(), link: 'weak' }] }
  };
  const result = narrativeSummary([stale, weak], now);
  const animals = result.find(row => row.theme === 'Animaux');
  assert.ok(animals);
  assert.equal(animals.mentions24h, 0);
  assert.equal(animals.tokens24h, 1);
});
