'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateMomentumRisk}=require('../lib/momentum-risk');

const tradeProof=()=>({rpcConfirmed:true,checkedAt:new Date().toISOString(),tradeCount:40,uniqueBuyers:15,top5BuyerSharePct:52,buyVolumeUsd:12000,sellVolumeUsd:7000});

test('a +200% move is contextual and never excluded by itself',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:85,h24:210},volume:{m5:10000,h1:90000},txns:{m5:{buys:30,sells:8}}});
 assert.equal(result.detectors.extendedMove,true);
 assert.equal(result.blockPublication,false);
 assert.notEqual(result.status,'selloff');
 assert.ok(result.signals.some(x=>/hausse déjà avancée/i.test(x)));
});

test('early momentum requires buying pressure and expanding five-minute volume',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:8,h1:24,h24:40},volume:{m5:12000,h1:60000},txns:{m5:{buys:18,sells:5}}});
 assert.equal(result.detectors.earlyMomentum,true);
 assert.ok(result.adjustment>0);
});

test('a vertical acceleration without volume or buyer confirmation is penalized, not automatically blocked',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:24,h1:75,h24:110},volume:{m5:3000,h1:72000},txns:{m5:{buys:5,sells:5}}});
 assert.equal(result.detectors.accelerationWithoutConfirmation,true);
 assert.equal(result.blockPublication,false);
 assert.ok(result.adjustment<0);
});

test('profit-taking pressure is detected from a sufficiently large five-minute trade sample',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:1,h1:90},volume:{m5:7000,h1:50000},txns:{m5:{buys:5,sells:12}}});
 assert.equal(result.detectors.profitTakingPressure,true);
 assert.equal(result.blockPublication,false);
});

test('a pullback after a strong hourly rise is distinguished from a confirmed selloff',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:-4,h1:35,h24:80},volume:{m5:7000,h1:60000},txns:{m5:{buys:12,sells:8}}});
 assert.equal(result.detectors.pullback,true);
 assert.equal(result.blockPublication,false);
});

test('exhaustion and a severe confirmed selloff are detected using combined signals',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:-22,h1:45,h24:90},volume:{m5:18000,h1:60000},txns:{m5:{buys:5,sells:18}}});
 assert.equal(result.detectors.exhaustion,true);
 assert.equal(result.blockPublication,true);
 assert.equal(result.status,'selloff');
});

test('missing price and volume fields remain unknown instead of being fabricated as zero',()=>{
 const result=evaluateMomentumRisk({});
 assert.equal(result.metrics.priceChange5mPct,null);
 assert.equal(result.metrics.relativeVolume5m,null);
 assert.equal(result.detectors.earlyMomentum,false);
 assert.equal(result.blockPublication,false);
});

test('selection keeps an otherwise qualified +200% candidate in the best shortlist',()=>{
 const {buildSelection}=require('../lib/selection');
 const now=20_000_000;
 const token={
  mint:'late-but-still-strong',pairAddress:'pool-1',liquidityUsd:25000,fdv:300000,
  volume:{m5:10000,h1:90000},
  txns:{m5:{buys:30,sells:8},h1:{buys:80,sells:20}},
  priceChange:{m5:4,h1:85,h24:210},
  history:[{at:now-30_000}],
  security:{checkedAt:new Date(now-5*60_000).toISOString()},
  sellability:{status:'route_available',routeAvailable:true,requestedUsd:100,priceImpactPct:1,checkedAt:new Date(now-5*60_000).toISOString()},
  analysis:{score:92,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,exitCapacityUsd:100,flags:[],factors:{activity:90,momentum:82,market:90,liquidityQuality:90,security:95}}
 };
 const result=buildSelection([token],now,{minScore:80,settings:{minScore:80,minCoverage:70,minLiquidityUsd:5000,minVolume1hUsd:750,minTransactions1h:8,minBuyRatioPct:50,maxFdvLiquidityRatio:35}});
 assert.equal(result.best.length,1);
 assert.equal(result.best[0].mint,token.mint);
 assert.equal(result.best[0].momentumRisk.blockPublication,false);
});

test('selection excludes a candidate only when a severe selloff is confirmed by price and transaction flow',()=>{
 const {buildSelection}=require('../lib/selection');
 const now=20_000_000;
 const token={
  mint:'confirmed-selloff',pairAddress:'pool-2',liquidityUsd:25000,fdv:300000,
  volume:{m5:18000,h1:60000},
  txns:{m5:{buys:5,sells:18},h1:{buys:80,sells:20}},
  priceChange:{m5:-22,h1:45,h24:90},
  history:[{at:now-30_000}],
  security:{checkedAt:new Date(now-30*60_000).toISOString()},
  analysis:{score:92,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,flags:[],factors:{activity:90,market:90,liquidityQuality:90,security:95}}
 };
 const result=buildSelection([token],now,{minScore:80,settings:{minScore:80,minCoverage:70,minLiquidityUsd:5000,minVolume1hUsd:750,minTransactions1h:8,minBuyRatioPct:50,maxFdvLiquidityRatio:35}});
 assert.equal(result.best.length,0);
 assert.equal(result.diagnostics.momentumSelloffBlocked,1);
});

test('a vertical +592% move without fresh five-minute confirmation is blocked',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:null,h1:592,h24:592},volume:{h1:45000},txns:{h1:{buys:588,sells:82}}});
 assert.equal(result.detectors.verticalMove,true);
 assert.equal(result.detectors.verticalMoveUnconfirmed,true);
 assert.equal(result.blockPublication,true);
 assert.equal(result.status,'unconfirmed_vertical_move');
});
test('a vertical move with positive five-minute price, buyers and relative volume is not automatically blocked',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:592,h24:592},volume:{m5:5000,h1:45000},txns:{m5:{buys:18,sells:5}},tradeIntel:tradeProof()});
 assert.equal(result.detectors.verticalMoveUnconfirmed,false);
 assert.equal(result.detectors.independentDemand,true);
 assert.equal(result.blockPublication,false);
});
test('a sustained fall since first observations blocks a high-scoring candidate',()=>{
 const now=Date.now(),history=[{at:now-8*60_000,priceUsd:1},{at:now-4*60_000,priceUsd:.82},{at:now-30_000,priceUsd:.76}];
 const result=evaluateMomentumRisk({history});
 assert.equal(result.detectors.negativeSinceFirstObservation,true);
 assert.equal(result.blockPublication,true);
});
test('a sharp retracement from the recent peak blocks publication',()=>{
 const now=Date.now(),history=[{at:now-8*60_000,priceUsd:1},{at:now-4*60_000,priceUsd:1.4},{at:now-30_000,priceUsd:1.02}];
 const result=evaluateMomentumRisk({history});
 assert.equal(result.detectors.severePeakDrawdown,true);
 assert.equal(result.blockPublication,true);
});

test('a young pool with a +207% hourly move remains eligible when fresh momentum is confirmed',()=>{
 const result=evaluateMomentumRisk({
  pairCreatedAt:Date.now()-9*60_000,
  priceChange:{m5:4,h1:207,h24:207},
  volume:{m5:5000,h1:45000},
  txns:{m5:{buys:18,sells:5}},
  tradeIntel:tradeProof()
 });
 assert.equal(result.detectors.lateLaunchVertical,true);
 assert.equal(result.detectors.lateLaunchMomentumConfirmed,true);
 assert.equal(result.detectors.lateLaunchExhaustion,false);
 assert.equal(result.blockPublication,false);
 assert.equal(result.status,'late_launch_confirmed');
 assert.ok(result.signals.some(x=>/confirment encore le mouvement/i.test(x)));
});

test('a young pool with a +207% hourly move is blocked when five-minute demand is no longer confirmed',()=>{
 const result=evaluateMomentumRisk({
  pairCreatedAt:Date.now()-9*60_000,
  priceChange:{m5:-2,h1:207,h24:207},
  volume:{m5:1500,h1:45000},
  txns:{m5:{buys:5,sells:9}}
 });
 assert.equal(result.detectors.lateLaunchVertical,true);
 assert.equal(result.detectors.lateLaunchMomentumConfirmed,false);
 assert.equal(result.detectors.lateLaunchExhaustion,true);
 assert.equal(result.blockPublication,true);
 assert.equal(result.status,'late_launch_exhaustion');
 assert.ok(result.signals.some(x=>/ne confirment plus/i.test(x)));
});

test('a young pool without an extreme hourly pump is not blocked by the anti-chase rule',()=>{
 const result=evaluateMomentumRisk({
  pairCreatedAt:Date.now()-9*60_000,
  priceChange:{m5:4,h1:65,h24:65},
  volume:{m5:5000,h1:45000},
  txns:{m5:{buys:18,sells:5}}
 });
 assert.equal(result.detectors.lateLaunchVertical,false);
 assert.equal(result.blockPublication,false);
});

test('a strong hourly move without reliable pool age is not treated as a young-pool pump',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:207,h24:207},volume:{m5:5000,h1:45000},txns:{m5:{buys:18,sells:5}}});
 assert.equal(result.detectors.lateLaunchVertical,false);
 assert.equal(result.blockPublication,false);
});

test('a vertical move with short-term buying pressure but no independent demand is blocked',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:592,h24:592},volume:{m5:5000,h1:45000},txns:{m5:{buys:18,sells:5}}});
 assert.equal(result.detectors.shortTermMomentumConfirmed,true);
 assert.equal(result.detectors.independentDemand,false);
 assert.equal(result.detectors.verticalMoveUnconfirmed,true);
 assert.equal(result.blockPublication,true);
});

test('a +207% young launch can pass when independent trade demand is verified',()=>{
 const result=evaluateMomentumRisk({pairCreatedAt:Date.now()-9*60_000,priceChange:{m5:4,h1:207,h24:207},volume:{m5:5000,h1:45000},txns:{m5:{buys:18,sells:5}},tradeIntel:tradeProof()});
 assert.equal(result.detectors.lateLaunchMomentumConfirmed,true);
 assert.equal(result.blockPublication,false);
});

test('a broad fresh Gecko market sample can corroborate strong short-term momentum without being labelled RPC proof',()=>{
 const sampledOnly={checkedAt:new Date().toISOString(),tradeCount:40,uniqueBuyers:15,top5BuyerSharePct:52,buyVolumeUsd:12000,sellVolumeUsd:7000,earlyWindow:{complete:true}};
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:592,h24:592},volume:{m5:5000,h1:45000},txns:{m5:{buys:18,sells:5}},tradeIntel:sampledOnly,analysis:{factors:{earlyBuyerSignal:90}}});
 assert.equal(result.metrics.tradeIntelFresh,true);
 assert.equal(result.detectors.verifiedTradeDemand,false);
 assert.equal(result.detectors.verifiedEarlyBuyerDemand,false);
 assert.equal(result.detectors.independentDemand,false);
 assert.equal(result.detectors.observedMarketDemand,true);
 assert.equal(result.blockPublication,false);
});

test('a vertical move with weak or missing market sample and no independent demand remains blocked',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:592,h24:592},volume:{m5:5000,h1:45000},txns:{m5:{buys:18,sells:5}},tradeIntel:{checkedAt:new Date().toISOString(),tradeCount:8,uniqueBuyers:4,top5BuyerSharePct:85,buyVolumeUsd:12000,sellVolumeUsd:7000}});
 assert.equal(result.detectors.shortTermMomentumConfirmed,true);
 assert.equal(result.detectors.observedMarketDemand,false);
 assert.equal(result.detectors.independentDemand,false);
 assert.equal(result.blockPublication,true);
});

test('RPC-confirmed trade evidence may validate demand when its sample is sufficiently broad',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:592,h24:592},volume:{m5:5000,h1:45000},txns:{m5:{buys:18,sells:5}},tradeIntel:tradeProof()});
 assert.equal(result.detectors.verifiedTradeDemand,true);
 assert.equal(result.detectors.independentDemand,true);
 assert.equal(result.blockPublication,false);
});

test('qualified wallets with confirmed swap history can validate demand without Gecko sample trust',()=>{
 const result=evaluateMomentumRisk({priceChange:{m5:4,h1:592,h24:592},volume:{m5:5000,h1:45000},txns:{m5:{buys:18,sells:5}},walletReputation:{qualified:true,score:72}});
 assert.equal(result.detectors.verifiedWalletDemand,true);
 assert.equal(result.detectors.independentDemand,true);
 assert.equal(result.blockPublication,false);
});
