'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 buildEliteIntelligenceIndex,analyzeOrganicDemand,analyzeWalletNetwork,
 analyzeHolderAndTokenSecurity,analyzeHolderConcentrationRisk,assessSevereWashTrading,analyzeLearningValidation,buildDiscoveryCoverage,
 evaluateEliteIntelligence
}=require('../lib/elite-intelligence');

const w1='CyaE1Vxv111111111111111111111111111111111111';
const w2='DyaE1Vxv111111111111111111111111111111111111';
const w3='EyaE1Vxv111111111111111111111111111111111111';
const w4='FyaE1Vxv111111111111111111111111111111111111';
const mint='tca3tbFf111111111111111111111111111111111111';
const other='uca3tbFf111111111111111111111111111111111111';

test('organic demand requires a meaningful sample and reports uncertainty',()=>{
 const empty=analyzeOrganicDemand({tradeIntel:{observedTrades:[]}});
 assert.equal(empty.status,'insufficient_data');
 assert.equal(empty.adjustment,0);
 const rows=[];
 for(let i=0;i<30;i++){const wallet=[w1,w2,w3,w4][i%4];rows.push({wallet,direction:Math.floor(i/4)%2?'sell':'buy',at:new Date(100000+i*1000).toISOString(),volumeUsd:10,slot:i});}
 const result=analyzeOrganicDemand({tradeIntel:{observedTrades:rows,tradeCount:30,earlyWindow:{complete:false}}});
 assert.ok(result.buyerSellerOverlap>=3);
 assert.ok(result.reasons.length>0);
 assert.ok(result.confidence==='low'||result.confidence==='moderate');
 assert.match(result.limitations,/jamais une preuve/);
});

test('wallet network identifies repeated wallets across tokens without asserting identity',()=>{
 const state={tokens:{},walletTrades:[
  ...[w1,w2,w3,w4].map((wallet,i)=>({wallet,mint,direction:'buy',at:new Date(100000+i*1000).toISOString(),swapConfirmed:true})),
  ...[w1,w2,w3,w4].map((wallet,i)=>({wallet,mint:other,direction:'buy',at:new Date(200000+i*1000).toISOString(),swapConfirmed:true}))
 ]};
 const index=buildEliteIntelligenceIndex(state);
 const result=analyzeWalletNetwork({mint},index);
 assert.equal(index.tradeEvents,8);
 assert.equal(result.recurrentWallets,4);
 assert.equal(result.adjustment,0);
 assert.match(result.limitations,/ne démontre/);
});

test('holder review remains partial when owner evidence or Token-2022 extensions are missing',()=>{
 const partial=analyzeHolderAndTokenSecurity({security:{checkedAt:new Date().toISOString(),data:{isToken2022:true,ownerConcentrationAvailable:false,holderSampleAccounts:20}}});
 assert.equal(partial.complete,false);
 assert.equal(partial.status,'partial');
 assert.ok(partial.reasons.some(x=>x.includes('extensions')));
});

test('learning validation requires every independent holdout condition',()=>{
 const failed=analyzeLearningValidation({outOfSample:{status:'holdout_available',validation:{tokens:40},holdoutAtSelectedThreshold:{tokens:30,positive15Pct:70,averageReturnPct:5,loss20Pct:10},selectedThreshold:80}});
 assert.equal(failed.validated,true);
 const tooSmall=analyzeLearningValidation({outOfSample:{status:'holdout_available',validation:{tokens:10},holdoutAtSelectedThreshold:{tokens:30,positive15Pct:70,averageReturnPct:5,loss20Pct:10}}});
 assert.equal(tooSmall.validated,false);
});

test('discovery coverage does not claim unsupported launchpads are monitored',()=>{
 const coverage=buildDiscoveryCoverage({sources:{pumpPortal:{ok:true},geckoTerminal:{ok:true}}});
 assert.ok(coverage.monitored.some(x=>x.key==='pumpPortal'&&x.status==='connected'));
 assert.ok(coverage.notIntegrated.includes('Heaven'));
 assert.equal(coverage.status,'partial');
});

test('elite intelligence aggregates five phases and never penalizes missing evidence',()=>{
 const result=evaluateEliteIntelligence({mint,tradeIntel:{observedTrades:[]}}, {tokens:{[mint]:{}},walletTrades:[]});
 assert.equal(result.phases.organicDemand.adjustment,0);
 assert.equal(result.phases.walletNetwork.adjustment,0);
 assert.equal(result.phases.discovery.status,'partial');
 assert.equal(result.phases.learningValidation.validated,false);
 assert.equal(result.adjustment,0);
});


test('repeated rapid buy-sell round trips trigger only a small penalty on a sufficiently large sample',()=>{
 const rows=[];
 let sequence=0;
 for(const wallet of [w1,w2,w3,w4,'GyaE1Vxv111111111111111111111111111111111111','HyaE1Vxv111111111111111111111111111111111111','JyaE1Vxv111111111111111111111111111111111111','KyaE1Vxv111111111111111111111111111111111111','LyaE1Vxv111111111111111111111111111111111111','MyaE1Vxv111111111111111111111111111111111111']){
  for(let cycle=0;cycle<4;cycle++){
   rows.push({wallet,direction:'buy',at:100000+sequence*1000,volumeUsd:20+sequence++});
   rows.push({wallet,direction:'sell',at:100000+sequence*1000,volumeUsd:20+sequence++});
  }
 }
 const result=analyzeOrganicDemand({tradeIntel:{observedTrades:rows,tradeCount:80,earlyWindow:{complete:true}}},null,Date.now());
 assert.equal(result.confidence,'moderate');
 assert.equal(result.shortRoundTripWallets,10);
 assert.equal(result.shortRoundTripSharePct,100);
 assert.ok(result.reasons.some(reason=>reason.includes('rotation rapide')));
 assert.equal(result.adjustment,-2);
});


test('unconfirmed GeckoTerminal trade samples cannot create recurring wallet-network links',()=>{
 const state={tokens:{},walletTrades:[
  ...[w1,w2,w3,w4].map((wallet,i)=>({wallet,mint,direction:'buy',at:new Date(100000+i*1000).toISOString(),swapConfirmed:false,source:'gecko_pool_sample'})),
  ...[w1,w2,w3,w4].map((wallet,i)=>({wallet,mint:other,direction:'buy',at:new Date(200000+i*1000).toISOString(),swapConfirmed:false,source:'gecko_pool_sample'}))
 ]};
 const index=buildEliteIntelligenceIndex(state);
 const result=analyzeWalletNetwork({mint},index);
 assert.equal(index.tradeEvents,0);
 assert.equal(result.trackedBuyers,0);
 assert.equal(result.recurrentWallets,0);
 assert.equal(result.adjustment,0);
 assert.equal(result.status,'insufficient_data');
});


test('holder concentration applies graduated penalties and blocks extreme verified ownership',()=>{
 const mild=analyzeHolderConcentrationRisk({ownerConcentrationAvailable:true,top10HolderPercent:18,top1OwnerPercent:4,top20HolderPercent:35});
 assert.equal(mild.level,'notice');
 assert.equal(mild.adjustment,-2);
 const high=analyzeHolderConcentrationRisk({ownerConcentrationAvailable:true,top10HolderPercent:32,top1OwnerPercent:8,top20HolderPercent:60});
 assert.equal(high.level,'warning');
 assert.ok(high.adjustment<=-5);
 const extreme=analyzeHolderConcentrationRisk({ownerConcentrationAvailable:true,top10HolderPercent:48,top1OwnerPercent:27,top20HolderPercent:90});
 assert.equal(extreme.level,'critical');
 assert.ok(extreme.adjustment<=-10);
});

test('missing holder evidence is unknown and never receives an invented penalty',()=>{
 const result=analyzeHolderConcentrationRisk({ownerConcentrationAvailable:false,top10HolderPercent:null});
 assert.equal(result.status,'unavailable');
 assert.equal(result.adjustment,0);
 assert.equal(result.level,'none');
});

test('wash trading blocks only when independent high-confidence indicators and confirmed RPC events converge',()=>{
 const risky={confidence:'moderate',sampleSize:80,repeatedAmountSharePct:40};
 const events=[];
 for(let i=0;i<10;i++){
  const wallet=String.fromCharCode(65+i)+'yaE1Vxv111111111111111111111111111111111111';
  for(let cycle=0;cycle<4;cycle++){
   events.push({wallet,mint,direction:'buy',at:100000+i*10000+cycle*2000,slot:cycle});
   events.push({wallet,mint,direction:'sell',at:101000+i*10000+cycle*2000,slot:cycle});
  }
 }
 const index={byMint:new Map([[mint,events]])};
 assert.equal(assessSevereWashTrading(risky,{mint},index).confirmed,true);
 const weak={...risky,sampleSize:25};
 assert.equal(assessSevereWashTrading(weak,{mint},index).confirmed,false);
 const incomplete={...risky,repeatedAmountSharePct:10};
 assert.equal(assessSevereWashTrading(incomplete,{mint},index).confirmed,false);
 assert.equal(assessSevereWashTrading(risky,{mint},{byMint:new Map()}).confirmed,false,'market samples alone must never block');
});

test('elite intelligence blocks extreme holder concentration and severe wash-trading evidence',()=>{
 const concentrated=evaluateEliteIntelligence({mint,security:{checkedAt:new Date().toISOString(),data:{ownerConcentrationAvailable:true,top10HolderPercent:50,top1OwnerPercent:28,top20HolderPercent:90,holderSampleAccounts:20}}},{tokens:{[mint]:{}},walletTrades:[]});
 assert.ok(concentrated.flags.some(flag=>flag.code==='ELITE_HOLDER_CONCENTRATION_CRITICAL'&&flag.level==='critical'));
 const rows=[];
 for(let i=0;i<10;i++){
  const wallet=String.fromCharCode(65+i)+'yaE1Vxv111111111111111111111111111111111111';
  for(let cycle=0;cycle<4;cycle++){
   rows.push({wallet,mint,direction:'buy',at:100000+i*10000+cycle*2000,slot:cycle,swapConfirmed:true,volumeUsd:20});
   rows.push({wallet,mint,direction:'sell',at:101000+i*10000+cycle*2000,slot:cycle,swapConfirmed:true,volumeUsd:20});
  }
 }
 const wash=evaluateEliteIntelligence({mint,tradeIntel:{observedTrades:rows,tradeCount:80,sameBlockBuyerClusters:3,earlyWindow:{complete:true}}},{tokens:{[mint]:{}},walletTrades:rows});
 assert.ok(wash.flags.some(flag=>flag.code==='ELITE_WASH_TRADING_HIGH_CONFIDENCE'&&flag.level==='critical'));
});
