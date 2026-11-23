'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildWalletTokenSignals}=require('../lib/wallet-token-signals');
const a='CyaE1Vxv111111111111111111111111111111111111';
const b='FixmSpsB111111111111111111111111111111111111';
const mint='tca3tbFf111111111111111111111111111111111111';
const mint2='tca3tbFf222222222222222222222222222222222222';
const mint3='tca3tbFf333333333333333333333333333333333333';
const mint4='tca3tbFf444444444444444444444444444444444444';
function trade(wallet,direction,signature,at,tokenAmount,quote,slot=null){return {wallet,mint,direction,signature,at,slot,tokenAmount,swapConfirmed:true,...(direction==='buy'?{quoteSpent:quote}:{quoteReceived:quote})};}
function state(walletTrades,extra={}){return {tokens:{[mint]:{pumpCreatedAt:'2026-11-22T00:00:00Z'},[mint2]:{},[mint3]:{},[mint4]:{}},wallets:[{address:a},{address:b}],autoWallets:[],experts:[],walletTrades,...extra};}
function provenHistory(wallet,prefix,otherMint=mint){
 return [
  {...trade(wallet,'buy',prefix+'b1','2026-11-22T00:01:00Z',100,{asset:'SOL',amount:1}),mint:otherMint},
  {...trade(wallet,'sell',prefix+'s1','2026-11-22T00:02:00Z',100,{asset:'SOL',amount:2}),mint:otherMint},
  {...trade(wallet,'buy',prefix+'b2','2026-11-22T00:03:00Z',100,{asset:'SOL',amount:1}),mint:mint3},
  {...trade(wallet,'sell',prefix+'s2','2026-11-22T00:04:00Z',100,{asset:'SOL',amount:2}),mint:mint3},
  {...trade(wallet,'buy',prefix+'b3','2026-11-22T00:05:00Z',100,{asset:'SOL',amount:1}),mint:mint4},
  {...trade(wallet,'sell',prefix+'s3','2026-11-22T00:06:00Z',100,{asset:'SOL',amount:2}),mint:mint4}
 ];
}
test('does not create a token score when fewer than two proven wallets buy',()=>{
 const rows=[...provenHistory(a,'a',mint2),trade(a,'buy','target-a','2026-11-22T00:10:00Z',10,{asset:'SOL',amount:.1})];
 const signal=buildWalletTokenSignals(state(rows),Date.parse('2026-11-22T00:11:00Z'))[mint];
 assert.equal(signal.qualified,false);assert.equal(signal.score,null);
});
test('two independent wallets with confirmed history create a convergent score',()=>{
 const rows=[...provenHistory(a,'a',mint2),...provenHistory(b,'b',mint2),trade(a,'buy','target-a','2026-11-22T00:10:00Z',10,{asset:'SOL',amount:.1},900),trade(b,'buy','target-b','2026-11-22T00:11:00Z',10,{asset:'SOL',amount:.1},901)];
 const signal=buildWalletTokenSignals(state(rows),Date.parse('2026-11-22T00:12:00Z'))[mint];
 assert.equal(signal.qualified,true);assert.equal(signal.trustedWalletBuys,2);assert.equal(signal.independentWallets,2);assert.ok(signal.score>0&&signal.score<=100);
});
test('recent sells by tracked buyers reduce the convergence score',()=>{
 const base=[...provenHistory(a,'a',mint2),...provenHistory(b,'b',mint2),trade(a,'buy','target-a','2026-11-22T00:10:00Z',10,{asset:'SOL',amount:.1},900),trade(b,'buy','target-b','2026-11-22T00:11:00Z',10,{asset:'SOL',amount:.1},901)];
 const now=Date.parse('2026-11-22T00:13:00Z');
 const normal=buildWalletTokenSignals(state(base),now)[mint].score;
 const sold=buildWalletTokenSignals(state([...base,trade(a,'sell','target-sell','2026-11-22T00:12:00Z',5,{asset:'SOL',amount:.2},902)]),now)[mint].score;
 assert.ok(sold<normal);
});
test('buyers entering in the same Solana slot count as one independent cluster',()=>{
 const rows=[...provenHistory(a,'a',mint2),...provenHistory(b,'b',mint2),trade(a,'buy','target-a','2026-11-22T00:10:00Z',10,{asset:'SOL',amount:.1},777),trade(b,'buy','target-b','2026-11-22T00:10:00Z',10,{asset:'SOL',amount:.1},777)];
 const signal=buildWalletTokenSignals(state(rows),Date.parse('2026-11-22T00:11:00Z'))[mint];
 assert.equal(signal.trustedWalletBuys,2);
 assert.equal(signal.independentWallets,1);
 assert.equal(signal.sameSlotClusteredWallets,1);
 assert.equal(signal.qualified,false);
 assert.equal(signal.score,null);
});
test('unconfirmed or stale swaps never count as current wallet convergence',()=>{
 const rows=[...provenHistory(a,'a',mint2),...provenHistory(b,'b',mint2),
  {...trade(a,'buy','unconfirmed-a','2026-11-22T00:10:00Z',10,{asset:'SOL',amount:.1}),swapConfirmed:false},
  trade(b,'buy','stale-b','2026-11-21T00:10:00Z',10,{asset:'SOL',amount:.1})];
 const result=buildWalletTokenSignals(state(rows),Date.parse('2026-11-22T00:12:00Z'));
 assert.equal(result[mint],undefined);
});
