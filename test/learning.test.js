'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {learningSummary,recordForecast}=require('../lib/learning');

test('le taux de réussite à une heure compte les hausses de 15% ou plus',()=>{
 const scanner={state:{tokens:{
  a:{mint:'a',symbol:'AAA',forecasts:[
   {score:80,at:1,outcomes:{'1h':{label:'win',returnPct:18}}},
   {score:70,at:2,outcomes:{'1h':{label:'strong_win',returnPct:65}}}
  ]},
  b:{mint:'b',symbol:'BBB',forecasts:[
   {score:60,at:3,outcomes:{'1h':{label:'flat',returnPct:2}}},
   {score:50,at:4,outcomes:{'1h':{label:'liquidity_stress',returnPct:25}}}
  ]}
 }}};
 const result=learningSummary.call(scanner);
 assert.equal(result.successRate.horizon,'1h');
 assert.equal(result.successRate.minReturnPct,15);
 assert.equal(result.successRate.evaluated,4);
 assert.equal(result.successRate.successful,3);
 assert.equal(result.successRate.ratePct,75);
});

test('le taux reste indisponible tant qu’aucune observation à une heure n’est résolue',()=>{
 const result=learningSummary.call({state:{tokens:{a:{mint:'a',forecasts:[{at:1,score:80,outcomes:{}}]}}}});
 assert.equal(result.successRate.evaluated,0);
 assert.equal(result.successRate.ratePct,null);
});

test('les prévisions enregistrent le maximum favorable et le drawdown',()=>{
 const token={mint:'mint',forecasts:[]};
 const base={priceUsd:1,liquidityUsd:10000,volume1h:1000,volume24h:5000,buys1h:20,sells1h:10,fdv:50000,score:80,coverage:90,classification:'strong_candidate',risk:'low',flags:[]};
 recordForecast(token,{...base,at:1000000});
 recordForecast(token,{...base,at:1900000,priceUsd:1.3});
 recordForecast(token,{...base,at:4600000,priceUsd:.8});
 const outcome=token.forecasts[0].outcomes['1h'];
 assert.equal(outcome.returnPct,-20);
 assert.equal(outcome.maxFavorablePct,30);
 assert.equal(outcome.maxAdversePct,-20);
});

test('learning segments one-hour outcomes by discovery source and launch age',()=>{
 const result=learningSummary.call({state:{tokens:{
  a:{mint:'a',forecasts:[{score:80,at:1000,source:'Pump.fun',launchAgeHours:0.02,outcomes:{'1h':{label:'win',returnPct:20}}}]},
  b:{mint:'b',forecasts:[{score:60,at:2000,source:'GeckoTerminal pool',launchAgeHours:0.2,outcomes:{'1h':{label:'loss',returnPct:-25}}}]}
 }}});
 assert.equal(result.cohorts.bySource['Pump.fun'].winRate1hPct,100);
 assert.equal(result.cohorts.bySource['GeckoTerminal pool'].lossRate1hPct,100);
 assert.equal(result.cohorts.byLaunchAge['0–5 min'].resolved,1);
 assert.equal(result.cohorts.byLaunchAge['5–30 min'].resolved,1);
});

test('new forecast records discovery source and preserves unknown age',()=>{
 const token={mint:'mint',geckoPoolAddress:'pool',forecasts:[]};
 recordForecast(token,{priceUsd:1,liquidityUsd:2000,volume1h:100,volume24h:500,buys1h:4,sells1h:2,fdv:10000,score:70,coverage:80,classification:'watch',risk:'unknown',flags:[],at:1000000});
 assert.equal(token.forecasts[0].source,'GeckoTerminal pool');
 assert.equal(token.forecasts[0].launchAgeHours,null);
});

test('out-of-sample calibration separates mints and counts one first forecast per token',()=>{
 const tokens={};
 for(let i=0;i<100;i++){
  const mint='MintCalibration'+String(i).padStart(4,'0');
  tokens[mint]={mint,forecasts:[
   {at:i+1,score:80,source:'test',outcomes:{'1h':{returnPct:20,label:'win'}}},
   {at:i+2,score:90,source:'test',outcomes:{'1h':{returnPct:-25,label:'loss'}}}
  ]};
 }
 const result=learningSummary.call({state:{tokens}}).outOfSample;
 assert.equal(result.uniqueResolvedTokens,100);
 assert.equal(result.training.tokens+result.validation.tokens,100);
 assert.ok(result.training.tokens>=70&&result.training.tokens<=90);
 assert.ok(result.validation.tokens>=10&&result.validation.tokens<=30);
 assert.equal(result.selectedThreshold,60);
 assert.equal(result.holdoutAtSelectedThreshold.tokens,result.validation.tokens);
 assert.equal(result.holdoutAtSelectedThreshold.positive15Pct,100);
});

test('une observation tardive résout le forecast et indique sa qualité',()=>{
 const token={mint:'late',forecasts:[]};
 const base={priceUsd:1,liquidityUsd:5000,volume1h:100,volume24h:500,buys1h:5,sells1h:2,fdv:10000,score:70,coverage:80,classification:'watch',risk:'unknown',flags:[]};
 recordForecast(token,{...base,at:1000000});
 recordForecast(token,{...base,at:1000000+7200000,priceUsd:1.2});
 assert.equal(token.forecasts[0].outcomes['1h'].returnPct,20);
 assert.equal(token.forecasts[0].outcomes['1h'].resolutionQuality,'late_observation');
});
test('la calibration hors échantillon ignore les prévisions sans score réel',()=>{
 const scanner={state:{tokens:{a:{mint:'a',forecasts:[{at:1,score:null,outcomes:{'1h':{returnPct:50,label:'win'}}}]}}}};
 const result=learningSummary.call(scanner).outOfSample;
 assert.equal(result.uniqueResolvedTokens,0);
 assert.equal(result.status,'insufficient_sample');
});
