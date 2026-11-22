'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {observeLaunchCohort,resolveNoMarketCohorts,summarizeLaunchCohorts}=require('../lib/launch-cohort');

test('launch cohort tracks low-liquidity market outcomes from first observed price',()=>{
 const token={mint:'tiny',launchSource:'Pump.fun',pumpCreatedAt:new Date(1000000).toISOString()};
 observeLaunchCohort(token,{at:1000000,priceUsd:1,liquidityUsd:50});
 observeLaunchCohort(token,{at:1900000,priceUsd:1.2,liquidityUsd:45});
 assert.equal(token.launchCohort.baselinePrice,1);
 assert.equal(token.launchCohort.baselineLiquidity,50);
 assert.equal(token.launchCohort.outcomes['15m'].returnPct,20);
 assert.equal(token.launchCohort.outcomes['15m'].label,'win');
});

test('tokens with no observed market stay in the cohort and late markets are recorded',()=>{
 const token={mint:'no-market',launchSource:'Pump.fun',pumpCreatedAt:new Date(1000000).toISOString()};
 resolveNoMarketCohorts([token],1000000+1800001);
 assert.equal(token.launchCohort.marketStatus,'no_market_after_30m');
 assert.ok(token.launchCohort.noMarketAfter30mAt);
 observeLaunchCohort(token,{at:1000000+2700000,priceUsd:.01,liquidityUsd:5});
 assert.equal(token.launchCohort.marketStatus,'late_market');
});

test('cohort summary counts low-liquidity launches and no-market outcomes by source',()=>{
 const a={launchCohort:{source:'Pump.fun',baselinePrice:1,marketStatus:'market_found',outcomes:{'1h':{returnPct:25,label:'win'}}}};
 const b={launchCohort:{source:'Pump.fun',baselinePrice:null,marketStatus:'no_market_after_30m',outcomes:{}}};
 const c={launchCohort:{source:'GeckoTerminal pool',baselinePrice:.01,marketStatus:'market_found',outcomes:{'1h':{returnPct:-30,label:'loss'}}}};
 const result=summarizeLaunchCohorts([a,b,c]);
 assert.equal(result.universe.observed,3);
 assert.equal(result.universe.noMarketAfter30m,1);
 assert.equal(result.bySource['Pump.fun'].observed,2);
 assert.equal(result.universe.resolved1h,2);
 assert.match(result.method,/premier marché observable/i);
});

test('un marché absent est comptabilisé pour tout token découvert, même sans launchpad déclaré',()=>{
 const token={mint:'dex-only',sources:['profile'],firstSeenAt:new Date(1000000).toISOString()};
 const {ensureLaunchCohort}=require('../lib/launch-cohort');
 ensureLaunchCohort(token,1000000);
 resolveNoMarketCohorts([token],1000000+1800001);
 assert.equal(token.launchCohort.marketStatus,'no_market_after_30m');
});
test('une observation tardive résout le premier horizon disponible sans supprimer le résultat',()=>{
 const token={mint:'late',launchSource:'Pump.fun',pumpCreatedAt:new Date(1000000).toISOString()};
 observeLaunchCohort(token,{at:1000000,priceUsd:1,liquidityUsd:100});
 observeLaunchCohort(token,{at:1000000+1800000,priceUsd:1.25,liquidityUsd:90});
 assert.equal(token.launchCohort.outcomes['15m'].returnPct,25);
 assert.equal(token.launchCohort.outcomes['15m'].resolutionQuality,'late_observation');
});
