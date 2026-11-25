'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSelection}=require('../lib/selection');
const NOW=1_800_000_000_000;

function token(i,overrides={}){
 return {
  mint:'mint-'+i,name:'Token '+i,symbol:'T'+i,pairAddress:'pair-'+i,liquidityUsd:20000,fdv:200000,
  volume:{h1:6000},txns:{h1:{buys:15,sells:5}},
  history:[{at:NOW-60_000,priceUsd:1}],
  security:{checkedAt:new Date(NOW-5*60_000).toISOString()},
  tradeIntel:{checkedAt:new Date(NOW-5*60_000).toISOString()},
  analysis:{
   score:90,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,
   factors:{activity:80,momentum:75,market:82,liquidityQuality:78,security:95}
  },
  ...overrides
 };
}

test('selection ranks the full input and returns no more than five best candidates',()=>{
 const items=Array.from({length:9},(_,i)=>token(i,{analysis:{...token(i).analysis,score:88+i}}));
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

test('pre-market, unknown-risk and blocked tokens are excluded while partial evidence remains watch-only',()=>{
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
 assert.deepEqual(result.observe.map(x=>x.mint),['mint-5','mint-6']);
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

test('best picks require fresh security and either recent Gecko trades or a fresh DEX transaction snapshot',()=>{
 const staleSecurity=token(1,{security:{checkedAt:new Date(NOW-120*60_000).toISOString()}});
 const staleTrades=token(2,{geckoPoolAddress:'gecko-pool-2',tradeIntel:{checkedAt:new Date(NOW-120*60_000).toISOString()},txns:{h1:{buys:0,sells:0}}});
 const result=buildSelection([staleSecurity,staleTrades],NOW);
 assert.equal(result.best.length,0);
 assert.equal(result.diagnostics.bestRejectedStaleSecurity,1);
 assert.equal(result.diagnostics.bestRejectedStaleTransactions,1);
 assert.equal(result.diagnostics.bestRejectedStaleMarket,0);
});

test('security freshness window matches the hourly background refresh cadence',()=>{
 const tokenWith45mSecurityAge=token(9,{security:{checkedAt:new Date(NOW-45*60_000).toISOString()}});
 const result=buildSelection([tokenWith45mSecurityAge],NOW);
 assert.equal(result.best.length,1);
 assert.equal(result.qualityGate.bestSecurityMaxAgeMinutes,95);
});

test('watchlist tolerates partial security but not stale market or very stale security',()=>{
 const partial=token(1,{liquidityUsd:7000,volume:{h1:250},analysis:{score:65,coverage:70,risk:'partial',securityComprehensive:false,hardBlocked:false,factors:{market:70,security:80}},security:{}});
 const stale=token(2,{liquidityUsd:7000,volume:{h1:250},security:{checkedAt:new Date(NOW-120*60_000).toISOString()},analysis:{score:66,coverage:70,risk:'partial',securityComprehensive:false,hardBlocked:false,factors:{market:70,security:80}}});
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

test('recent pre-market launch detections are visible separately and never scored as opportunities',()=>{
 const early={
  mint:'premarket-1',name:'Early token',symbol:'EARLY',launchSource:'Raydium LaunchLab',
  launchCreatedAt:NOW-4*60_000,firstSeenAt:new Date(NOW-4*60_000).toISOString(),
  analysis:{score:5,coverage:5,risk:'unknown',hardBlocked:false}
 };
 const stale={...early,mint:'premarket-stale',launchCreatedAt:NOW-45*60_000};
 const blocked={...early,mint:'premarket-blocked',analysis:{...early.analysis,hardBlocked:true}};
 const linked={...early,mint:'market-linked',pairAddress:'pair-linked'};
 const result=buildSelection([early,stale,blocked,linked],NOW);
 assert.equal(result.early.length,1);
 assert.equal(result.early[0].mint,'premarket-1');
 assert.equal(result.early[0].phase,'pre_market');
 assert.equal(result.early[0].score,null);
 assert.equal(result.early[0].hardBlocked,false);
 assert.equal(result.best.length,0);
 assert.equal(result.observe.length,0);
});


test('best shortlist does not require historical momentum when all independent core factors are present',()=>{
 const candidate=token(88,{analysis:{...token(88).analysis,coverage:75,factors:{activity:85,market:80,liquidityQuality:78,security:90}}});
 const result=buildSelection([candidate],NOW);
 assert.equal(result.best.length,1);
 assert.equal(result.best[0].mint,'mint-88');
});

test('best shortlist accepts fresh DEX transactions when GeckoTerminal pool sampling is unavailable',()=>{
 const candidate=token(77,{geckoPoolAddress:null,tradeIntel:null,txns:{h1:{buys:15,sells:5}}});
 const result=buildSelection([candidate],NOW);
 assert.equal(result.best.length,1);
 assert.equal(result.best[0].freshness.transactionAgeMinutes,1);
});

test('best shortlist requires a clear external security verdict when the strict gate is enabled',()=>{
 const safe=token(90,{externalSecurity:{status:'ok',verdict:'LOW RISK',score:82,confidence:85,checks:[]}});
 const caution=token(91,{externalSecurity:{status:'ok',verdict:'CAUTION',score:72,confidence:90,checks:[]}});
 const missing=token(92);
 const settings={requireExternalSecurity:true};
 assert.deepEqual(buildSelection([safe],NOW,{settings}).best.map(x=>x.mint),['mint-90']);
 assert.equal(buildSelection([caution],NOW,{settings}).best.length,0);
 assert.equal(buildSelection([missing],NOW,{settings}).best.length,0);
});
test('best shortlist blocks a confirmed external spam flag',()=>{
 const spam=token(93,{externalSecurity:{status:'ok',verdict:'CLEAN',score:95,confidence:90,checks:[{name:'Spam activity',status:'flagged',severity:'high',details:'Coordinated spam trading detected'}]}});
 const result=buildSelection([spam],NOW,{settings:{requireExternalSecurity:true}});
 assert.equal(result.best.length,0);
});
