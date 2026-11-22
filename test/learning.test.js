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
