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
  analysis:{score:92,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,flags:[]},
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
 const weak=qualifyOpportunity(eliteCandidate({liquidityUsd:1600,fdv:200000,volume:{h1:1107}}),{});
 assert.equal(weak.eligible,false);
 assert.ok(weak.reasons.includes('Liquidité insuffisante'));
 assert.ok(weak.reasons.includes('Volume 1h insuffisant'));
 assert.ok(weak.reasons.includes('Valorisation trop élevée par rapport à la liquidité'));
});

test('missing holder security evidence and warning flags block opportunity publication',()=>{
 const missing=qualifyOpportunity(eliteCandidate({analysis:{...eliteCandidate().analysis,securityComprehensive:false}}),{});
 assert.ok(missing.reasons.includes('Analyse des détenteurs incomplète'));
 const warning=qualifyOpportunity(eliteCandidate({analysis:{...eliteCandidate().analysis,flags:[{level:'warning'}]}}),{});
 assert.ok(warning.reasons.includes('Signal de risque encore présent'));
});

test('weak buyer ratio and insufficient transaction count block opportunity publication',()=>{
 const result=qualifyOpportunity(eliteCandidate({txns:{h1:{buys:5,sells:15}}}),{});
 assert.ok(result.reasons.includes('Activité transactionnelle insuffisante'));
 assert.ok(result.reasons.includes('Pression acheteuse insuffisante'));
});
