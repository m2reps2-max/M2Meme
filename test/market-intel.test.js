'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeMicrostructure}=require('../lib/market-intel');

test('microstructure detects a sharp five-minute sell imbalance',()=>{
 const result=analyzeMicrostructure({txns:{m5:{buys:3,sells:15}},volume:{m5:12000,h1:50000},liquidityUsd:25000,priceChange:{m5:-4}});
 assert.ok(result.score!==null);
 assert.ok(result.flags.some(x=>x.code==='MICRO_SELL_PRESSURE'));
 assert.equal(result.metrics.buyRatio5mPct,16.7);
});

test('microstructure flags a sudden price crash',()=>{
 const result=analyzeMicrostructure({txns:{m5:{buys:20,sells:4}},volume:{m5:10000,h1:50000},liquidityUsd:30000,priceChange:{m5:-24}});
 assert.ok(result.flags.some(x=>x.code==='MICRO_CRASH'&&x.level==='critical'));
});

test('microstructure stays unknown when no five-minute signal exists',()=>{
 const result=analyzeMicrostructure({});
 assert.equal(result.score,null);
 assert.equal(result.flags.length,0);
});

test('missing five-minute fields are not interpreted as zero activity',()=>{
 const result=analyzeMicrostructure({volume:{h1:50000},txns:{h1:{buys:100,sells:20}}});
 assert.equal(result.score,null);
 assert.equal(result.metrics.relativeVolume5m,null);
});
