'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {extractPoolSwapEvents,summarizePoolSwapEvents}=require('../lib/solana-pool-trades');
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
test('confirmed swap summary counts unique wallets once and leaves unknown USD volume null',()=>{
 const rows=[{wallet:'a',direction:'buy',signature:'1',at:'2026-11-26T00:00:00Z',volumeUsd:null},{wallet:'a',direction:'buy',signature:'2',at:'2026-11-26T00:00:01Z',volumeUsd:null},{wallet:'b',direction:'sell',signature:'3',at:'2026-11-26T00:00:02Z',volumeUsd:null}];
 const summary=summarizePoolSwapEvents(rows);
 assert.equal(summary.tradeCount,3);assert.equal(summary.uniqueBuyers,1);assert.equal(summary.uniqueSellers,1);assert.equal(summary.buyVolumeUsd,null);assert.equal(summary.volumeCoverage,0);
});
