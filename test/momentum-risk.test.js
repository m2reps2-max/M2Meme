'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateMomentumRisk}=require('../lib/momentum-risk');

test('a +200% move is contextual and never excluded by itself',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:85,h24:210},volume:{m5:10000,h1:90000},txns:{m5:{buys:30,sells:8}}});
 assert.equal(result.detectors.extendedMove,true);
 assert.equal(result.blockPublication,false);
 assert.notEqual(result.status,'selloff');
 assert.ok(result.signals.some(x=>/hausse déjà avancée/i.test(x)));
});

test('early momentum requires buying pressure and expanding five-minute volume',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:8,h1:24,h24:40},volume:{m5:12000,h1:60000},txns:{m5:{buys:18,sells:5}}});
 assert.equal(result.detectors.earlyMomentum,true);
 assert.ok(result.adjustment>0);
});

test('a vertical acceleration without volume or buyer confirmation is penalized, not automatically blocked',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:24,h1:75,h24:110},volume:{m5:3000,h1:72000},txns:{m5:{buys:5,sells:5}}});
 assert.equal(result.detectors.accelerationWithoutConfirmation,true);
 assert.equal(result.blockPublication,false);
 assert.ok(result.adjustment<0);
});

test('profit-taking pressure is detected from a sufficiently large five-minute trade sample',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:1,h1:90},volume:{m5:7000,h1:50000},txns:{m5:{buys:5,sells:12}}});
 assert.equal(result.detectors.profitTakingPressure,true);
 assert.equal(result.blockPublication,false);
});

test('a pullback after a strong hourly rise is distinguished from a confirmed selloff',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:-4,h1:35,h24:80},volume:{m5:7000,h1:60000},txns:{m5:{buys:12,sells:8}}});
 assert.equal(result.detectors.pullback,true);
 assert.equal(result.blockPublication,false);
});

test('exhaustion and a severe confirmed selloff are detected using combined signals',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:-22,h1:45,h24:90},volume:{m5:18000,h1:60000},txns:{m5:{buys:5,sells:18}}});
 assert.equal(result.detectors.exhaustion,true);
 assert.equal(result.blockPublication,true);
 assert.equal(result.status,'selloff');
});

test('missing price and volume fields remain unknown instead of being fabricated as zero',()=>{
 const result=evaluateMomentumRisk({});
 assert.equal(result.metrics.priceChange5mPct,null);
 assert.equal(result.metrics.relativeVolume5m,null);
 assert.equal(result.detectors.earlyMomentum,false);
 assert.equal(result.blockPublication,false);
});
