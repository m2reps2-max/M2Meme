'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {extractPoolSwapEvents,summarizePoolSwapEvents,resolvePoolQuoteAsset,preserveRpcTradeEvidence}=require('../lib/solana-pool-trades');
const {hasVerifiedSwapInstruction,KNOWN_SWAP_PROGRAM_IDS}=require('../lib/wallet-transaction-evidence');
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
test('pool RPC uses parsed transactions to retain token owners when a swap has multiple signers',()=>{
 const tx={slot:20,blockTime:1795720000,
  transaction:{message:{accountKeys:[{pubkey:wallet,signer:true},{pubkey:'FeePayer111111111111111111111111111111111',signer:true}],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},
  meta:{err:null,preTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'10',amount:'10000000',decimals:6}}],
   postTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'35',amount:'35000000',decimals:6}}]}};
 const rows=extractPoolSwapEvents(tx,mint,{signature:'multi-signer-parsed'});
 assert.equal(rows.length,1);
 assert.equal(rows[0].wallet,wallet);
 assert.equal(rows[0].direction,'buy');
 const compact={...tx,meta:{...tx.meta,
  preTokenBalances:[{mint,uiTokenAmount:{uiAmountString:'10',amount:'10000000',decimals:6}}],
  postTokenBalances:[{mint,uiTokenAmount:{uiAmountString:'35',amount:'35000000',decimals:6}}]}};
 assert.deepEqual(extractPoolSwapEvents(compact,mint,{signature:'multi-signer-compact'}),[],
  'without owner fields, a multi-signer transaction must not be attributed to an arbitrary signer');
});
test('verified DEX program IDs cover Raydium, Orca, Meteora and launchpad swaps',()=>{
 const cases=[
  ['CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C','Swap'],
  ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK','Swap'],
  ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc','Swap'],
  ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo','Swap'],
  ['cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG','Swap'],
  ['dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN','Swap'],
  ['LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj','Swap'],
  ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA','BuyExactQuoteIn']
 ];
 for(const [programId,instruction] of cases){
  assert.ok(KNOWN_SWAP_PROGRAM_IDS.has(programId),programId+' must be in the verified DEX allowlist');
  const tx={transaction:{message:{accountKeys:[programId],instructions:[{programIdIndex:0}]}},meta:{logMessages:['Program log: Instruction: '+instruction]}};
  assert.equal(hasVerifiedSwapInstruction(tx),true,programId+' '+instruction);
 }
});
test('Pump.fun AMM parsed buy and sell variants are recognized without log-message fallback',()=>{
 const programId='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
 for(const type of ['buy_exact_quote_in','sell_exact_base_in']){
  const tx={transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'pump_amm',programId,parsed:{type}}]}},meta:{logMessages:[]}};
  assert.equal(hasVerifiedSwapInstruction(tx),true,type+' must be recognized from the parsed Pump.fun AMM instruction');
 }
 const unknown={transaction:{message:{instructions:[{program:'unknown_program',parsed:{type:'buy_exact_quote_in'}}]}},meta:{logMessages:[]}};
 assert.equal(hasVerifiedSwapInstruction(unknown),false,'a buy-shaped instruction from an unknown program must not count as a verified DEX swap');
});

test('Pump.fun AMM buy_exact_quote_in produces a signer-owned confirmed token event without logs',()=>{
 const now=Math.floor(Date.now()/1000);
 const tx={
  slot:474910548,blockTime:now,
  transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'pump_amm',programId:'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',parsed:{type:'buy_exact_quote_in'}}]}},
  meta:{err:null,preTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'10',amount:'10000000',decimals:6}}],
   postTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'17',amount:'17000000',decimals:6}}],logMessages:[]}
 };
 const rows=extractPoolSwapEvents(tx,mint,{signature:'pump-amm-buy'});
 assert.equal(rows.length,1);
 assert.equal(rows[0].wallet,wallet);
 assert.equal(rows[0].direction,'buy');
 assert.equal(rows[0].tokenAmount,7);
 assert.equal(rows[0].source,'helius_pool_rpc');
});

test('parsed PumpSwap buy/sell instructions count only under a recognized DEX program',()=>{
 const valid={transaction:{message:{instructions:[{program:'pump_swap',parsed:{type:'buy'}}]}},meta:{logMessages:[]}};
 const invalid={transaction:{message:{instructions:[{program:'unknown_program',parsed:{type:'buy'}}]}},meta:{logMessages:[]}};
 assert.equal(hasVerifiedSwapInstruction(valid),true);
 assert.equal(hasVerifiedSwapInstruction(invalid),false);
});
test('unknown programs and non-swap logs are never accepted as verified swaps',()=>{
 const unknown={transaction:{message:{accountKeys:['UnknownProgram111111111111111111111111111111'],instructions:[{programIdIndex:0}]}},meta:{logMessages:['Program log: Instruction: BuyExactQuoteIn']}};
 const knownButNotSwap={transaction:{message:{accountKeys:['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'],instructions:[{programIdIndex:0}]}},meta:{logMessages:['Program log: Instruction: Deposit'] }};
 assert.equal(hasVerifiedSwapInstruction(unknown),false);
 assert.equal(hasVerifiedSwapInstruction(knownButNotSwap),false);
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
 assert.equal(result.confirmedSwapsByPoolSum,4);
 assert.equal(result.uniqueBuyersByPool,3);
 assert.equal(result.pendingTransactions,1);
 assert.equal(result.failedTransactionsLastBatch,1);
 assert.equal(result.poolsWithGaps,1);
 assert.equal(result.topPools[0].mint,'mint-a');
 assert.equal(result.topPools[1].buyVolumeUsd,null,'unknown USD volume must stay null, not become zero');
 assert.equal(result.topPools[1].confirmedSwaps,0);
});
test('confirmed swap summary counts unique wallets once and leaves unknown USD volume null',()=>{
 const base=Date.now()-3000;
 const rows=[{wallet:'a',direction:'buy',signature:'1',at:new Date(base).toISOString(),volumeUsd:null},{wallet:'a',direction:'buy',signature:'2',at:new Date(base+1000).toISOString(),volumeUsd:null},{wallet:'b',direction:'sell',signature:'3',at:new Date(base+2000).toISOString(),volumeUsd:null}];
 const summary=summarizePoolSwapEvents(rows);
 assert.equal(summary.tradeCount,3);assert.equal(summary.uniqueBuyers,1);assert.equal(summary.uniqueSellers,1);assert.equal(summary.buyVolumeUsd,null);assert.equal(summary.volumeCoverage,0);
 const stale=summarizePoolSwapEvents([{wallet:'old',direction:'buy',at:new Date(Date.now()-16*60_000).toISOString(),volumeUsd:10}]);
 assert.equal(stale.tradeCount,0,'old RPC swaps must not keep demand fresh');
});

test('quote-asset resolver prices stablecoin and wrapped-SOL pool quotes without guessing unknown assets',()=>{
 const wsol='So11111111111111111111111111111111111111112';
 const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
 const usdt='Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
 assert.deepEqual(resolvePoolQuoteAsset({baseToken:{address:mint},quoteToken:{address:usdc},priceUsd:'0.01',priceNative:'0.01'},mint),{mint:usdc,usdPrice:1,source:'stablecoin_peg'});
 assert.equal(resolvePoolQuoteAsset({baseToken:{address:mint},quoteToken:{address:usdt}},mint).usdPrice,1);
 const native=resolvePoolQuoteAsset({baseToken:{address:mint},quoteToken:{address:wsol},priceUsd:'0.005',priceNative:'0.00005'},mint);
 assert.equal(native.mint,wsol);assert.equal(native.usdPrice,100);
 const quoteSide=resolvePoolQuoteAsset({baseToken:{address:wsol},quoteToken:{address:mint},priceUsd:'100',priceNative:'1'},mint);
 assert.equal(quoteSide.mint,wsol);assert.equal(quoteSide.usdPrice,100);
 const unknown=resolvePoolQuoteAsset({baseToken:{address:mint},quoteToken:{address:'UnknownQuote11111111111111111111111111111'},priceUsd:'0.01',priceNative:'1'},mint);
 assert.equal(unknown.usdPrice,null,'unknown quote assets must not be assigned a fabricated USD price');
});

test('verified RPC buy volume is derived from the signer stablecoin balance delta',()=>{
 const now=Math.floor(Date.now()/1000),usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
 const tx={slot:30,blockTime:now,transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},
  meta:{err:null,preTokenBalances:[
   {mint,owner:wallet,uiTokenAmount:{uiAmountString:'10',amount:'10000000',decimals:6}},
   {mint:usdc,owner:wallet,uiTokenAmount:{uiAmountString:'100',amount:'100000000',decimals:6}}
  ],postTokenBalances:[
   {mint,owner:wallet,uiTokenAmount:{uiAmountString:'35',amount:'35000000',decimals:6}},
   {mint:usdc,owner:wallet,uiTokenAmount:{uiAmountString:'90',amount:'90000000',decimals:6}}
  ]}};
 const rows=extractPoolSwapEvents(tx,mint,{signature:'rpc-usdc-buy',quoteMint:usdc,quoteUsdPrice:1});
 assert.equal(rows.length,1);assert.equal(rows[0].direction,'buy');
 assert.equal(rows[0].volumeUsd,10);assert.equal(rows[0].volumeSource,'rpc_quote_balance_delta');
 const summary=summarizePoolSwapEvents(rows,new Date(now*1000).toISOString());
 assert.equal(summary.tradeCount,1);assert.equal(summary.volumeCoverage,100);assert.equal(summary.buyVolumeUsd,10);
});

test('verified RPC sell volume uses the opposite quote balance delta and wrapped-SOL USD price',()=>{
 const now=Math.floor(Date.now()/1000),wsol='So11111111111111111111111111111111111111112';
 const tx={slot:31,blockTime:now,transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},
  meta:{err:null,preTokenBalances:[
   {mint,owner:wallet,uiTokenAmount:{uiAmountString:'35',amount:'35000000',decimals:6}},
   {mint:wsol,owner:wallet,uiTokenAmount:{uiAmountString:'2',amount:'2000000000',decimals:9}}
  ],postTokenBalances:[
   {mint,owner:wallet,uiTokenAmount:{uiAmountString:'25',amount:'25000000',decimals:6}},
   {mint:wsol,owner:wallet,uiTokenAmount:{uiAmountString:'2.1',amount:'2100000000',decimals:9}}
  ]}};
 const rows=extractPoolSwapEvents(tx,mint,{signature:'rpc-wsol-sell',quoteMint:wsol,quoteUsdPrice:100});
 assert.equal(rows.length,1);assert.equal(rows[0].direction,'sell');
 assert.equal(rows[0].volumeUsd,10);assert.equal(rows[0].volumeSource,'rpc_quote_balance_delta');
});

test('RPC quote volume is not inferred when quote flow direction contradicts the token swap',()=>{
 const now=Math.floor(Date.now()/1000),usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
 const tx={blockTime:now,transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},
  meta:{err:null,preTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'1',amount:'1000000',decimals:6}},{mint:usdc,owner:wallet,uiTokenAmount:{uiAmountString:'10',amount:'10000000',decimals:6}}],
   postTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'2',amount:'2000000',decimals:6}},{mint:usdc,owner:wallet,uiTokenAmount:{uiAmountString:'20',amount:'20000000',decimals:6}}]}}
 const rows=extractPoolSwapEvents(tx,mint,{signature:'wrong-flow',quoteMint:usdc,quoteUsdPrice:1});
 assert.equal(rows.length,1);assert.equal(rows[0].direction,'buy');assert.equal(rows[0].volumeUsd,null);
});
