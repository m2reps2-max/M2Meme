'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {tokenDataQuality,dataQualitySummary}=require('../lib/data-quality');

test('data quality distinguishes missing data from strong signals',()=>{
 const result=tokenDataQuality({mint:'m',symbol:'T',history:[]},1000000);
 assert.equal(result.completenessPct,0);
 assert.equal(result.quality,'low');
 assert.ok(result.issues.some(x=>x.key==='security'&&x.severity==='missing'));
 assert.equal(result.freshnessPct,null);
});

test('fresh market and on-chain observations increase completeness and freshness',()=>{
 const now=2_000_000;
 const token={mint:'m',priceUsd:1,liquidityUsd:10000,volume:{h1:100},history:[{at:now-30000,priceUsd:1}],security:{checkedAt:new Date(now-30000).toISOString(),data:{uniqueOwnerCount:10}},tradeIntel:{checkedAt:new Date(now-30000).toISOString(),tradeCount:40},socialIntel:{available:true,checkedAt:new Date(now-30000).toISOString()},launchSource:'pumpportal_new_token'};
 const result=tokenDataQuality(token,now);
 assert.equal(result.completenessPct,100);
 assert.equal(result.freshnessPct,100);
 assert.equal(result.quality,'high');
});

test('summary reports tracked tokens and bounded quality categories',()=>{
 const result=dataQualitySummary.call({state:{tokens:{a:{mint:'a'},b:{mint:'b',history:[]}}}});
 assert.equal(result.summary.tokens,2);
 assert.equal(result.tokens.length,2);
 assert.equal(result.summary.low,2);
});

test('missing timestamps stay unknown and are excluded from freshness averages',()=>{
 const now=3_000_000;
 const stale={mint:'stale',priceUsd:1,liquidityUsd:1000,volume:{h1:10},history:[{at:now-120*60000}],security:{checkedAt:new Date(now-120*60000).toISOString(),data:{}},launchSource:'dex'};
 const unknown={mint:'unknown'};
 const result=dataQualitySummary.call({state:{tokens:{stale,unknown}}});
 assert.equal(result.tokens.find(x=>x.mint==='unknown').freshnessPct,null);
 assert.ok(result.tokens.find(x=>x.mint==='unknown').issues.some(x=>x.severity==='unknown_timestamp'));
 assert.equal(result.summary.freshnessCoverageTokens,1);
 assert.equal(result.summary.freshnessCoveragePct,50);
 assert.equal(result.summary.averageFreshnessPct,0);
});
test('freshness average remains unknown when no token has timestamped observations',()=>{
 const result=dataQualitySummary.call({state:{tokens:{a:{mint:'a'},b:{mint:'b'}}}});
 assert.equal(result.summary.averageFreshnessPct,null);
 assert.equal(result.summary.freshnessCoveragePct,0);
});
