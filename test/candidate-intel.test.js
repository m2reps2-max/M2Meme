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
  const result=evaluateSocialIntel({available:true,mentions1h:4,mentions24h:8,uniqueAuthors24h:6,sentimentScore:70});
  assert.ok(result.score>50);
});

test('candidate intelligence changes ranking only modestly and does not fake data coverage',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-intel-'));
  const scanner=new MemeScanner({dataFile:path.join(dir,'store.json')});
  const token={txns:{h1:{buys:70,sells:30}},volume:{h1:25000,h24:120000},liquidityUsd:45000,ageHours:3,tradeIntel:{tradeCount:40,buyVolumeUsd:8000,sellVolumeUsd:2000,uniqueBuyers:18,top5BuyerSharePct:35,sameBlockBuyerClusters:0,earlyWindow:{complete:true,uniqueBuyers:8},buys:30,sells:10},socialIntel:{available:true,mentions1h:4,mentions24h:8,uniqueAuthors24h:6,sentimentScore:70}};
  const result=scanner.score(token);
  assert.equal(result.coverage,75);
  assert.ok(Math.abs(result.score-result.baseScore)<=6);
  assert.equal(result.factors.tradeQuality,100);
  assert.equal(result.factors.social>50,true);
});
