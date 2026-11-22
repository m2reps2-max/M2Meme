'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {learningSummary}=require('../lib/learning');

test('learning summary aggregates forecasts without duplicating full forecast rows',()=>{
 const scanner={state:{tokens:{
  a:{mint:'a',symbol:'AAA',forecasts:[
   {at:1000,score:80,source:'Pump.fun',launchAgeHours:0.02,liquidityBand:'1k_5k',outcomes:{'1h':{label:'win',returnPct:20},'15m':{label:'win',returnPct:10}}},
   {at:2000,score:70,source:'Pump.fun',launchAgeHours:0.2,liquidityBand:'1k_5k',outcomes:{'1h':{label:'loss',returnPct:-25}}}
  ]},
  b:{mint:'b',symbol:'BBB',forecasts:[
   {at:3000,score:55,source:'GeckoTerminal pool',launchAgeHours:null,liquidityBand:'under_1k',outcomes:{'1h':{label:'flat',returnPct:10}}}
  ]}
 }}};
 const result=learningSummary.call(scanner);
 assert.equal(result.summary.forecasts,3);
 assert.equal(result.summary.trackedTokens,2);
 assert.equal(result.successRate.evaluated,3);
 assert.equal(result.successRate.successful,1);
 assert.equal(result.successRate.ratePct,33.3);
 assert.equal(result.horizonsAvailable.length,5);
 assert.equal(result.cohorts.bySource['Pump.fun'].predictions,2);
 assert.equal(result.cohorts.bySource['Pump.fun'].resolved,2);
 assert.equal(result.cohorts.byLiquidity.under_1k.average1hPct,10);
 assert.equal(result.outOfSample.uniqueResolvedTokens,2);
});

test('learning summary caches expensive derived statistics briefly',()=>{
 const scanner={state:{tokens:{a:{mint:'a',forecasts:[{at:1000,score:80,outcomes:{'1h':{label:'win',returnPct:20}}}]}}}};
 const first=learningSummary.call(scanner);
 const second=learningSummary.call(scanner);
 assert.strictEqual(first,second);
 assert.ok(scanner._learningSummaryCache.at>0);
});
