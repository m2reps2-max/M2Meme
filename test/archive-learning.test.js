'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildAdaptiveTokens}=require('../scripts/run-actions-archive-learning');

test('cold archive rows become one compact point-in-time forecast per mint',()=>{
 const rows=[
  {mint:'mint-a',at:1000,score:80,features:{activity:80,momentum:70,market:60,security:90},outcomes:{'1h':{returnPct:20}}},
  {mint:'mint-b',at:2000,score:65,features:{activity:60,momentum:55,market:50,security:80},outcomes:{'1h':{returnPct:-10}}},
  {mint:'mint-c',at:3000,score:70,features:null,outcomes:{'1h':{returnPct:5}}},
  null
 ];
 const tokens=buildAdaptiveTokens(rows);
 assert.deepEqual(Object.keys(tokens),['mint-a','mint-b']);
 assert.equal(tokens['mint-a'].forecasts.length,1);
 assert.equal(tokens['mint-a'].forecasts[0].at,1000);
 assert.equal(tokens['mint-a'].forecasts[0].features.activity,80);
 assert.equal(tokens['mint-a'].forecasts[0].outcomes['1h'].returnPct,20);
});

test('archive adaptive dataset is empty when no point-in-time factors were retained',()=>{
 assert.deepEqual(Object.keys(buildAdaptiveTokens([{mint:'mint-x',at:1,features:null,outcomes:{}}])),[]);
});
