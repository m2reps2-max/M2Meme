'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTokenMention, analyzeSocialEvidence } = require('../lib/social-evidence');

const token = { mint: 'So11111111111111111111111111111111111111112', symbol: 'MOON', name: 'Moon Rocket' };

test('token identity prefers mint and cashtag over ambiguous bare ticker', () => {
  assert.equal(classifyTokenMention('Contract: ' + token.mint, token), 'mint');
  assert.equal(classifyTokenMention('Watching $MOON today', token), 'cashtag');
  assert.equal(classifyTokenMention('MOON is moving', token), 'ticker');
  assert.equal(classifyTokenMention('Moon Rocket launches', token), 'name');
  assert.equal(classifyTokenMention('the lunar surface is bright', token), 'none');
});

test('social evidence counts independent authors by network and Telegram channels separately', () => {
  const now = Date.now();
  const posts = [
    { source: 'Bluesky', author: 'alice.bsky.social', text: 'Buying $MOON early', publishedAt: new Date(now - 1000).toISOString(), link: 'bsky:1' },
    { source: 'Bluesky', author: 'alice.bsky.social', text: 'Still watching $MOON', publishedAt: new Date(now - 2000).toISOString(), link: 'bsky:2' },
    { source: 'Nostr', author: 'alice-bsky-copy', text: 'Buying $MOON early', publishedAt: new Date(now - 3000).toISOString(), link: 'nostr:1' },
    { source: 'Telegram', channel: 'sol_alpha', text: 'Contract ' + token.mint, publishedAt: new Date(now - 4000).toISOString(), link: 'tg:1' },
    { source: 'Telegram', channel: 'sol_beta', text: 'Contract ' + token.mint, publishedAt: new Date(now - 5000).toISOString(), link: 'tg:2' }
  ];
  const result = analyzeSocialEvidence(posts, token, now);
  assert.equal(result.sampledPosts24h, 5);
  assert.equal(result.uniqueAuthors24h, 2);
  assert.equal(result.uniqueChannels24h, 2);
  assert.equal(result.uniqueSources24h, 3);
  assert.equal(result.duplicateTexts, 2);
  assert.equal(result.weakTickerMatches, 0);
});

test('social evidence ignores stale, future and unrelated posts', () => {
  const now = Date.now();
  const result = analyzeSocialEvidence([
    { source: 'Bluesky', author: 'a', text: '$MOON', publishedAt: new Date(now - 25 * 3600000).toISOString(), link: 'old' },
    { source: 'Bluesky', author: 'b', text: 'BTC is up', publishedAt: new Date(now).toISOString(), link: 'unrelated' },
    { source: 'Bluesky', author: 'c', text: '$MOON', publishedAt: new Date(now + 120000).toISOString(), link: 'future' }
  ], token, now);
  assert.equal(result.sampledPosts24h, 0);
  assert.equal(result.uniqueAuthors24h, 0);
});

test('social scoring discounts repeated and ticker-only posts without allowing social dominance', () => {
  const { evaluateSocialIntel } = require('../lib/candidate-intel');
  const result = evaluateSocialIntel({
    available: true, mentions1h: 8, mentions24h: 30, sentimentScore: 90,
    evidence: { sampledPosts24h: 10, uniqueAuthors24h: 2, uniqueChannels24h: 1, uniqueSources24h: 2, duplicateSharePct: 60, weakMatchSharePct: 80 }
  });
  assert.ok(result.score < 70);
  assert.ok(result.reasons.some(reason => reason.includes('ticker')));
  assert.ok(result.reasons.some(reason => reason.includes('similaires')));
});


test('promotional Telegram call channels do not count as independent community evidence',()=>{
  const now=Date.now();
  const posts=[
    {source:'Telegram',channel:'solcallsgems',channelType:'promotional',text:'Contract '+token.mint,publishedAt:new Date(now-1000).toISOString(),link:'tg:promo'},
    {source:'Telegram',channel:'solcommunitychat',channelType:'unverified',text:'Contract '+token.mint,publishedAt:new Date(now-2000).toISOString(),link:'tg:community'},
    {source:'Bluesky',author:'alice.bsky.social',text:'Contract '+token.mint,publishedAt:new Date(now-3000).toISOString(),link:'bsky:community'}
  ];
  const evidence=analyzeSocialEvidence(posts,token,now);
  assert.equal(evidence.sampledPosts24h,3);
  assert.equal(evidence.promotionalPosts24h,1);
  assert.equal(evidence.nonPromotionalPosts24h,2);
  assert.equal(evidence.uniqueChannels24h,1);
  assert.equal(evidence.uniqueAuthors24h,1);
  assert.equal(evidence.nonPromotionalMentions1h,2);
  const {evaluateSocialIntel}=require('../lib/candidate-intel');
  const scored=evaluateSocialIntel({available:true,mentions1h:3,mentions24h:3,evidence});
  assert.notEqual(scored.score,null);
  const promoOnly=analyzeSocialEvidence([posts[0]],token,now);
  const rejected=evaluateSocialIntel({available:true,mentions1h:1,mentions24h:1,evidence:promoOnly});
  assert.equal(rejected.score,null);
  assert.equal(rejected.confidence,'promotional_only');
});
