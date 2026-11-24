'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TelegramRadar, extractPublicChannels, extractHeaderChannels, parseTelegramPage, tokenMention, classifyTelegramChannel } = require('../lib/telegram-radar');

test('extracts only public Telegram channel links from token metadata', () => {
  const channels = extractPublicChannels({
    socials: [{ type: 'telegram', url: 'https://t.me/s/MemeRadarOfficial' }],
    links: [{ url: 'https://telegram.me/MemeRadarOfficial/123' }, { url: 'https://t.me/+privateInvite' }],
    description: 'Join https://t.me/AnotherPublicChannel'
  });
  assert.deepEqual(channels, ['memeradarofficial', 'anotherpublicchannel']);
});

test('parses public Telegram channel messages and rejects malformed timestamps', () => {
  const now = Date.now();
  const html = '<div class="tgme_widget_message" data-post="TestChannel/123"><div class="tgme_widget_message_text js-message_text">$BONK is moving &amp; bullish</div><time datetime="' + new Date(now - 60000).toISOString() + '"></time></div>' +
    '<div class="tgme_widget_message" data-post="TestChannel/124"><div class="tgme_widget_message_text">bad date</div><time datetime="not-a-date"></time></div>';
  const posts = parseTelegramPage(html, 'TestChannel', now);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /\$BONK is moving & bullish/);
  assert.match(posts[0].link, /t\.me\/testchannel\/123/);
});

test('token matching prefers mint and rejects ambiguous short symbols', () => {
  assert.equal(tokenMention('Mint123456789ABCDEFGHJKLMNPQRSTUVWXYZ', { mint: 'Mint123456789ABCDEFGHJKLMNPQRSTUVWXYZ', symbol: 'CAT' }), true);
  assert.equal(tokenMention('CATCH is moving', { mint: 'SomeOtherMint123456789012345678901234', symbol: 'CAT' }), false);
  assert.equal(tokenMention('$BONK is moving', { mint: 'SomeOtherMint123456789012345678901234', symbol: 'BONK' }), true);
});

test('Telegram radar uses public pages, caches channels and reports partial failures', async () => {
  let calls = 0;
  const radar = new TelegramRadar({ fetchImpl: async url => {
    calls++;
    assert.match(String(url), /t\.me\/s\/memeradarofficial/);
    return { ok: true, text: async () => '<div data-post="MemeRadarOfficial/1"><div class="tgme_widget_message_text">$BONK rising</div><time datetime="' + new Date().toISOString() + '"></time></div>' };
  } });
  const token = { mint: 'SomeOtherMint123456789012345678901234', symbol: 'BONK', socials: [{ url: 'https://t.me/MemeRadarOfficial' }] };
  const result = await radar.searchToken(token);
  assert.equal(result.available, true);
  assert.equal(result.mentions1h, 1);
  assert.equal(result.uniqueChannels24h, 1);
  await radar.searchToken(token);
  assert.equal(calls, 1);
  assert.equal(radar.status().connected, true);
});

test('Telegram radar reports no global search when a token has no public channel link', async () => {
  let calls = 0;
  const radar = new TelegramRadar({ fetchImpl: async () => { calls++; throw new Error('must not fetch'); } });
  const result = await radar.searchToken({ mint: 'SomeOtherMint123456789012345678901234', symbol: 'BONK' });
  assert.equal(result.available, false);
  assert.equal(result.channelsScanned, 0);
  assert.equal(calls, 0);
});

test('discovers related public channels from curated crypto sources and matches posts globally', async () => {
  const calls = [];
  const now = new Date().toISOString();
  const radar = new TelegramRadar({
    seedChannels: ['solearlytrending'],
    fetchImpl: async url => {
      calls.push(String(url));
      return {
        ok: true,
        text: async () => '<header><a href="https://t.me/solearlytrending">@solearlytrending</a><a href="https://t.me/solwhaletrending">Whale</a></header>' +
          '<div data-post="solearlytrending/1"><div class="tgme_widget_message_text">$BONK momentum is increasing</div><time datetime="' + now + '"></time></div>'
      };
    }
  });
  const result = await radar.discoverPublicChannels({ limit: 1 });
  assert.equal(result.scanned, 1);
  assert.ok(radar.discoveryChannels.includes('solwhaletrending'));
  const matched = radar.matchDiscoveredToken({ mint: 'SomeOtherMint123456789012345678901234', symbol: 'BONK' });
  assert.equal(matched.available, true);
  assert.equal(matched.mentions1h, 1);
  assert.equal(matched.uniqueChannels24h, 1);
  assert.equal(calls.length, 1);
});

test('extracts only Telegram links from the public channel header', () => {
  const html = '<header><a href="https://t.me/solwhaletrending">Whale</a></header>' +
    '<div data-post="seedchannel/1"><a href="https://t.me/randomtokenchannel">Token</a></div>';
  assert.deepEqual(extractHeaderChannels(html), ['solwhaletrending']);
});

test('default Telegram radar is configured for 50 unique public-channel candidates', () => {
  const { DISCOVERY_SEEDS, MAX_DISCOVERY_CHANNELS, DISCOVERY_BATCH_SIZE } = require('../lib/telegram-radar');
  assert.equal(DISCOVERY_SEEDS.length, 50);
  assert.equal(new Set(DISCOVERY_SEEDS.map(x => x.toLowerCase())).size, 50);
  assert.equal(MAX_DISCOVERY_CHANNELS, 50);
  assert.equal(DISCOVERY_BATCH_SIZE, 4);
  assert.deepEqual(DISCOVERY_SEEDS.slice(0, 5), ['solearlytrending', 'solwhaletrending', 'soltrenchtrending', 'spydefi', 'arcanegems']);
});

test('default discovery scans up to four configured channels per cycle', async () => {
  const calls = [];
  const radar = new TelegramRadar({
    fetchImpl: async url => {
      calls.push(String(url));
      return { ok: true, text: async () => '<div class="tgme_page">public channel</div>' };
    }
  });
  const result = await radar.discoverPublicChannels();
  assert.equal(result.scanned, 4);
  assert.equal(result.discoveredChannels, 50);
  assert.equal(calls.length, 4);
  assert.equal(radar.status().discovery.configuredChannels, 50);
  assert.equal(radar.status().discovery.batchSize, 4);
});

test('Telegram public page rejects an oversized HTML response',async()=>{
 const radar=new TelegramRadar({seedChannels:['memeradarofficial'],fetchImpl:async()=>({ok:true,headers:{get:()=> '600000'},body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'));controller.close();}})})});
 await assert.rejects(()=>radar.channelPosts('memeradarofficial'),/trop volumineuse/);
});


test('Telegram source classification marks obvious calls and signal channels as promotional',()=>{
  assert.equal(classifyTelegramChannel('solwhaletrending'),'promotional');
  assert.equal(classifyTelegramChannel('mars100xcryptocalls'),'promotional');
  assert.equal(classifyTelegramChannel('solcommunitychat'),'unverified');
  assert.equal(classifyTelegramChannel('solwhalealerts'),'unverified');
  const now=Date.now();
  const posts=parseTelegramPage('<div data-post="solwhaletrending/1"><div class="tgme_widget_message_text">$BONK</div><time datetime="'+new Date(now-1000).toISOString()+'"></time></div>','solwhaletrending',now);
  assert.equal(posts[0].channelType,'promotional');
});


test('Telegram source heuristic is narrow: generic whale and quant channels stay unverified',()=>{
  assert.equal(classifyTelegramChannel('mars100xcryptocalls'),'promotional');
  assert.equal(classifyTelegramChannel('soltrenchtrending'),'promotional');
  assert.equal(classifyTelegramChannel('solwhaleintel'),'unverified');
  assert.equal(classifyTelegramChannel('QwertysQuants'),'unverified');
});
