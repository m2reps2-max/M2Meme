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
