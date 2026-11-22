'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSocialIntel } = require('../lib/candidate-intel');

test('social scoring rewards independent authors, channels and network spread', () => {
  const result = evaluateSocialIntel({
    available: true, mentions1h: 6, mentions24h: 12,
    uniqueAuthors24h: 5, uniqueChannels24h: 3, uniqueSources24h: 3,
    sentimentScore: 60, duplicateTexts: 0
  });
  assert.ok(result.score > 65);
  assert.ok(result.reasons.some(reason => reason.includes('Propagation')));
});

test('social scoring flags repeated near-identical public posts without claiming proof', () => {
  const result = evaluateSocialIntel({
    available: true, mentions1h: 5, mentions24h: 8,
    uniqueAuthors24h: 1, uniqueChannels24h: 1, uniqueSources24h: 1,
    sentimentScore: 50, duplicateTexts: 4
  });
  assert.ok(result.reasons.some(reason => reason.includes('possible amplification')));
  assert.ok(result.reasons.some(reason => reason.includes('concentrées')));
});

test('unavailable social data does not create a positive score', () => {
  assert.equal(evaluateSocialIntel({ available: false, mentions1h: 0, mentions24h: 0 }).score, null);
});
