'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeState}=require('../lib/state-normalizer');

test('malformed top-level JSON fields are normalized without losing valid token data',()=>{
 const state=normalizeState({
  version:2,
  tokens:{mintA:{symbol:'AAA',sources:['dex'],history:[{at:1,priceUsd:1},null],forecasts:'bad',smartMoney:{hits:'2',wallets:['walletA',null]},volume:null,txns:[]},broken:null},
  alerts:{},watchlist:['mintA',null,'mintA'],wallets:[null,{address:'walletA'},{}],autoWallets:'bad',
  walletTrades:[null,{wallet:'walletA',mint:'mintA'}],walletActivity:[],walletCursors:null,
  walletLatestCursors:{},walletPendingSignatures:{walletA:[{signature:'sig'},null]},walletMonitoringGaps:null,sources:[]
 });
 assert.equal(state.version,3);
 assert.equal(state.tokens.mintA.symbol,'AAA');
 assert.deepEqual(state.tokens.mintA.history,[{at:1,priceUsd:1}]);
 assert.deepEqual(state.tokens.mintA.forecasts,[]);
 assert.equal(state.tokens.mintA.smartMoney.hits,2);
 assert.deepEqual(state.tokens.mintA.smartMoney.wallets,['walletA']);
 assert.deepEqual(state.alerts,[]);
 assert.deepEqual(state.watchlist,['mintA']);
 assert.deepEqual(state.wallets,[{address:'walletA'}]);
 assert.deepEqual(state.autoWallets,[]);
 assert.equal(state.walletTrades.length,1);
 assert.deepEqual(state.walletPendingSignatures.walletA,[{signature:'sig'}]);
 assert.deepEqual(state.sources,{});
});

test('valid unknown token fields survive migration',()=>{
 const state=normalizeState({version:1,tokens:{mintA:{mint:'mintA',symbol:'AAA',customEvidence:{score:7}}}});
 assert.deepEqual(state.tokens.mintA.customEvidence,{score:7});
});

test('global forecast retention is bounded across all tracked tokens',()=>{
 const {limitForecastHistory}=require('../lib/state-normalizer');
 const tokens={a:{forecasts:Array.from({length:5},(_,i)=>({at:i}))},b:{forecasts:Array.from({length:5},(_,i)=>({at:i}))},c:{forecasts:Array.from({length:5},(_,i)=>({at:i}))}};
 assert.equal(limitForecastHistory(tokens,6),6);
 assert.deepEqual(Object.values(tokens).map(x=>x.forecasts.length),[2,2,2]);
});

test('mutating normalization reuses token objects and the token map to avoid startup duplication',()=>{
 const token={symbol:'AAA',sources:['dex',null],history:[{at:1},null],forecasts:[{at:1},null],smartMoney:{hits:'2',wallets:['walletA',null]}};
 const tokens={mintA:token};
 const input={version:3,tokens,alerts:[],watchlist:[],wallets:[],autoWallets:[],walletTrades:[],walletActivity:{},walletCursors:{},walletLatestCursors:{},walletPendingSignatures:{},walletMonitoringGaps:{},sources:{}};
 const state=normalizeState(input,{mutate:true});
 assert.equal(state,input);
 assert.equal(state.tokens,tokens);
 assert.equal(state.tokens.mintA,token);
 assert.deepEqual(token.sources,['dex']);
 assert.deepEqual(token.history,[{at:1}]);
 assert.deepEqual(token.forecasts,[{at:1}]);
 assert.deepEqual(token.smartMoney.wallets,['walletA']);
});

test('mutating normalization restores missing defaults without replacing existing values',()=>{
 const input={tokens:{},lastScanAt:'2026-11-22T00:00:00.000Z'};
 const state=normalizeState(input,{mutate:true});
 assert.equal(state,input);
 assert.equal(state.lastScanAt,'2026-11-22T00:00:00.000Z');
 assert.deepEqual(state.alerts,[]);
 assert.deepEqual(state.walletTrades,[]);
 assert.equal(state.version,3);
});


test('normalizer can preserve every token when the disk archive is unavailable',()=>{
 const tokens=Object.fromEntries(Array.from({length:1205},(_,i)=>['mint'+i,{mint:'mint'+i,updatedAt:new Date(1205-i).toISOString()}]));
 const bounded=normalizeState({tokens});
 assert.equal(Object.keys(bounded.tokens).length,1200);
 const fallback=normalizeState({tokens},{maxTokens:Infinity});
 assert.equal(Object.keys(fallback.tokens).length,1205);
});

test('launchpad discovery cursors and pending transaction queues are bounded and sanitized',()=>{
 const {normalizeLaunchpadDiscovery}=require('../lib/state-normalizer');
 const state=normalizeLaunchpadDiscovery({
  nextProgram:-3,
  cursors:{'raydium-launchlab':'valid-signature','../bad':'x'},
  pending:{'raydium-launchlab':[{signature:'sig-1',slot:'123',attempts:9},null,{signature:'',attempts:0}],'../bad':[{signature:'ignored'}]},
  metrics:{launches:'4',processed:-2,gaps:'3',errors:'1'}
 });
 assert.equal(state.nextProgram,0);
 assert.deepEqual(state.cursors,{'raydium-launchlab':'valid-signature'});
 assert.deepEqual(state.pending['raydium-launchlab'],[{signature:'sig-1',slot:123,attempts:3}]);
 assert.deepEqual(state.metrics,{launches:4,processed:0,gaps:3,errors:1});
});
