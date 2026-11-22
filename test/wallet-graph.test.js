'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {walletGraphIntel}=require('../lib/wallet-graph');

test('wallet graph detects a shared creator funder and labels evidence conservatively',()=>{
 const funder='Funder11111111111111111111111111111111';
 const a='Creator111111111111111111111111111111111';
 const b='Creator222222222222222222222222222222222';
 const state={wallets:[],autoWallets:[],walletTrades:[],tokens:{
  one:{mint:'one',creator:a,creatorObservedAtLaunch:true,creatorFunding:{funder,sol:0.2}},
  two:{mint:'two',creator:b,creatorObservedAtLaunch:true,creatorFunding:{funder,sol:0.3}}
 }};
 const result=walletGraphIntel.call({state});
 assert.equal(result.summary.strongFundingLinks,1);
 assert.equal(result.clusters.length,1);
 assert.equal(result.clusters[0].walletCount,2);
 assert.equal(result.edges[0].classification,'shared_creator_funder');
 assert.match(result.edges[0].warning,/ne prouve pas/i);
});

test('wallet graph requires repeated behavior before forming a behavioral group',()=>{
 const a='Wallet11111111111111111111111111111111111';
 const b='Wallet22222222222222222222222222222222222';
 const state={wallets:[{address:a},{address:b}],autoWallets:[],tokens:{x:{mint:'x'},y:{mint:'y'}},walletTrades:[
  {wallet:a,mint:'x',direction:'buy',at:new Date(100000).toISOString(),slot:10},
  {wallet:b,mint:'x',direction:'buy',at:new Date(101000).toISOString(),slot:10},
  {wallet:a,mint:'y',direction:'buy',at:new Date(200000).toISOString(),slot:20},
  {wallet:b,mint:'y',direction:'buy',at:new Date(201000).toISOString(),slot:20}
 ]};
 const result=walletGraphIntel.call({state});
 assert.equal(result.clusters.length,1);
 assert.equal(result.clusters[0].confidence,'moderate_behavioral_pattern');
 assert.equal(result.edges[0].distinctMints,2);
});

test('a single same-slot event remains a weak temporal signal, not a bundle',()=>{
 const a='Wallet33333333333333333333333333333333333';
 const b='Wallet44444444444444444444444444444444444';
 const state={wallets:[{address:a},{address:b}],autoWallets:[],tokens:{x:{mint:'x'}},walletTrades:[
  {wallet:a,mint:'x',direction:'buy',at:new Date(100000).toISOString(),slot:10},
  {wallet:b,mint:'x',direction:'buy',at:new Date(100100).toISOString(),slot:10}
 ]};
 const result=walletGraphIntel.call({state});
 assert.equal(result.clusters.length,0);
 assert.equal(result.edges[0].confidence,'weak_temporal_signal');
});

test('wallet graph bounds pair generation for large same-token bursts',()=>{
 const wallets=Array.from({length:250},(_,i)=>'Wallet'+String(i).padStart(3,'0')+'111111111111111111111111111');
 const walletTrades=wallets.map((wallet,i)=>({wallet,mint:'busy-mint',direction:'buy',at:new Date(100000+i*10).toISOString(),slot:100+i}));
 const result=walletGraphIntel.call({state:{wallets:[],autoWallets:[],tokens:{'busy-mint':{mint:'busy-mint'}},walletTrades}});
 assert.ok(result.summary.candidateLinks<=100);
 assert.ok(result.edges.length<=100);
});

test('wallet graph caps the number of exported edges globally',()=>{
 const walletTrades=[];
 for(let mintIndex=0;mintIndex<80;mintIndex++){
  const mint='mint-'+mintIndex;
  for(let i=0;i<100;i++)walletTrades.push({wallet:'w'+mintIndex+'-'+i,mint,direction:'buy',at:new Date(100000+i*10).toISOString(),slot:100+i});
 }
 const result=walletGraphIntel.call({state:{wallets:[],autoWallets:[],tokens:{},walletTrades}});
 assert.ok(result.summary.candidateLinks<=5000);
 assert.ok(result.edges.length<=300);
});
