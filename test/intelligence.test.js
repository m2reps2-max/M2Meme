'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {backtest,creatorFundingClusters,earlyBuyerExitIntel}=require('../lib/intelligence');

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

test('wallet intelligence includes automatically discovered early buyers with provenance',()=>{
 const address='AutoWallet11111111111111111111111111111111';
 const mint='AutoMint111111111111111111111111111111111';
 const state={
  wallets:[],
  autoWallets:[{address,label:'Acheteur observé',automatic:true,sourceMint:mint,sourceSymbol:'AUTO',discoveredAt:new Date(1000).toISOString()}],
  walletTrades:[],
  walletActivity:{},
  tokens:{[mint]:{mint,symbol:'AUTO',history:[]}}
 };
 const result=require('../lib/intelligence').walletIntel.call({state});
 assert.equal(result.wallets.length,1);
 assert.equal(result.wallets[0].automatic,true);
 assert.equal(result.wallets[0].sourceSymbol,'AUTO');
 assert.equal(result.wallets[0].performance.matchedBuys,0);
});

test('wallet intelligence flags same-slot buying clusters without asserting common ownership',()=>{
 const mint='ClusterMint11111111111111111111111111111111';
 const addresses=['ClusterWalletA11111111111111111111111111','ClusterWalletB11111111111111111111111111','ClusterWalletC11111111111111111111111111'];
 const state={wallets:addresses.map((address,i)=>({address,label:'W'+i})),walletTrades:addresses.map((wallet,i)=>({wallet,mint,direction:'buy',slot:98765,at:new Date(1000000+i*100).toISOString()})),walletActivity:{},tokens:{[mint]:{mint,history:[]}}};
 const result=require('../lib/intelligence').walletIntel.call({state});
 const cluster=result.clusters.find(x=>x.kind==='same_slot');
 assert.equal(cluster.trackedWallets,3);
 assert.match(cluster.warning,/indépendantes|pas preuve/i);
});

test('creator intelligence exposes confirmed swap-like outflow evidence separately from generic outflows',()=>{
 const creator='CreatorSaleWallet111111111111111111111111111';
 const state={tokens:{mint:{mint:'mint',creator,creatorObservedAtLaunch:true,creatorSaleEvents:[{at:'2026-11-22T10:00:00Z',tokenAmount:100,quoteReceived:{asset:'SOL',amount:2},signature:'sig'}],creatorOutflows:[{at:'2026-11-22T10:00:00Z',tokenAmount:120}]}}};
 const result=require('../lib/intelligence').creatorIntel.call({state});
 assert.equal(result[0].creatorSaleCount,1);
 assert.equal(result[0].creatorOutflowCount,1);
 assert.equal(result[0].creatorSwapEvidence[0].quoteReceived.amount,2);
});

test('early buyer exits require multiple wallets and a material observed sell share',()=>{
 const mint='ExitMint1111111111111111111111111111111111';
 const now=Date.parse('2026-11-22T12:00:00Z');
 const trades=[
  {mint,wallet:'BuyerA',role:'early_buyer',direction:'buy',swapConfirmed:true,tokenAmount:100,at:'2026-11-22T11:00:00Z'},
  {mint,wallet:'BuyerB',role:'early_buyer',direction:'buy',swapConfirmed:true,tokenAmount:100,at:'2026-11-22T11:01:00Z'},
  {mint,wallet:'BuyerA',role:'early_buyer',direction:'sell',swapConfirmed:true,tokenAmount:30,at:'2026-11-22T11:50:00Z',quoteReceived:{asset:'SOL',amount:1}},
  {mint,wallet:'BuyerB',role:'early_buyer',direction:'sell',swapConfirmed:true,tokenAmount:25,at:'2026-11-22T11:55:00Z',quoteReceived:{asset:'SOL',amount:1}}
 ];
 const result=earlyBuyerExitIntel(mint,trades,now);
 assert.equal(result.wallets,2);
 assert.equal(result.soldSharePct,27.5);
 assert.equal(result.alert,true);
 assert.equal(result.recentSwapLikeSells,2);
});

test('early buyer exit intelligence ignores unconfirmed transfers and one-wallet exits',()=>{
 const mint='ExitMint2222222222222222222222222222222222';
 const now=Date.parse('2026-11-22T12:00:00Z');
 const trades=[
  {mint,wallet:'BuyerA',role:'early_buyer',direction:'buy',swapConfirmed:true,tokenAmount:100,at:'2026-11-22T11:00:00Z'},
  {mint,wallet:'BuyerA',role:'early_buyer',direction:'sell',swapConfirmed:true,tokenAmount:80,at:'2026-11-22T11:55:00Z'},
  {mint,wallet:'BuyerB',role:'early_buyer',direction:'sell',swapConfirmed:false,tokenAmount:200,at:'2026-11-22T11:56:00Z'}
 ];
 const result=earlyBuyerExitIntel(mint,trades,now);
 assert.equal(result.wallets,1);
 assert.equal(result.alert,false);
 assert.equal(result.recentSwapLikeSells,1);
});
