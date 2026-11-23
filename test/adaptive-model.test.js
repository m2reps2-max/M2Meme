'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildAdaptiveModel,scoreCandidate,netReturnPct}=require('../lib/adaptive-model');

function fixture(count=300){
 const tokens={};
 for(let i=0;i<count;i++){
  const x=i%100;
  const features={activity:x,momentum:x*.8+(i%7),market:x*.7+(i%5),liquidityQuality:x*.6+(i%11),security:x*.5+(i%13)};
  const mint='mint-'+String(i).padStart(4,'0');
  tokens[mint]={mint,forecasts:[{
   at:Date.UTC(2026,0,1)+i*60000,score:100-x,features,
   outcomes:{
    '15m':{returnPct:(x-50)*0.8},
    '1h':{returnPct:(x-50)*1.5},
    '6h':{returnPct:(x-50)*1.2},
    '24h':{returnPct:(x-50)*0.7},
    '7d':{returnPct:(x-50)*0.4}
   }
  }]};
 }
 return tokens;
}

test('adaptive model activates only after chronological holdout beats equal-sized fixed and random baselines on net returns',()=>{
 const model=buildAdaptiveModel(fixture());
 assert.equal(model.status,'validated');
 assert.equal(model.enabled,true);
 assert.ok(model.trainingTokens>=200);
 assert.ok(model.validationTokens>=50);
 assert.ok(model.holdout.selectedTokens>=15);
 assert.equal(model.holdout.top.tokens,model.holdout.staticScoreTop.tokens);
 assert.equal(model.holdout.top.tokens,model.holdout.randomSameSize.tokens);
 assert.equal(model.holdout.top.tokens,model.holdout.selectedTokens);
 assert.ok(model.holdout.upliftVsStaticPctPoints>=5);
 assert.ok(model.holdout.upliftVsRandomPctPoints>=5);
 assert.ok(model.holdout.top.averageReturnPct<model.holdout.top.grossAverageReturnPct);
 assert.equal(model.evaluation.returnBasis,'net_simulated');
 assert.ok(model.features.length>=4);
 const candidate={analysis:{factors:{activity:95,momentum:90,market:90,liquidityQuality:90,security:90}}};
 assert.ok(scoreCandidate(candidate,model)>50);
});

test('adaptive model stays inactive before 250 distinct resolved tokens',()=>{
 const model=buildAdaptiveModel(fixture(200));
 assert.equal(model.enabled,false);
 assert.equal(model.status,'insufficient_sample');
 assert.equal(scoreCandidate({analysis:{factors:{activity:99,momentum:99,market:99,liquidityQuality:99,security:99}}},model),null);
});

test('adaptive model accounts for two-sided fees and slippage',()=>{
 assert.ok(netReturnPct(0)<0);
 assert.ok(netReturnPct(10)<10);
 assert.ok(netReturnPct(-50)<-50);
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

test('adaptive holdout reports net performance at multiple independent horizons',()=>{
 const model=buildAdaptiveModel(fixture());
 assert.ok(model.holdout.horizons);
 for(const horizon of ['15m','1h','6h','24h','7d']){
  const result=model.holdout.horizons[horizon];
  assert.ok(result);
  assert.equal(result.top.tokens,result.staticScoreTop.tokens);
  assert.equal(result.top.tokens,result.randomSameSize.tokens);
  assert.ok(result.top.averageReturnPct<result.top.grossAverageReturnPct);
  assert.equal(typeof result.upliftVsStaticPctPoints==='number'||result.upliftVsStaticPctPoints===null,true);
 }
 assert.ok(model.holdout.horizons['1h'].top.tokens>=15);
});

test('multi-horizon comparisons use identical resolved token cohorts for all three rankings',()=>{
 const tokens=fixture();
 for(let i=0;i<300;i+=2)delete tokens['mint-'+String(i).padStart(4,'0')].forecasts[0].outcomes['7d'];
 const model=buildAdaptiveModel(tokens);
 const sevenDay=model.holdout.horizons['7d'];
 assert.equal(sevenDay.comparisonSampleSize,30);
 assert.equal(sevenDay.top.tokens,sevenDay.staticScoreTop.tokens);
 assert.equal(sevenDay.top.tokens,sevenDay.randomSameSize.tokens);
 assert.equal(sevenDay.top.tokens,18);
});
