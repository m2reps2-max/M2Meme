'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {backtest,creatorFundingClusters}=require('../lib/intelligence');

test('backtest limits each horizon to a nearby observation and measures excursions',()=>{
 const history=[
  {at:1000,priceUsd:1,score:82,coverage:90},
  {at:31000,priceUsd:1.2,score:80,coverage:90},
  {at:61000,priceUsd:.9,score:78,coverage:90},
  {at:4000000,priceUsd:1.5,score:75,coverage:90}
 ];
 const result=backtest.call({state:{tokens:{mint:{mint:'mint',symbol:'TEST',history}}}});
 const first=result.recent.find(x=>x.at===new Date(1000).toISOString());
 assert.equal(first.outcomes['1m'].returnPct,-10);
 assert.equal(first.outcomes['1m'].maxFavorablePct,20);
 assert.equal(first.outcomes['1m'].maxAdversePct,-10);
 assert.equal(first.outcomes['5m'],undefined);
});

test('wallet intelligence uses nearby price snapshots instead of unrelated forecasts',()=>{
 const eventAt=1_000_000;
 const address='Wallet111111111111111111111111111111111111';
 const mint='Mint111111111111111111111111111111111111111';
 const state={
  wallets:[{address,label:'Test wallet'}],
  walletTrades:[{wallet:address,mint,direction:'buy',at:new Date(eventAt).toISOString()}],
  walletActivity:{},
  tokens:{[mint]:{mint,symbol:'TEST',history:[
   {at:eventAt-30000,priceUsd:1},
   {at:eventAt+3600000,priceUsd:1.2}
  ]}}
 };
 const result= require('../lib/intelligence').walletIntel.call({state});
 assert.equal(result.wallets[0].performance.matchedBuys,1);
 assert.equal(result.wallets[0].performance.average1hReturnPct,20);
 assert.equal(result.wallets[0].performance.winRatePct,100);
});

test('wallet intelligence does not invent a result when the one-hour snapshot is missing',()=>{
 const eventAt=2_000_000;
 const address='Wallet222222222222222222222222222222222222';
 const mint='Mint222222222222222222222222222222222222';
 const state={
  wallets:[{address}],
  walletTrades:[{wallet:address,mint,direction:'buy',at:new Date(eventAt).toISOString()}],
  walletActivity:{},
  tokens:{[mint]:{mint,history:[{at:eventAt,priceUsd:1},{at:eventAt+1800000,priceUsd:1.5}]}}
 };
 const result=require('../lib/intelligence').walletIntel.call({state});
 assert.equal(result.wallets[0].performance.matchedBuys,0);
 assert.equal(result.wallets[0].performance.average1hReturnPct,null);
});

test('creator intelligence distinguishes launch-event wallets from metadata proxies',()=>{
 const creator='CreatorWallet111111111111111111111111111111';
 const metadata='MetadataWallet11111111111111111111111111111';
 const authority='MintAuthority1111111111111111111111111111';
 const state={tokens:{
  a:{mint:'a',creator:metadata,security:{data:{mintAuthority:authority}}},
  b:{mint:'b',creator,creatorObservedAtLaunch:true},
  c:{mint:'c',security:{data:{freezeAuthority:authority}}}
 }};
 const groups=require('../lib/intelligence').creatorIntel.call({state});
 const real=groups.find(x=>x.address===creator);
 const proxy=groups.find(x=>x.address===authority);
 assert.equal(real.attribution,'creator_wallet_from_launch_event');
 assert.equal(real.tokenCount,1);
 assert.equal(proxy.attribution,'authority_onchain_proxy');
 assert.equal(proxy.tokenCount,2);
 assert.equal(groups.some(x=>x.address===metadata),false);
});

test('creator funding clusters only group distinct launch-event creators sharing a funder',()=>{
 const result=creatorFundingClusters.call({state:{tokens:{
  a:{mint:'a',creator:'Creator11111111111111111111111111111',creatorObservedAtLaunch:true,creatorFunding:{funder:'Funder11111111111111111111111111111',sol:0.2}},
  b:{mint:'b',creator:'Creator22222222222222222222222222222',creatorObservedAtLaunch:true,creatorFunding:{funder:'Funder11111111111111111111111111111',sol:0.3}},
  c:{mint:'c',creator:'Creator33333333333333333333333333333',creatorObservedAtLaunch:false,creatorFunding:{funder:'Funder11111111111111111111111111111',sol:0.4}}
 }}});
 assert.equal(result.length,1);
 assert.equal(result[0].creatorCount,2);
 assert.equal(result[0].tokenCount,2);
 assert.equal(result[0].totalFundingSol,0.5);
});
