'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildWalletSignalBacktest}=require('../lib/wallet-signal-backtest');
const a='CyaE1Vxv111111111111111111111111111111111111';
const b='FixmSpsB111111111111111111111111111111111111';
const target='tca3tbFf111111111111111111111111111111111111';
const past1='tca3tbFf222222222222222222222222222222222222';
const past2='tca3tbFf333333333333333333333333333333333333';
function trade(wallet,mint,direction,signature,at,amount,quote){return {wallet,mint,direction,signature,at,tokenAmount:amount,swapConfirmed:true,...(direction==='buy'?{quoteSpent:{asset:'SOL',amount:quote}}:{quoteReceived:{asset:'SOL',amount:quote}})};}
function reputationTrades(wallet,prefix){return [
 trade(wallet,past1,'buy',prefix+'b1','2026-11-22T00:01:00Z',100,1),
 trade(wallet,past1,'sell',prefix+'s1','2026-11-22T00:02:00Z',100,2),
 trade(wallet,past2,'buy',prefix+'b2','2026-11-22T00:03:00Z',100,1),
 trade(wallet,past2,'sell',prefix+'s2','2026-11-22T00:04:00Z',100,2)
];}
function fixture(){
 const at=Date.parse('2026-11-22T01:00:00Z');
 return {walletTrades:[
  ...reputationTrades(a,'a'),...reputationTrades(b,'b'),
  trade(a,target,'buy','target-a','2026-11-22T00:55:00Z',10,.1),
  trade(b,target,'buy','target-b','2026-11-22T00:56:00Z',10,.1)
 ],tokens:{
  [target]:{mint:target,pumpCreatedAt:'2026-11-22T00:50:00Z',forecasts:[
   {at:at-900000,priceUsd:1.1,outcomes:{'1h':{returnPct:-10,label:'drawdown',maxFavorablePct:5,maxAdversePct:-15}}},
   {at:at,priceUsd:1,outcomes:{'1h':{returnPct:25,label:'win',maxFavorablePct:40,maxAdversePct:-5}}},
   {at:at+900000,priceUsd:1.2,outcomes:{'1h':{returnPct:-25,label:'loss',maxFavorablePct:5,maxAdversePct:-30}}}
  ]},
  [past1]:{mint:past1,forecasts:[{at:at,priceUsd:2,outcomes:{'1h':{returnPct:-30,label:'loss',maxFavorablePct:5,maxAdversePct:-40}}}]}
 }};
}
test('reconstructs reputation only from confirmed trades at or before the signal timestamp',()=>{
 const state=fixture();
 const before=buildWalletSignalBacktest(state);
 assert.equal(before.summary.signalTokens,1);
 assert.equal(before.byHorizon['1h'].walletSignal.tokens,1);
 assert.equal(before.byHorizon['1h'].walletSignal.positive15Pct,100);
 state.walletTrades.push(trade(a,target,'sell','future-sell','2026-11-22T02:00:00Z',10,.01));
 const after=buildWalletSignalBacktest(state);
 assert.equal(after.byHorizon['1h'].walletSignal.averageReturnPct,25);
});
test('compares one first signal per token against first-observation baselines',()=>{
 const result=buildWalletSignalBacktest(fixture());
 assert.equal(result.summary.signalTokens,1);
 assert.equal(result.byHorizon['1h'].walletSignal.tokens,1);
 assert.equal(result.byHorizon['1h'].firstObservedTokenBaseline.tokens,2);
 assert.equal(result.byHorizon['1h'].sameTokensAtFirstObservation.tokens,1);
 assert.equal(result.byHorizon['1h'].signalVsUniverseAverageReturnPct,45);
 assert.equal(result.byHorizon['1h'].sameTokensAtFirstObservation.averageReturnPct,-10);
 assert.equal(result.byHorizon['1h'].signalVsSameTokensFirstObservationPct,35);
});
test('returns an explicit insufficient-data status when no wallet signal exists',()=>{
 const state=fixture();state.walletTrades=state.walletTrades.filter(x=>x.mint!==target);
 const result=buildWalletSignalBacktest(state);
 assert.equal(result.summary.signalTokens,0);
 assert.equal(result.status,'no_wallet_convergence_observed');
 assert.equal(result.byHorizon['1h'].walletSignal.tokens,0);
});
test('ignores forecasts with no resolved outcome and does not duplicate a token signal',()=>{
 const state=fixture();state.tokens[target].forecasts.unshift({at:Date.parse('2026-11-22T00:30:00Z'),priceUsd:1,outcomes:{}});
 const result=buildWalletSignalBacktest(state);
 assert.equal(result.summary.signalTokens,1);
 assert.equal(result.byHorizon['1h'].walletSignal.tokens,1);
 assert.equal(result.byHorizon['1h'].walletSignal.averageReturnPct,25);
});
