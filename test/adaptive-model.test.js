'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildAdaptiveModel,scoreCandidate}=require('../lib/adaptive-model');

function fixture(count=200){
 const tokens={};
 for(let i=0;i<count;i++){
  const x=i%100;
  const features={activity:x,momentum:x*.8+(i%7),market:x*.7+(i%5),liquidityQuality:x*.6+(i%11),security:x*.5+(i%13)};
  tokens['mint-'+String(i).padStart(4,'0')]={mint:'mint-'+String(i).padStart(4,'0'),forecasts:[{
   at:Date.UTC(2026,0,1)+i*60000,score:100-x,features,
   outcomes:{'15m':{returnPct:(x-50)*0.8},'1h':{returnPct:(x-50)*1.5,label:x>=60?'win':x<=35?'loss':'flat'},'6h':{returnPct:(x-50)*1.2},'24h':{returnPct:(x-50)*0.7}}
  }]};
 }
 return tokens;
}

test('adaptive model only activates after chronological holdout beats fixed score and random baseline',()=>{
 const model=buildAdaptiveModel(fixture());
 assert.equal(model.status,'validated');
 assert.equal(model.enabled,true);
 assert.ok(model.trainingTokens>=150);
 assert.ok(model.validationTokens>=30);
 assert.ok(model.holdout.upliftVsStaticPctPoints>=3);
 assert.ok(model.holdout.upliftVsRandomPctPoints>=3);
 assert.ok(model.features.length>=4);
 const candidate={analysis:{factors:{activity:95,momentum:90,market:90,liquidityQuality:90,security:90}}};
 assert.ok(scoreCandidate(candidate,model)>50);
});

test('adaptive model stays inactive with insufficient sample',()=>{
 const model=buildAdaptiveModel(fixture(60));
 assert.equal(model.enabled,false);
 assert.equal(model.status,'insufficient_sample');
 assert.equal(scoreCandidate({analysis:{factors:{activity:99,momentum:99,market:99,liquidityQuality:99,security:99}}},model),null);
});

test('adaptive model ignores forecasts without four point-in-time factors or resolved outcomes',()=>{
 const tokens={
  a:{mint:'a',forecasts:[{at:1,score:90,features:{activity:90,momentum:80},outcomes:{'1h':{returnPct:50}}}]},
  b:{mint:'b',forecasts:[{at:2,score:90,features:{activity:90,momentum:80,market:70,security:90},outcomes:{}}]}
 };
 const model=buildAdaptiveModel(tokens);
 assert.equal(model.observations,0);
 assert.equal(model.enabled,false);
});

test('adaptive holdout reports independent performance at multiple horizons',()=>{
 const model=buildAdaptiveModel(fixture());
 assert.ok(model.holdout.horizons);
 for(const horizon of ['15m','1h','6h','24h','7d']){
  assert.ok(model.holdout.horizons[horizon]);
  assert.ok(model.holdout.horizons[horizon].top.tokens>=0);
  assert.equal(typeof model.holdout.horizons[horizon].upliftVsStaticPctPoints==='number'||model.holdout.horizons[horizon].upliftVsStaticPctPoints===null,true);
 }
 assert.ok(model.holdout.horizons['1h'].top.tokens>=10);
});
