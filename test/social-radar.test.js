'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RedditRadar, parseFeed, sentiment } = require('../lib/social-radar');

test('RSS parser extracts Reddit post metadata', () => {
  const rows = parseFeed('<rss><channel><item><title>\u003c![CDATA[Moon Cat is bullish]]\u003e</title><link>https://reddit.com/r/solana/1</link><author>u/tester</author><pubDate>Sun, 22 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>', 'r/solana');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Moon Cat is bullish');
  assert.equal(rows[0].author, 'u/tester');
  assert.ok(sentiment(rows[0].text).score > 50);
});

test('Reddit radar matches a token name and reports bounded mentions', async () => {
  const radar = new RedditRadar({ fetchImpl: async () => ({ ok: true, text: async () => '<rss><channel><item><title>Moon Cat is bullish</title><link>https://reddit.com/a</link><author>u/a</author><pubDate>Sun, 22 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>' }) });
  await radar.refresh();
  const result = radar.match({ name: 'Moon Cat', symbol: 'MCAT' });
  assert.equal(result.mentions24h, 1);
  assert.equal(result.uniqueAuthors24h, 1);
  assert.equal(result.posts.length, 1);
});
