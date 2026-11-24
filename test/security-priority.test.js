'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rankSecurityCandidates, MIN_SECURITY_REFRESH_AGE_MS } = require('../lib/security-priority');

test('security queue prioritizes strong candidates while preserving an age-based fairness bonus', () => {
  const now = 10_000_000;
  const tokens = [
    { mint: 'high-score', pairAddress: 'p1', analysis: { score: 92 }, security: { checkedAt: new Date(now - MIN_SECURITY_REFRESH_AGE_MS - 1).toISOString() } },
    { mint: 'low-score-old', pairAddress: 'p2', analysis: { score: 74 }, security: { checkedAt: new Date(now - 30 * 3600000).toISOString() } },
    { mint: 'fresh', pairAddress: 'p3', analysis: { score: 100 }, security: { checkedAt: new Date(now - 10 * 60000).toISOString() } },
    { mint: 'unlinked', analysis: { score: 100 } },
    { mint: 'launch', pairAddress: 'p4', launchSource: 'pumpfun', analysis: { score: 85 } }
  ];
  const selected = rankSecurityCandidates(tokens, now, 3);
  assert.deepEqual(selected.map(token => token.mint), ['launch', 'low-score-old', 'high-score']);
});

test('security queue is deterministic, bounded and excludes fresh or unlinked tokens', () => {
  const now = 20_000_000;
  const tokens = Array.from({ length: 12 }, (_, index) => ({ mint: 'mint-' + index, pairAddress: 'pool-' + index, analysis: { score: 70 + index } }));
  tokens.push({ mint: 'fresh', pairAddress: 'fresh-pool', analysis: { score: 100 }, security: { checkedAt: new Date(now - 1000).toISOString() } });
  assert.equal(rankSecurityCandidates(tokens, now, 4).length, 4);
  assert.deepEqual(rankSecurityCandidates(tokens, now, 4).map(x => x.mint), rankSecurityCandidates(tokens, now, 4).map(x => x.mint));
  assert.ok(!rankSecurityCandidates(tokens, now, 20).some(x => x.mint === 'fresh'));
});
