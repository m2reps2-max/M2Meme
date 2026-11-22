'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {learningSummary}=require('../lib/learning');

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
