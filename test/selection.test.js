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
  sellability:{status:'route_available',routeAvailable:true,requestedUsd:100,priceImpactPct:1,checkedAt:new Date(NOW-5*60_000).toISOString()},
  tradeIntel:{checkedAt:new Date(NOW-5*60_000).toISOString(),lastTradeAt:new Date(NOW-5*60_000).toISOString(),tradeCount:30,uniqueBuyers:12,uniqueSellers:8,buyVolumeUsd:1200,sellVolumeUsd:700},
  analysis:{
   score:90,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,exitCapacityUsd:100,
   factors:{activity:80,momentum:75,market:82,liquidityQuality:78,executionQuality:85,security:95,demandQuality:78}
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

test('best shortlist requires a fresh Jupiter quote and at least 50 USD of executable capacity',()=>{
 const missing=token(89,{sellability:null,analysis:{...token(89).analysis,exitCapacityUsd:null}});
 const stale=token(90,{sellability:{status:'route_available',routeAvailable:true,requestedUsd:100,priceImpactPct:1,checkedAt:new Date(NOW-20*60_000).toISOString()}});
 const insufficient=token(91,{analysis:{...token(91).analysis,exitCapacityUsd:40}});
 const unknownImpact=token(92,{sellability:{status:'route_available',routeAvailable:true,requestedUsd:100,priceImpactPct:null,checkedAt:new Date(NOW-5*60_000).toISOString()},analysis:{...token(92).analysis,exitCapacityUsd:null}});
 for(const candidate of [missing,stale,insufficient,unknownImpact])assert.equal(buildSelection([candidate],NOW).best.length,0);
 assert.equal(buildSelection([missing],NOW).diagnostics.bestRejectedMissingExitQuote,1);
});

test('best shortlist requires fresh verified net demand and distinct buyers',()=>{
 const base=token(801);
 const cases=[
  token(802,{tradeIntel:null}),
  token(803,{tradeIntel:{...base.tradeIntel,tradeCount:19}}),
  token(804,{tradeIntel:{...base.tradeIntel,uniqueBuyers:4}}),
  token(805,{tradeIntel:{...base.tradeIntel,buyVolumeUsd:null}}),
  token(806,{tradeIntel:{...base.tradeIntel,buyVolumeUsd:500,sellVolumeUsd:900}}),
  token(810,{tradeIntel:{...base.tradeIntel,buyVolumeUsd:800,sellVolumeUsd:1000}}),
  token(807,{tradeIntel:{...base.tradeIntel,checkedAt:new Date(NOW-20*60_000).toISOString()}}),
  token(811,{tradeIntel:{...base.tradeIntel,lastTradeAt:new Date(NOW-20*60_000).toISOString()}}),
  token(808,{analysis:{...base.analysis,factors:{...base.analysis.factors,demandQuality:null}}}),
  token(809,{analysis:{...base.analysis,factors:{...base.analysis.factors,executionQuality:null}}})
 ];
 for(const candidate of cases) assert.equal(buildSelection([candidate],NOW).best.length,0,candidate.mint);
 const valid=buildSelection([base],NOW);
 assert.equal(valid.best.length,1);
 assert.equal(valid.qualityGate.bestRequiresVerifiedDemand,true);
 assert.equal(valid.qualityGate.bestMinimumUniqueBuyers,5);
});

test('confirmed early-buyer exits keep a candidate in watch rather than best',()=>{
 const candidate=token(91,{earlyBuyerExitSummary:{alert:true,wallets:2,soldSharePct:27.5}});
 const result=buildSelection([candidate],NOW);
 assert.equal(result.best.length,0);
 assert.deepEqual(result.observe.map(x=>x.mint),['mint-91']);
 assert.equal(result.diagnostics.bestRejectedEarlyBuyerExits,1);
 assert.equal(result.qualityGate.bestRequiresNoConfirmedEarlyBuyerExits,true);
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
  token(2,{analysis:{...token(2).analysis,coverage:5,score:100,factors:{...token(2).analysis.factors,security:null}}}),
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

test('dynamic holder evidence uses a short freshness window while static mint facts can remain cached',()=>{
 const tokenWith10mSecurityAge=token(9,{security:{checkedAt:new Date(NOW-10*60_000).toISOString()}});
 const result=buildSelection([tokenWith10mSecurityAge],NOW);
 assert.equal(result.best.length,1);
 assert.equal(result.qualityGate.bestDynamicSecurityMaxAgeMinutes,15);
 assert.equal(result.qualityGate.bestStaticSecurityMaxAgeMinutes,1440);
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


test('best shortlist requires a measured momentum factor instead of allowing a high score to bypass it',()=>{
 const candidate=token(88,{analysis:{...token(88).analysis,coverage:75,factors:{activity:85,market:80,liquidityQuality:78,security:90}}});
 const result=buildSelection([candidate],NOW);
 assert.equal(result.best.length,0);
 assert.equal(result.diagnostics.bestRejectedMissingMomentumFactor,1);
});

test('best shortlist requires every independent core factor, including demand and execution',()=>{
 const candidate=token(89,{analysis:{...token(89).analysis,coverage:0,factors:{activity:85,momentum:72,market:80,liquidityQuality:78,executionQuality:82,security:90,demandQuality:75}}});
 const result=buildSelection([candidate],NOW);
 assert.equal(result.best.length,1);
 assert.equal(result.best[0].mint,'mint-89');
 assert.equal(result.best[0].analysis.factors.momentum,72);
});

test('DEX snapshots alone keep candidates in watch until distinct net demand is verified',()=>{
 const candidate=token(77,{geckoPoolAddress:null,tradeIntel:null,txns:{h1:{buys:15,sells:5}}});
 const result=buildSelection([candidate],NOW);
 assert.equal(result.best.length,0);
 assert.equal(result.observe.length,1);
 assert.equal(result.diagnostics.bestRejectedUnverifiedDemand,1);
 assert.equal(result.best.length===0?result.eligible:0,1);
});

test('GL1TCH verdicts remain advisory and cannot veto independently qualified opportunities',()=>{
 const variants=[
  token(90,{externalSecurity:{status:'ok',verdict:'LOW RISK',score:82,confidence:85,checks:[]}}),
  token(91,{externalSecurity:{status:'ok',verdict:'CAUTION',score:72,confidence:90,checks:[]}}),
  token(92),
  token(93,{externalSecurity:{status:'ok',verdict:'CLEAN',score:95,confidence:90,checks:[{name:'Spam activity',status:'flagged',severity:'high',details:'Provider-only spam verdict'}]}})
 ];
 const result=buildSelection(variants,NOW,{settings:{requireExternalSecurity:true}});
 assert.equal(result.best.length,4);
});
