'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {detectBundleCandidates}=require('../lib/wallet-bundles');

const at=ms=>new Date(Date.UTC(2026,10,22,12)+ms).toISOString();

test('three distinct confirmed RPC buyers in one slot produce an auditable bundle-like candidate',()=>{
 const trades=[
  {wallet:'walletA',mint:'mintA',direction:'buy',at:at(0),slot:100,signature:'a',swapConfirmed:true},
  {wallet:'walletB',mint:'mintA',direction:'buy',at:at(500),slot:100,signature:'b',swapConfirmed:true},
  {wallet:'walletC',mint:'mintA',direction:'buy',at:at(900),slot:100,signature:'c',swapConfirmed:true}
 ];
 const result=detectBundleCandidates(trades,{mintA:{symbol:'CAT'}});
 assert.equal(result.candidates.length,1);
 assert.equal(result.candidates[0].kind,'same_slot_and_time_burst');
 assert.equal(result.candidates[0].uniqueBuyers,3);
 assert.equal(result.candidates[0].confirmedRpcBuyers,3);
 assert.equal(result.candidates[0].confidence,'observed_onchain_buyer_cluster');
 assert.equal(result.candidates[0].symbol,'CAT');
 assert.match(result.candidates[0].warning,/ne prouvent ni/i);
});

test('wallet overlap across two tokens is surfaced as a recurrent group, not proof of ownership',()=>{
 const trades=[];
 for(const [mint,slot,offset] of [['mintA',100,0],['mintB',200,60000]]){
  for(const [i,wallet] of ['walletA','walletB','walletC'].entries()){
   trades.push({wallet,mint,direction:'buy',at:at(offset+i*250),slot,signature:mint+wallet,swapConfirmed:true});
  }
 }
 const result=detectBundleCandidates(trades,{mintA:{symbol:'CAT'},mintB:{symbol:'DOG'}});
 assert.equal(result.candidates.length,2);
 assert.equal(result.recurrentGroups.length,1);
 assert.equal(result.recurrentGroups[0].sharedWalletCount,3);
 assert.deepEqual(result.recurrentGroups[0].symbols,['CAT','DOG']);
 assert.match(result.recurrentGroups[0].warning,/pas une preuve/i);
});

test('two wallets or repeated trades by one wallet do not trigger bundle candidates',()=>{
 const trades=[
  {wallet:'walletA',mint:'mintA',direction:'buy',at:at(0),slot:100,signature:'a1'},
  {wallet:'walletA',mint:'mintA',direction:'buy',at:at(100),slot:100,signature:'a2'},
  {wallet:'walletB',mint:'mintA',direction:'buy',at:at(200),slot:100,signature:'b'}
 ];
 const result=detectBundleCandidates(trades);
 assert.equal(result.candidates.length,0);
 assert.equal(result.recurrentGroups.length,0);
});

test('GeckoTerminal-only samples are labelled as sample-based and not confirmed RPC',()=>{
 const trades=['walletA','walletB','walletC'].map((wallet,i)=>({
  wallet,mint:'mintA',direction:'buy',at:at(i*200),slot:500,signature:'g'+i,source:'gecko_pool_sample',role:'gecko_sample',swapConfirmed:false
 }));
 const result=detectBundleCandidates(trades);
 assert.equal(result.candidates.length,1);
 assert.equal(result.candidates[0].geckoSampleBuyers,3);
 assert.equal(result.candidates[0].confirmedRpcBuyers,0);
 assert.equal(result.candidates[0].confidence,'bundle_like_temporal_cluster');
 assert.equal(result.candidates[0].evidence,'gecko_pool_sample_only');
});
