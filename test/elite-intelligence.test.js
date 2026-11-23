'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 buildEliteIntelligenceIndex,analyzeOrganicDemand,analyzeWalletNetwork,
 analyzeHolderAndTokenSecurity,analyzeLearningValidation,buildDiscoveryCoverage,
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
  ...[w1,w2,w3,w4].map((wallet,i)=>({wallet,mint,direction:'buy',at:new Date(100000+i*1000).toISOString()})),
  ...[w1,w2,w3,w4].map((wallet,i)=>({wallet,mint:other,direction:'buy',at:new Date(200000+i*1000).toISOString()}))
 ]};
 const index=buildEliteIntelligenceIndex(state);
 const result=analyzeWalletNetwork({mint},index);
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
