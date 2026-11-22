'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSelection}=require('../lib/selection');
const NOW=1_800_000_000_000;

function token(i,overrides={}){
 return {
  mint:'mint-'+i,name:'Token '+i,symbol:'T'+i,pairAddress:'pair-'+i,liquidityUsd:20000,
  volume:{h1:3000},txns:{h1:{buys:8,sells:4}},
  history:[{at:NOW-60_000,priceUsd:1}],
  security:{checkedAt:new Date(NOW-5*60_000).toISOString()},
  tradeIntel:{checkedAt:new Date(NOW-5*60_000).toISOString()},
  analysis:{
   score:80,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,
   factors:{activity:80,momentum:75,market:82,liquidityQuality:78,security:95}
  },
  ...overrides
 };
}

test('selection ranks the full input and returns no more than five best candidates',()=>{
 const items=Array.from({length:9},(_,i)=>token(i,{analysis:{...token(i).analysis,score:70+i}}));
 const result=buildSelection(items,NOW);
 assert.equal(result.considered,9);
 assert.equal(result.eligible,9);
 assert.equal(result.best.length,5);
 assert.deepEqual(result.best.map(x=>x.mint),['mint-8','mint-7','mint-6','mint-5','mint-4']);
 assert.equal(result.best[0].freshness.marketAgeMinutes,1);
});

test('watch candidates are separate, capped at five and clearly retain partial risk',()=>{
 const items=Array.from({length:7},(_,i)=>token(i,{
  liquidityUsd:7000,volume:{h1:250},txns:{h1:{buys:3,sells:2}},
  analysis:{score:62+i,coverage:70,risk:'partial',securityComprehensive:false,hardBlocked:false,factors:{market:70,security:80}}
 }));
 const result=buildSelection(items,NOW);
 assert.equal(result.best.length,0);
 assert.equal(result.observe.length,5);
 assert.equal(result.observe[0].analysis.risk,'partial');
 assert.equal(result.observe[0].analysis.securityComprehensive,false);
});

test('pre-market, unknown-risk, blocked and incomplete top-pick tokens are excluded',()=>{
 const items=[
  token(1,{pairAddress:null,geckoPoolAddress:null}),
  token(2,{analysis:{...token(2).analysis,coverage:5,score:100}}),
  token(3,{analysis:{...token(3).analysis,risk:'unknown'}}),
  token(4,{analysis:{...token(4).analysis,hardBlocked:true}}),
  token(5,{analysis:{...token(5).analysis,coverage:60,securityComprehensive:false,risk:'partial'}}),
  token(6,{analysis:{...token(6).analysis,coverage:60,factors:{...token(6).analysis.factors,liquidityQuality:null}}})
 ];
 const result=buildSelection(items,NOW);
 assert.equal(result.eligible,5);
 assert.equal(result.best.length,0);
 assert.equal(result.observe.length,0);
});

test('stale market data cannot enter either shortlist even with a perfect score',()=>{
 const stale=token(1,{history:[{at:NOW-20*60_000,priceUsd:1}],analysis:{...token(1).analysis,score:99}});
 const missing=token(2,{history:[],analysis:{...token(2).analysis,score:99}});
 const result=buildSelection([stale,missing],NOW);
 assert.equal(result.best.length,0);
 assert.equal(result.observe.length,0);
 assert.equal(result.diagnostics.staleMarketOver15m,1);
 assert.equal(result.diagnostics.missingMarketTimestamp,1);
});

test('best picks require fresh security and transaction evidence, not only fresh price',()=>{
 const staleSecurity=token(1,{security:{checkedAt:new Date(NOW-90*60_000).toISOString()}});
 const staleTrades=token(2,{tradeIntel:{checkedAt:new Date(NOW-90*60_000).toISOString()}});
 const result=buildSelection([staleSecurity,staleTrades],NOW);
 assert.equal(result.best.length,0);
 assert.equal(result.diagnostics.bestRejectedStaleSecurity,1);
 assert.equal(result.diagnostics.bestRejectedStaleTransactions,1);
});

test('security freshness window matches the hourly background refresh cadence',()=>{
 const tokenWith45mSecurityAge=token(9,{security:{checkedAt:new Date(NOW-45*60_000).toISOString()}});
 const result=buildSelection([tokenWith45mSecurityAge],NOW);
 assert.equal(result.best.length,1);
 assert.equal(result.qualityGate.bestSecurityMaxAgeMinutes,65);
});

test('watchlist tolerates partial security but not stale market or very stale security',()=>{
 const partial=token(1,{liquidityUsd:7000,volume:{h1:250},analysis:{score:65,coverage:70,risk:'partial',securityComprehensive:false,hardBlocked:false,factors:{market:70,security:80}},security:{}});
 const stale=token(2,{liquidityUsd:7000,volume:{h1:250},security:{checkedAt:new Date(NOW-90*60_000).toISOString()},analysis:{score:66,coverage:70,risk:'partial',securityComprehensive:false,hardBlocked:false,factors:{market:70,security:80}}});
 const result=buildSelection([partial,stale],NOW);
 assert.deepEqual(result.observe.map(x=>x.mint),['mint-1']);
});

test('shortlist response contains compact card data rather than full token histories',()=>{
 const result=buildSelection([token(1)],NOW);
 const card=result.best[0];
 assert.equal(card.mint,'mint-1');
 assert.equal(card.analysis.factors.security,95);
 assert.equal(card.history,undefined);
 assert.equal(card.tradeIntel,undefined);
});
