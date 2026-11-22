'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateTradeIntel,evaluateSocialIntel,evaluateCandidateIntel}=require('../lib/candidate-intel');
const {MemeScanner}=require('../lib/scanner');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

test('trade intelligence rewards broad buying but penalizes concentration and sell pressure',()=>{
  const healthy=evaluateTradeIntel({tradeCount:40,buyVolumeUsd:8000,sellVolumeUsd:2000,uniqueBuyers:18,top5BuyerSharePct:35,sameBlockBuyerClusters:0,earlyWindow:{complete:true,uniqueBuyers:8},buys:30,sells:10});
  const risky=evaluateTradeIntel({tradeCount:40,buyVolumeUsd:2000,sellVolumeUsd:8000,uniqueBuyers:3,top5BuyerSharePct:90,sameBlockBuyerClusters:2,earlyWindow:{complete:false,uniqueBuyers:0},buys:10,sells:30});
  assert.ok(healthy.score>risky.score);
  assert.ok(healthy.score<=100&&risky.score>=0);
});

test('social intelligence remains unavailable when no public observations exist',()=>{
  assert.equal(evaluateSocialIntel(null).score,null);
  assert.equal(evaluateSocialIntel({available:true,mentions1h:0,mentions24h:0,uniqueAuthors24h:0,sentimentScore:null}).score,null);
  const result=evaluateSocialIntel({available:true,mentions1h:4,mentions24h:8,uniqueAuthors24h:6,sentimentScore:70});
  assert.ok(result.score>50);
});

test('candidate intelligence changes ranking only modestly and does not fake data coverage',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-intel-'));
  const scanner=new MemeScanner({dataFile:path.join(dir,'store.json')});
  const token={txns:{h1:{buys:70,sells:30}},volume:{h1:25000,h24:120000},liquidityUsd:45000,ageHours:3,tradeIntel:{tradeCount:40,buyVolumeUsd:8000,sellVolumeUsd:2000,uniqueBuyers:18,top5BuyerSharePct:35,sameBlockBuyerClusters:0,earlyWindow:{complete:true,uniqueBuyers:8},buys:30,sells:10},socialIntel:{available:true,mentions1h:4,mentions24h:8,uniqueAuthors24h:6,sentimentScore:70}};
  const result=scanner.score(token);
  assert.equal(result.coverage,40);
  assert.ok(Math.abs(result.score-result.baseScore)<=6);
  assert.ok(result.factors.tradeQuality>80);
  assert.equal(result.factors.social>50,true);
});

test('social scoring rewards independent authors, channels and network spread', () => {
  const result = evaluateSocialIntel({
    available: true, mentions1h: 6, mentions24h: 12,
    uniqueAuthors24h: 5, uniqueChannels24h: 3, uniqueSources24h: 3,
    sentimentScore: 60, duplicateTexts: 0
  });
  assert.ok(result.score > 65);
  assert.ok(result.reasons.some(reason => reason.includes('Propagation')));
});

test('social scoring flags repeated public snippets without claiming proof', () => {
  const result = evaluateSocialIntel({
    available: true, mentions1h: 5, mentions24h: 8,
    uniqueAuthors24h: 1, uniqueChannels24h: 1, uniqueSources24h: 1,
    sentimentScore: 50, duplicateTexts: 4
  });
  assert.ok(result.reasons.some(reason => reason.includes('possible amplification')));
  assert.ok(result.reasons.some(reason => reason.includes('concentrées')));
});
