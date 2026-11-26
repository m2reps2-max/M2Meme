'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {extractPoolSwapEvents,summarizePoolSwapEvents,preserveRpcTradeEvidence}=require('../lib/solana-pool-trades');
const mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH',wallet='Ccdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
test('verified pool swap attributes mint balance delta to a transaction signer',()=>{
 const tx={slot:10,blockTime:1795720000,transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},meta:{err:null,preTokenBalances:[],postTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'25',amount:'25000000',decimals:6}}]}};
 const rows=extractPoolSwapEvents(tx,mint,{signature:'sig1'});
 assert.equal(rows.length,1);assert.equal(rows[0].wallet,wallet);assert.equal(rows[0].direction,'buy');assert.equal(rows[0].tokenAmount,25);assert.equal(rows[0].swapConfirmed,true);
});
test('unverified transfers and non-signing token owners are not counted as pool buyers',()=>{
 const tx={blockTime:1795720000,transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'system',parsed:{type:'transfer'}}]}},meta:{err:null,preTokenBalances:[],postTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'25',amount:'25000000',decimals:6}}]}};
 assert.deepEqual(extractPoolSwapEvents(tx,mint,{signature:'sig2'}),[]);
 const swap={...tx,transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},meta:{...tx.meta,postTokenBalances:[{mint,owner:'Dddefghijkmnopqrstuvwxyz123456789ABCDEFGH',uiTokenAmount:{uiAmountString:'25',amount:'25000000',decimals:6}}]}};
 assert.deepEqual(extractPoolSwapEvents(swap,mint,{signature:'sig3'}),[]);
});
test('Gecko refresh preserves previously verified RPC evidence',()=>{
 const gecko={checkedAt:new Date().toISOString(),tradeCount:300,observedTrades:[]};
 const previous={rpcConfirmedTradeCount:8,rpcConfirmedUniqueBuyers:6,rpcConfirmedCheckedAt:'2026-11-26T20:00:00Z',rpcConfirmedLastTradeAt:'2026-11-26T20:00:00Z',uniqueBuyers:1};
 const merged=preserveRpcTradeEvidence(gecko,previous);
 assert.equal(merged.tradeCount,300);assert.equal(merged.rpcConfirmedTradeCount,8);assert.equal(merged.rpcConfirmedUniqueBuyers,6);
});
test('multi-owner transaction counts once and never duplicates its USD notional',()=>{
 const now=Date.now(),at=new Date(now-1000).toISOString();
 const rows=[{wallet:'a',direction:'buy',signature:'shared-sig',at,volumeUsd:25},{wallet:'b',direction:'buy',signature:'shared-sig',at,volumeUsd:null}];
 const summary=summarizePoolSwapEvents(rows);
 assert.equal(summary.tradeCount,1);assert.equal(summary.buys,1);assert.equal(summary.uniqueBuyers,2);assert.equal(summary.buyVolumeUsd,25);assert.equal(summary.volumeCoverage,100);
});
test('pool RPC diagnostics expose freshness, per-pool buyers and bounded pending state',()=>{
 const {summarizePoolRpcCoverage}=require('../lib/solana-pool-trades');
 const now=Date.now();
 const result=summarizePoolRpcCoverage([
  {mint:'mint-a',symbol:'A',analysis:{score:72},poolRpcTradeIntel:{checkedAt:new Date(now-60000).toISOString(),lastTradeAt:new Date(now-30000).toISOString(),tradeCount:4,uniqueBuyers:3,uniqueSellers:1,buyVolumeUsd:12,sellVolumeUsd:4,volumeCoverage:75,processedLastBatch:6,failedLastBatch:1},poolRpcTradeState:{pending:[{signature:'pending'}]}},
  {mint:'mint-b',poolRpcTradeIntel:{checkedAt:new Date(now-20*60000).toISOString(),lastTradeAt:null,tradeCount:0,uniqueBuyers:0},poolRpcTradeState:{gapDetected:true}}
 ],now);
 assert.equal(result.inspectedPools,2);
 assert.equal(result.freshChecks10m,1);
 assert.equal(result.poolsWithRecentSwaps,1);
 assert.equal(result.confirmedSwapsRecentWindow,4);
 assert.equal(result.uniqueBuyersByPool,3);
 assert.equal(result.pendingTransactions,1);
 assert.equal(result.failedTransactionsLastBatch,1);
 assert.equal(result.poolsWithGaps,1);
 assert.equal(result.topPools[0].mint,'mint-a');
});
test('confirmed swap summary counts unique wallets once and leaves unknown USD volume null',()=>{
 const base=Date.now()-3000;
 const rows=[{wallet:'a',direction:'buy',signature:'1',at:new Date(base).toISOString(),volumeUsd:null},{wallet:'a',direction:'buy',signature:'2',at:new Date(base+1000).toISOString(),volumeUsd:null},{wallet:'b',direction:'sell',signature:'3',at:new Date(base+2000).toISOString(),volumeUsd:null}];
 const summary=summarizePoolSwapEvents(rows);
 assert.equal(summary.tradeCount,3);assert.equal(summary.uniqueBuyers,1);assert.equal(summary.uniqueSellers,1);assert.equal(summary.buyVolumeUsd,null);assert.equal(summary.volumeCoverage,0);
 const stale=summarizePoolSwapEvents([{wallet:'old',direction:'buy',at:new Date(Date.now()-16*60_000).toISOString(),volumeUsd:10}]);
 assert.equal(stale.tradeCount,0,'old RPC swaps must not keep demand fresh');
});
