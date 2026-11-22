'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildHeliusWalletSnapshot}=require('../lib/helius-wallet-intel');

const wallet='CyaE1Vxv111111111111111111111111111111111111';
const mint='tca3tbFf111111111111111111111111111111111111';

test('Helius wallet snapshot exposes tracked wallets and actual RPC source status',()=>{
 const state={
  wallets:[{address:wallet,label:'Wallet manuel'}],
  autoWallets:[],tokens:{},
  walletTrades:[{wallet,mint,signature:'sig-1',at:'2026-11-22T00:00:00.000Z',direction:'buy',tokenAmount:100,swapConfirmed:true,quoteSpent:{asset:'SOL',amount:1}}],
 };
 const snapshot=buildHeliusWalletSnapshot(state,{heliusConfigured:true,connected:true,endpoint:'helius',lastSuccess:'2026-11-22T00:01:00.000Z'},Date.parse('2026-11-22T00:02:00.000Z'));
 assert.equal(snapshot.provider,'Helius RPC');
 assert.equal(snapshot.source.connected,true);
 assert.equal(snapshot.summary.trackedWallets,1);
 assert.equal(snapshot.tradeCount,1);
 assert.equal(snapshot.recentTrades[0].confirmed,true);
 assert.equal(snapshot.experts[0].wallet,wallet);
});

test('Helius wallet snapshot does not claim Helius is configured when only public RPC is active',()=>{
 const snapshot=buildHeliusWalletSnapshot({wallets:[],autoWallets:[],tokens:{},walletTrades:[]},{heliusConfigured:false,connected:true});
 assert.equal(snapshot.configured,false);
 assert.equal(snapshot.source.connected,false);
 assert.match(snapshot.source.mode,/RPC publics/);
 assert.equal(snapshot.expertCount,0);
});
