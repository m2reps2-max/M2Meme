'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessAlertFreshness,qualifyAlertLevel,qualifyOpportunity}=require('../lib/alert-quality');

test('fresh market snapshots preserve opportunity and danger levels',()=>{
 const now=10_000_000,token={history:[{at:now-60_000}]};
 assert.equal(assessAlertFreshness(token,now).status,'fresh');
 assert.equal(qualifyAlertLevel(token,'opportunity',85,now).level,'opportunity');
 assert.equal(qualifyAlertLevel(token,'danger',95,now).level,'danger');
});
test('slightly delayed market snapshots downgrade strong alerts to dashboard-only watch',()=>{
 const now=10_000_000,token={history:[{at:now-8*60_000}]};
 const result=qualifyAlertLevel(token,'danger',95,now);
 assert.equal(result.level,'watch');
 assert.equal(result.freshness.status,'delayed');
 assert.match(result.reason,/aucune alerte Telegram/i);
});
test('stale or unknown market data suppresses alerts',()=>{
 const now=10_000_000;
 assert.equal(qualifyAlertLevel({history:[{at:now-20*60_000}]},'opportunity',90,now).level,'none');
 const unknown=qualifyAlertLevel({history:[]},'danger',100,now);
 assert.equal(unknown.level,'none');
 assert.equal(unknown.freshness.status,'unknown');
});
test('future timestamps are unknown instead of being considered fresh',()=>{
 const now=10_000_000;
 assert.equal(assessAlertFreshness({history:[{at:now+10*60_000}]},now).status,'unknown');
});

function eliteCandidate(overrides={}) {
 return {
  mint:'elite-token',pairAddress:'pool-1',liquidityUsd:20000,fdv:300000,
  volume:{h1:8000},txns:{h1:{buys:16,sells:4}},
  analysis:{score:92,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,flags:[],factors:{security:95}},
  ...overrides
 };
}

test('elite opportunity requires depth, real activity, buyer pressure, valuation and complete security',()=>{
 const result=qualifyOpportunity(eliteCandidate(),{});
 assert.equal(result.eligible,true);
 assert.deepEqual(result.reasons,[]);
 assert.equal(result.metrics.transactions1h,20);
 assert.equal(result.metrics.buyRatioPct,80);
 assert.equal(result.metrics.fdvLiquidityRatio,15);
});

test('a high score cannot bypass weak liquidity, low volume or excessive FDV/liquidity',()=>{
 const weak=qualifyOpportunity(eliteCandidate({liquidityUsd:1600,fdv:200000,volume:{h1:500}}),{});
 assert.equal(weak.eligible,false);
 assert.ok(weak.reasons.includes('Liquidité insuffisante'));
 assert.ok(weak.reasons.includes('Volume 1h insuffisant'));
 assert.ok(weak.reasons.includes('Valorisation trop élevée par rapport à la liquidité'));
});

test('incomplete holder metadata is allowed only after base on-chain security is verified',()=>{
 const missing=qualifyOpportunity(eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'partial',securityComprehensive:false}}),{});
 assert.equal(missing.eligible,true);
 const noBaseSecurity=qualifyOpportunity(eliteCandidate({analysis:{...eliteCandidate().analysis,securityComprehensive:false,factors:{}}}),{});
 assert.ok(noBaseSecurity.reasons.includes('Contrôle on-chain de base incomplet'));
 const warning=qualifyOpportunity(eliteCandidate({analysis:{...eliteCandidate().analysis,flags:[{level:'warning'}]}}),{});
 assert.ok(warning.reasons.includes('Signal de risque encore présent'));
});

test('partial risk is accepted only with verified base security and no blocking warnings',()=>{
 const partial=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'partial',securityComprehensive:false,factors:{security:80}}});
 assert.equal(qualifyOpportunity(partial,{requireComprehensiveSecurity:false}).eligible,true);
 const unknown=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'partial',securityComprehensive:false,factors:{}}});
 assert.equal(qualifyOpportunity(unknown,{requireComprehensiveSecurity:false}).eligible,false);
});

test('non-fatal synchronized-wallet heuristics reduce confidence but do not automatically veto an otherwise elite candidate',()=>{
 const candidate=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[
  {level:'warning',code:'SAME_BLOCK_BUY_BURST'},
  {level:'warning',code:'BUNDLE_LIKE_BURST'},
  {level:'warning',code:'SMART_MONEY_SLOT_CLUSTER'}
 ]}});
 assert.equal(qualifyOpportunity(candidate,{}).eligible,true);
});

test('critical and unknown warning codes remain publication blockers',()=>{
 const critical=qualifyOpportunity(eliteCandidate({analysis:{...eliteCandidate().analysis,flags:[{level:'critical',code:'LIQUIDITY_DROP'}]}}),{});
 assert.equal(critical.eligible,false);
 const unknown=qualifyOpportunity(eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[{level:'warning',code:'UNCLASSIFIED_RISK'}]}}),{});
 assert.equal(unknown.eligible,false);
});

test('weak buyer ratio and insufficient transaction count block opportunity publication',()=>{
 const result=qualifyOpportunity(eliteCandidate({txns:{h1:{buys:3,sells:4}}}),{});
 assert.ok(result.reasons.includes('Activité transactionnelle insuffisante'));
 assert.ok(result.reasons.includes('Pression acheteuse insuffisante'));
});


test('fresh DexScreener 1h transactions are a valid fallback without a GeckoTerminal pool ID',()=>{
 const now=10_000_000;
 const token={history:[{at:now-60_000}],txns:{h1:{buys:12,sells:4}},security:{checkedAt:new Date(now-30*60_000).toISOString()}};
 const {assessOpportunityEvidence}=require('../lib/alert-quality');
 const result=assessOpportunityEvidence(token,now);
 assert.equal(result.eligible,true);
 assert.equal(result.transactionSource,'dexscreener_snapshot');
});

test('GeckoTerminal trade sampling is optional when the current DEX snapshot has real transactions',()=>{
 const now=10_000_000;
 const token={pairAddress:'pair-1',geckoPoolAddress:'pool-1',history:[{at:now-30_000}],txns:{h1:{buys:9,sells:2}},security:{checkedAt:new Date(now-20*60_000).toISOString()}};
 const {assessOpportunityEvidence}=require('../lib/alert-quality');
 assert.equal(assessOpportunityEvidence(token,now).transactionSource,'dexscreener_snapshot');
});

test('transaction fallback cannot use stale market snapshots or missing security evidence',()=>{
 const now=10_000_000;
 const {assessOpportunityEvidence}=require('../lib/alert-quality');
 const stale={history:[{at:now-10*60_000}],txns:{h1:{buys:12,sells:4}},security:{checkedAt:new Date(now-20*60_000).toISOString()}};
 assert.equal(assessOpportunityEvidence(stale,now).eligible,false);
 const noSecurity={history:[{at:now-30_000}],txns:{h1:{buys:12,sells:4}}};
 assert.equal(assessOpportunityEvidence(noSecurity,now).eligible,false);
});


test('informational and uncertain warnings do not veto a qualified token',()=>{
 const candidate=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[
  {level:'warning',code:'TOKEN_2022_REVIEW'},
  {level:'warning',code:'SOCIAL_AUTHOR_CONCENTRATION'},
  {level:'warning',code:'HIGH_FDV_LIQUIDITY'},
  {level:'warning',code:'HOLDER_CONCENTRATION'},
  {level:'warning',code:'SELL_ROUTE_UNAVAILABLE'}
 ]}});
 assert.equal(qualifyOpportunity(candidate,{}).eligible,true);
});

test('dangerous warnings still veto publication',()=>{
 for(const code of ['MINT_AUTHORITY','CREATOR_SELL_OBSERVED','SELL_PRESSURE','SELL_ROUTE_HIGH_IMPACT']){
  const candidate=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[{level:'warning',code}]}});
  assert.equal(qualifyOpportunity(candidate,{}).eligible,false,code);
 }
});
