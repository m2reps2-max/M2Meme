'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {recordEarlyBuyerCandidates,scoreWalletDiscovery}=require('../lib/wallet-discovery');

const at='2026-11-22T12:00:00.000Z';
const token=(mint,symbol)=>({mint,symbol});
const buyer=(wallet,buys=3,buyVolumeUsd=500)=>({wallet,buys,buyVolumeUsd});

test('repeated early buyers across independent tokens rise above one-token candidates',()=>{
 const first=recordEarlyBuyerCandidates([],token('mint-a','AAA'),[buyer('wallet-a'),buyer('wallet-b')],at);
 const second=recordEarlyBuyerCandidates(first.wallets,token('mint-b','BBB'),[buyer('wallet-a',4,700)],at);
 const recurrent=second.wallets.find(x=>x.address==='wallet-a');
 const single=second.wallets.find(x=>x.address==='wallet-b');
 assert.equal(recurrent.tokensObserved,2);
 assert.equal(recurrent.observations.length,2);
 assert.ok(recurrent.discoveryScore>single.discoveryScore);
 assert.match(recurrent.discoveryReasons.join(' '),/2 tokens distincts/);
});

test('refreshing the same token sample does not inflate counts or volume',()=>{
 const first=recordEarlyBuyerCandidates([],token('mint-a','AAA'),[buyer('wallet-a',3,500)],at);
 const second=recordEarlyBuyerCandidates(first.wallets,token('mint-a','AAA'),[buyer('wallet-a',3,500)],at);
 const wallet=second.wallets[0];
 assert.equal(wallet.observations.length,1);
 assert.equal(wallet.tokensObserved,1);
 assert.equal(wallet.buysObserved,3);
 assert.equal(wallet.buyVolumeUsd,500);
});

test('candidate admission rejects incomplete-quality inputs, small buys and creator wallet',()=>{
 const result=recordEarlyBuyerCandidates([],token('mint-a','AAA'),[
  buyer('too-small',1,100),
  buyer('creator-wallet',4,900),
  {wallet:'bad-volume',buys:4,buyVolumeUsd:NaN}
 ].filter(x=>x.wallet!=='creator-wallet'),at);
 assert.equal(result.wallets.length,0);
 const withCreator=recordEarlyBuyerCandidates([], {...token('mint-a','AAA'),creator:'creator-wallet'},[
  buyer('creator-wallet',4,900)
 ],at);
 assert.equal(withCreator.wallets.length,0);
});

test('legacy saved candidates receive a conservative score without losing their source history',()=>{
 const legacy={address:'wallet-legacy',sourceMint:'mint-a',sourceMints:['mint-a','mint-b'],buysObserved:6,buyVolumeUsd:1200};
 const score=scoreWalletDiscovery(legacy);
 assert.equal(score.tokensObserved,2);
 assert.equal(score.buysObserved,6);
 assert.ok(score.discoveryScore>20);
});

test('candidate list is bounded and ranked by discovery evidence',()=>{
 const buyers=Array.from({length:60},(_,i)=>buyer('wallet-'+i,2+i,150+i*200));
 const result=recordEarlyBuyerCandidates([],token('mint-a','AAA'),buyers,at);
 assert.equal(result.wallets.length,50);
 assert.ok(result.wallets[0].discoveryScore>=result.wallets.at(-1).discoveryScore);
});
