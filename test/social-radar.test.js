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

test('RSS links outside Reddit HTTPS are discarded', () => {
  const rows = parseFeed('<rss><channel><item><title>Moon Cat</title><link>javascript:alert(1)</link><pubDate>Sun, 22 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>', 'r/solana');
  assert.equal(rows[0].link, '');
});

test('Reddit RSS failures back off instead of hammering a discontinued endpoint', async () => {
  let calls = 0;
  const radar = new RedditRadar({ fetchImpl: async () => { calls++; return { ok: false, status: 410 }; } });
  await assert.rejects(() => radar.refresh(), /Reddit RSS HTTP 410/);
  const status = radar.status();
  assert.equal(status.connected, false);
  assert.equal(status.failureCount, 1);
  assert.ok(status.nextRetryAt);
  const retry = await radar.refresh();
  assert.equal(retry.skipped, true);
  assert.equal(retry.reason, 'backoff');
  assert.equal(calls, 3);
});

test('Reddit source status requires a recent successful refresh', async () => {
  const radar = new RedditRadar({ fetchImpl: async () => ({ ok: true, text: async () => '<rss><channel></channel></rss>' }) });
  await radar.refresh();
  assert.equal(radar.status().connected, true);
});
