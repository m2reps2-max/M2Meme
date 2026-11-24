'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {buildWalletReputation}=require('../lib/wallet-reputation');
const a='CyaE1Vxv111111111111111111111111111111111111',b='FixmSpsB111111111111111111111111111111111111',mint='tca3tbFf111111111111111111111111111111111111',mintB='tca3tbFf222222222222222222222222222222222222';
const event=(wallet,direction,signature,at,tokenAmount,quote)=>({wallet,mint,direction,signature,at,tokenAmount,swapConfirmed:true,...(direction==='buy'?{quoteSpent:quote}:{quoteReceived:quote})});
test('calculates realized average-cost ROI only for confirmed same-asset swaps',()=>{
 const state={tokens:{[mint]:{pumpCreatedAt:'2026-11-22T00:00:00Z'}},wallets:[{address:a,label:'Tracked'}],autoWallets:[],experts:[],walletTrades:[event(a,'buy','b1','2026-11-22T00:01:00Z',100,{asset:'SOL',amount:2}),event(a,'buy','b2','2026-11-22T00:02:00Z',100,{asset:'SOL',amount:2}),event(a,'sell','s1','2026-11-22T00:10:00Z',50,{asset:'SOL',amount:1.5}),event(a,'sell','s2','2026-11-22T00:11:00Z',50,{asset:'SOL',amount:1.5}),event(a,'sell','s3','2026-11-22T00:12:00Z',100,{asset:'SOL',amount:3})]};
 const row=buildWalletReputation(state).wallets[0];assert.equal(row.closedTrades,1);assert.equal(row.winRatePct,100);assert.equal(row.avgRoiPct,50);assert.equal(row.earlyTokens,1);assert.equal(row.openPositions,0);assert.ok(row.reputationScore<=54);
});
test('unconfirmed Gecko samples never count as realized PnL',()=>{
 const state={tokens:{[mint]:{}},wallets:[],autoWallets:[{address:a,discoveryScore:70,observations:[{mint,buyVolumeUsd:500}]}],experts:[],walletTrades:[{wallet:a,mint,direction:'buy',signature:'sample',at:'2026-11-22T00:00:00Z',volumeUsd:500,swapConfirmed:false}]};
 const row=buildWalletReputation(state).wallets[0];assert.equal(row.closedTrades,0);assert.equal(row.confirmedBuys,0);assert.ok(row.reputationScore<=54);
});
test('different quote assets do not create fabricated PnL',()=>{
 const state={tokens:{[mint]:{}},wallets:[{address:a}],autoWallets:[],experts:[],walletTrades:[event(a,'buy','b1','2026-11-22T00:00:00Z',100,{asset:'SOL',amount:1}),event(a,'sell','s1','2026-11-22T00:10:00Z',100,{asset:'USDC',amount:100})]};
 const row=buildWalletReputation(state).wallets[0];assert.equal(row.closedTrades,0);assert.equal(row.quoteAssetMismatches,1);
});
test('validates wallets and deduplicates repeated signatures',()=>{
 const state={tokens:{},wallets:[{address:'invalid'}],autoWallets:[],experts:[],walletTrades:[event(b,'buy','same','2026-11-22T00:00:00Z',10,{asset:'SOL',amount:1}),event(b,'buy','same','2026-11-22T00:00:00Z',10,{asset:'SOL',amount:1})]};
 const result=buildWalletReputation(state);assert.equal(result.summary.walletsTracked,1);assert.equal(result.wallets[0].confirmedBuys,1);
});

test('profit factor is not combined across SOL and stablecoin quote assets',()=>{
 const state={tokens:{[mint]:{},[mintB]:{}},wallets:[{address:a}],autoWallets:[],experts:[],walletTrades:[
  event(a,'buy','sol-buy','2026-11-22T00:00:00Z',100,{asset:'SOL',amount:1}),
  event(a,'sell','sol-sell','2026-11-22T00:01:00Z',100,{asset:'SOL',amount:2}),
  {...event(a,'buy','usdc-buy','2026-11-22T00:02:00Z',100,{asset:'USDC',amount:100}),mint:mintB},
  {...event(a,'sell','usdc-sell','2026-11-22T00:03:00Z',100,{asset:'USDC',amount:50}),mint:mintB}
 ]};
 const row=buildWalletReputation(state).wallets[0];
 assert.equal(row.profitFactor,null);
 assert.equal(row.realizedPnlByQuoteAsset.SOL.realizedPnl,1);
 assert.equal(row.realizedPnlByQuoteAsset.USDC.realizedPnl,-50);
 assert.equal(row.realizedPnlByQuoteAsset.SOL.profitFactor,null);
 assert.equal(row.realizedPnlByQuoteAsset.USDC.profitFactor,0);
});

test('partial exits do not inflate the count of fully closed wallet positions',()=>{
 const state={tokens:{[mint]:{}},wallets:[{address:a}],autoWallets:[],experts:[],walletTrades:[event(a,'buy','pb1','2026-11-22T00:00:00Z',100,{asset:'SOL',amount:2}),event(a,'buy','pb2','2026-11-22T00:01:00Z',100,{asset:'SOL',amount:2}),event(a,'sell','ps1','2026-11-22T00:10:00Z',50,{asset:'SOL',amount:1.5}),event(a,'sell','ps2','2026-11-22T00:11:00Z',50,{asset:'SOL',amount:1.5})]};
 const row=buildWalletReputation(state).wallets[0];
 assert.equal(row.closedTrades,0);
 assert.equal(row.openPositions,1);
 assert.equal(row.winRatePct,null);
 assert.equal(row.avgRoiPct,null);
});
