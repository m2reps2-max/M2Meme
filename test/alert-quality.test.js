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
test('marketObservedAt preserves freshness when the sampled history array is empty',()=>{
 const now=10_000_000;
 const fresh=assessAlertFreshness({history:[],marketObservedAt:new Date(now-60_000).toISOString()},now);
 assert.equal(fresh.status,'fresh');
 assert.equal(fresh.ageMinutes,1);
 const stale=assessAlertFreshness({history:[],marketObservedAt:new Date(now-20*60_000).toISOString()},now);
 assert.equal(stale.status,'stale');
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


test('fresh Gecko samples require distinct buyers and avoid strong net-sell flow',()=>{
 const weak=eliteCandidate({tradeIntel:{checkedAt:new Date().toISOString(),tradeCount:30,uniqueBuyers:3,buyVolumeUsd:1000,sellVolumeUsd:1500,rpcConfirmedTradeCount:8,rpcConfirmedUniqueBuyers:3,rpcConfirmedBuyVolumeUsd:1000,rpcConfirmedSellVolumeUsd:1500,rpcConfirmedVolumeCoverage:100,rpcConfirmedCheckedAt:new Date().toISOString(),rpcConfirmedLastTradeAt:new Date().toISOString()}});
 const weakResult=qualifyOpportunity(weak,{});
 assert.ok(weakResult.reasons.includes('Moins de cinq acheteurs distincts dans l’échantillon récent'));
 assert.ok(weakResult.reasons.includes('Flux vendeur dominant dans l’échantillon récent'));
 const broad=eliteCandidate({tradeIntel:{checkedAt:new Date().toISOString(),tradeCount:30,uniqueBuyers:12,buyVolumeUsd:1500,sellVolumeUsd:1000,rpcConfirmedTradeCount:8,rpcConfirmedUniqueBuyers:12,rpcConfirmedBuyVolumeUsd:1500,rpcConfirmedSellVolumeUsd:1000,rpcConfirmedVolumeCoverage:100,rpcConfirmedCheckedAt:new Date().toISOString(),rpcConfirmedLastTradeAt:new Date().toISOString()}});
 assert.equal(qualifyOpportunity(broad,{}).eligible,true);
});

test('fresh DexScreener 1h transactions are a valid fallback without a GeckoTerminal pool ID',()=>{
 const now=10_000_000;
 const token={history:[{at:now-60_000}],txns:{h1:{buys:12,sells:4}},security:{checkedAt:new Date(now-10*60_000).toISOString()}};
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

test('contextual social and valuation warnings do not veto an otherwise qualified candidate',()=>{
 const candidate=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[
  {level:'warning',code:'SOCIAL_AUTHOR_CONCENTRATION'},
  {level:'warning',code:'ELITE_RECURRENT_CREATOR_FUNDER'},
  {level:'warning',code:'HIGH_FDV_LIQUIDITY'}
 ]}});
 assert.equal(qualifyOpportunity(candidate,{}).eligible,true);
});

test('verified holder concentration and unreviewed Token-2022 extensions remain blockers',()=>{
 for(const code of ['HOLDER_CONCENTRATION','TOP1_WALLET_CONCENTRATION','TOP5_WALLET_CONCENTRATION','TOKEN_2022_REVIEW','ELITE_TOKEN2022_EXTENSIONS_UNKNOWN']){
  const candidate=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[{level:'warning',code}]}});
  assert.equal(qualifyOpportunity(candidate,{}).eligible,false,code);
 }
});

test('uncertain sell-route, unverified-account, small creator-sale and contextual warnings do not veto good candidates',()=>{
 for(const code of ['SELL_ROUTE_UNAVAILABLE','TOP10_ACCOUNT_CONCENTRATION_UNVERIFIED','CREATOR_SELL_OBSERVED','EARLY_WALLET_SELL_CLUSTER','ELITE_ORGANIC_DEMAND_SUSPECT','TOKEN_2022_TRANSFER_HOOK','TOKEN_2022_CONFIDENTIAL_TRANSFER']){
  const candidate=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[{level:'warning',code}]}});
  assert.equal(qualifyOpportunity(candidate,{}).eligible,true,code);
 }
});

test('accepted caution signals remain visible in the qualification result',()=>{
 const candidate=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[
  {level:'warning',code:'SELL_ROUTE_UNAVAILABLE',message:'Jupiter ne trouve pas de route de vente.'}
 ]}});
 const result=qualifyOpportunity(candidate,{});
 assert.equal(result.eligible,true);
 assert.deepEqual(result.warnings,['Jupiter ne trouve pas de route de vente.']);
});

test('critical severity always blocks even when the warning code is normally contextual',()=>{
 const candidate=eliteCandidate({analysis:{...eliteCandidate().analysis,risk:'medium',flags:[{level:'critical',code:'CREATOR_SELL_OBSERVED'}]}});
 assert.equal(qualifyOpportunity(candidate,{}).eligible,false);
});

test('a failed 250 USD quote limits capacity but a valid 100 USD exit remains eligible',()=>{
 const checkedAt=new Date().toISOString();
 const candidate=eliteCandidate({sellabilityChecks:[
  {requestedUsd:100,status:'route_available',routeAvailable:true,priceImpactPct:1,checkedAt},
  {requestedUsd:250,status:'no_route',routeAvailable:false,checkedAt}
 ],sellability:{requestedUsd:250,status:'no_route',routeAvailable:false,checkedAt}});
 assert.equal(qualifyOpportunity(candidate,{}).eligible,true);
});

test('supply-capped actual notional controls the small-exit failure gate',()=>{
 const checkedAt=new Date().toISOString();
 const candidate=eliteCandidate({sellabilityChecks:[
  {requestedUsd:250,inputAmountUsd:40,status:'no_route',routeAvailable:false,checkedAt}
 ]});
 const result=qualifyOpportunity(candidate,{});
 assert.equal(result.eligible,false);
 assert.ok(result.reasons.some(reason=>/100 USD ou moins/.test(reason)));
});

test('high price impact at a small exit size blocks even when a larger quote is available',()=>{
 const checkedAt=new Date().toISOString();
 const candidate=eliteCandidate({sellabilityChecks:[
  {requestedUsd:50,status:'high_impact',routeAvailable:true,priceImpactPct:8,checkedAt},
  {requestedUsd:250,status:'route_available',routeAvailable:true,priceImpactPct:2,checkedAt}
 ]});
 assert.equal(qualifyOpportunity(candidate,{}).eligible,false);
});

test('transaction fallback cannot use stale market snapshots or missing security evidence',()=>{
 const now=10_000_000;
 const {assessOpportunityEvidence}=require('../lib/alert-quality');
 const stale={history:[{at:now-10*60_000}],txns:{h1:{buys:12,sells:4}},security:{checkedAt:new Date(now-20*60_000).toISOString()}};
 assert.equal(assessOpportunityEvidence(stale,now).eligible,false);
 const noSecurity={history:[{at:now-30_000}],txns:{h1:{buys:12,sells:4}}};
 assert.equal(assessOpportunityEvidence(noSecurity,now).eligible,false);
});

test('GL1TCH is advisory: missing, unavailable and provider verdicts never replace on-chain gates',()=>{
 const base=eliteCandidate();
 for(const externalSecurity of [undefined,{status:'unavailable'},{status:'ok',verdict:'CAUTION',score:70,confidence:90},{status:'ok',verdict:'UNKNOWN',score:90,confidence:90},{status:'ok',verdict:'HIGH RISK',score:95,confidence:95}]){
  assert.equal(qualifyOpportunity({...base,externalSecurity},{requireExternalSecurity:true}).eligible,true);
 }
});

test('static mint evidence and dynamic holder evidence use separate freshness windows',()=>{
 const now=Date.now();
 const {assessOpportunityEvidence}=require('../lib/alert-quality');
 const fresh={history:[{at:now-30000}],txns:{h1:{buys:12,sells:4}},security:{staticCheckedAt:new Date(now-23*60*60*1000).toISOString(),holderCheckedAt:new Date(now-10*60*1000).toISOString()}};
 const result=assessOpportunityEvidence(fresh,now);
 assert.equal(result.staticSecurityFresh,true);
 assert.equal(result.dynamicSecurityFresh,true);
 assert.equal(result.eligible,true);
 const staleHolders={...fresh,security:{...fresh.security,holderCheckedAt:new Date(now-20*60*1000).toISOString()}};
 assert.equal(assessOpportunityEvidence(staleHolders,now).eligible,false);
 const staleMint={...fresh,security:{...fresh.security,staticCheckedAt:new Date(now-25*60*60*1000).toISOString()}};
 assert.equal(assessOpportunityEvidence(staleMint,now).eligible,false);
});

test('a fresh known Jupiter no-route quote blocks selection but stale quotes do not',()=>{
 const now=new Date().toISOString();
 const noRoute=eliteCandidate({sellability:{status:'no_route',checkedAt:now}});
 assert.equal(qualifyOpportunity(noRoute,{}).eligible,false);
 const stale=eliteCandidate({sellability:{status:'no_route',checkedAt:new Date(Date.now()-20*60*1000).toISOString()}});
 assert.equal(qualifyOpportunity(stale,{}).eligible,true);
});

test('a reviewed raw holder-account sample can qualify while owner mapping remains explicitly incomplete',()=>{
 const candidate=eliteCandidate({analysis:{
  ...eliteCandidate().analysis,
  risk:'medium',
  securityComprehensive:false,
  securityPublicationReady:true,
  factors:{security:82}
 }});
 const result=qualifyOpportunity(candidate,{requireComprehensiveSecurity:true});
 assert.equal(result.eligible,true);
 assert.equal(candidate.analysis.securityComprehensive,false);
 assert.equal(candidate.analysis.securityPublicationReady,true);
});
test('missing raw holder-account sample cannot use the publication-ready security path',()=>{
 const candidate=eliteCandidate({analysis:{
  ...eliteCandidate().analysis,
  risk:'partial',
  securityComprehensive:false,
  securityPublicationReady:false,
  factors:{security:82}
 }});
 const result=qualifyOpportunity(candidate,{requireComprehensiveSecurity:true});
 assert.equal(result.eligible,false);
 assert.ok(result.reasons.includes('Échantillon de détenteurs insuffisant pour valider la sécurité'));
});
