'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchTrendingPools, parseNewPools, resolveNewPoolPageLimit, resolveNewPoolPageSequence, analyzePoolTrades, mergeObservedTrades } = require('../lib/gecko-discovery');

test('GeckoTerminal discovery page limit is configurable but always bounded',()=>{
  assert.equal(resolveNewPoolPageLimit(undefined),4);
  assert.equal(resolveNewPoolPageLimit(''),4);
  assert.equal(resolveNewPoolPageLimit('2'),2);
  assert.equal(resolveNewPoolPageLimit('5'),5);
  assert.equal(resolveNewPoolPageLimit('10'),5);
  assert.equal(resolveNewPoolPageLimit('-3'),1);
  assert.equal(resolveNewPoolPageLimit('invalid'),4);
});

test('GeckoTerminal page sequence rotates through the full bounded window',()=>{
  assert.deepEqual(resolveNewPoolPageSequence(1,4,10),{pages:[1,2,3,4],nextCursor:5,pageWindow:10});
  assert.deepEqual(resolveNewPoolPageSequence(5,4,10),{pages:[5,6,7,8],nextCursor:9,pageWindow:10});
  assert.deepEqual(resolveNewPoolPageSequence(9,4,10),{pages:[9,10,1,2],nextCursor:3,pageWindow:10});
  assert.deepEqual(resolveNewPoolPageSequence(99,4,10),{pages:[9,10,1,2],nextCursor:3,pageWindow:10});
  assert.deepEqual(resolveNewPoolPageSequence(1,50,50),{pages:[1,2,3,4,5],nextCursor:6,pageWindow:10});
  assert.deepEqual(resolveNewPoolPageSequence(1,4,0),{pages:[1,2,3,4],nextCursor:5,pageWindow:10});
});

test('GeckoTerminal trending fetch uses bounded Solana endpoint and duration', async()=>{
  let requested='';
  const payload={data:[],included:[]};
  const result=await fetchTrendingPools({duration:'invalid',page:99,fetchImpl:async(url,options)=>{
    requested=url;
    assert.equal(options.headers.accept,'application/json;version=20230203');
    return {ok:true,json:async()=>payload};
  }});
  assert.deepEqual(result,payload);
  assert.match(requested,/\/networks\/solana\/trending_pools\?duration=1h&page=10/);
  assert.match(requested,/include=base_token,quote_token,dex/);
});

test('GeckoTerminal trending pools preserve their discovery source',()=>{
  const payload={
    data:[{id:'solana_poolTrend',attributes:{address:'PoolTrend111111111111111111111111111111',pool_created_at:'2026-11-22T10:00:00Z'},relationships:{base_token:{data:{id:'solana_tokenTrend'}},quote_token:{data:{id:'solana_So11111111111111111111111111111111111111112'}}}}],
    included:[{id:'solana_tokenTrend',attributes:{address:'TokenTrend111111111111111111111111111111',name:'Trend',symbol:'TRND'}}]
  };
  const rows=parseNewPools(payload,'geckoterminal_trending_pool');
  assert.equal(rows.length,1);
  assert.equal(rows[0].source,'geckoterminal_trending_pool');
});

test('GeckoTerminal new pools resolves Solana base token and market fields', () => {
  const payload = {
    data: [{ id: 'solana_pool123', attributes: { address: 'pool123', pool_created_at: '2026-11-22T10:00:00Z', reserve_in_usd: '25000', base_token_price_usd: '0.01', fdv_usd: '1000000', volume_usd: { h1: '5000', h24: '30000' }, transactions: { h1: { buys: 30, sells: 10 } } }, relationships: { base_token: { data: { id: 'solana_token12345678901234567890123456789012' } }, quote_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } }, dex: { data: { id: 'solana_raydium' } } } }],
    included: [{ id: 'solana_token12345678901234567890123456789012', attributes: { address: 'Token1234567891234567891234567891233', name: 'Test Cat', symbol: 'TCAT' } }, { id: 'solana_raydium', attributes: { name: 'Raydium' } }]
  };
  const rows = parseNewPools(payload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokenAddress, 'Token1234567891234567891234567891233');
  assert.equal(rows[0].dexName, 'Raydium');
  assert.equal(rows[0].liquidityUsd, 25000);
  assert.equal(rows[0].txns.h1.buys, 30);
});

test('GeckoTerminal ignores a pool whose base token is a quote asset', () => {
  const payload = { data: [{ id: 'solana_pool', attributes: {}, relationships: { base_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } }, quote_token: { data: { id: 'solana_AnotherToken11111111111111111111111111' } } } }], included: [{ id: 'solana_AnotherToken11111111111111111111111111', attributes: { address: 'AnotherToken11111111111111111111111111', name: 'Other', symbol: 'OTH' } }] };
  const rows = parseNewPools(payload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokenAddress, 'AnotherToken11111111111111111111111111');
});

test('trade intelligence flags same-block bursts and reports early buyer coverage', () => {
  const created = '2026-11-22T10:00:00.000Z';
  const rows = [
    ['walletA', 'buy', '10:00:01.000Z', 100, 123],
    ['walletB', 'buy', '10:00:02.000Z', 100, 123],
    ['walletC', 'buy', '10:00:03.000Z', 100, 123],
    ['walletD', 'buy', '10:00:04.000Z', 100, 124],
    ['walletE', 'buy', '10:00:05.000Z', 100, 124],
    ['walletF', 'sell', '10:01:00.000Z', 20, 125],
    ['walletA', 'buy', '10:00:06.000Z', 100, 126],
    ['walletG', 'buy', '10:04:50.000Z', 110, 127]
  ];
  const payload = { data: rows.map(([wallet, kind, time, volume, block], i) => ({ id: 'sig' + i, attributes: { tx_from_address: wallet, kind, block_timestamp: '2026-11-22T' + time, volume_in_usd: String(volume), block_number: block, tx_hash: 'sig' + i } })) };
  const result = analyzePoolTrades(payload, created, Date.parse('2026-11-22T10:10:00.000Z'));
  assert.equal(result.tradeCount, 8);
  assert.equal(result.uniqueBuyers, 6);
  assert.equal(result.sameBlockBuyerClusters, 1);
  assert.equal(result.earlyWindow.complete, true);
  assert.equal(result.earlyWindow.uniqueBuyers, 6);
  assert.equal(result.earlyBuyers[0].wallet, 'walletA');
  assert.equal(result.earlyBuyers[0].buys, 2);
  assert.ok(result.flags.some(x => x.code === 'SAME_BLOCK_BUY_BURST'));
  assert.ok(result.flags.some(x => x.code === 'EARLY_BUYER_BURST'));
});

test('trade analysis returns auditable bundle-like and five-second buyer clusters',()=>{
  const start=Date.parse('2026-11-22T10:00:00.000Z');
  const rows=[
    ['a','buy',0,100,700],['b','buy',350,120,700],['c','buy',800,90,700],
    ['d','buy',1200,80,701],['e','buy',1700,75,702],['f','sell',2200,30,703]
  ];
  const result=analyzePoolTrades({data:rows.map(([wallet,kind,offset,volume,block],i)=>({id:'cluster'+i,attributes:{tx_from_address:wallet,kind,block_timestamp:new Date(start+offset).toISOString(),volume_in_usd:String(volume),block_number:block}}))},new Date(start).toISOString());
  assert.equal(result.bundleCandidates.length,1);
  assert.equal(result.bundleCandidates[0].uniqueBuyers,3);
  assert.ok(result.burstCandidates.some(x=>x.uniqueBuyers>=3));
  assert.ok(result.flags.some(x=>x.code==='BUNDLE_LIKE_BURST'));
});

test('first 70 buyer cohort is only scored when the launch sample is complete',()=>{
 const created=Date.parse('2026-11-22T10:00:00.000Z');
 const rows=[];
 for(let i=0;i<70;i++)rows.push({id:'b'+i,attributes:{tx_from_address:'wallet'+i,kind:'buy',block_timestamp:new Date(created+1000+i*4000).toISOString(),volume_in_usd:'100',block_number:1000+i}});
 for(let i=0;i<30;i++)rows.push({id:'s'+i,attributes:{tx_from_address:'wallet'+i,kind:'sell',block_timestamp:new Date(created+360000+i*1000).toISOString(),volume_in_usd:'100',block_number:2000+i}});
 const result=analyzePoolTrades({data:rows},new Date(created).toISOString(),created+600000);
 assert.equal(result.first70BuyerCohort.observedBuyers,70);
 assert.equal(result.first70BuyerCohort.complete,true);
 assert.equal(result.first70BuyerCohort.mostlyExitedInSample,30);
 assert.equal(result.first70BuyerCohort.retentionPct,57.1);
 assert.equal(result.first70BuyerCohort.wallets.length,70);
 const incomplete=analyzePoolTrades({data:rows.slice(0,20)},new Date(created).toISOString(),created+600000);
 assert.equal(incomplete.first70BuyerCohort.complete,false);
 assert.equal(incomplete.first70BuyerCohort.retentionPct,null);
});

test('pool trade samples are persisted idempotently for wallet graph analysis',()=>{
 const target=[];
 const observed=[
  {wallet:'walletA',direction:'buy',volumeUsd:100,at:'2026-11-22T10:00:00.000Z',slot:123,signature:'sigA'},
  {wallet:'walletB',direction:'sell',volumeUsd:50,at:'2026-11-22T10:00:01.000Z',slot:123,signature:'sigB'}
 ];
 const first=mergeObservedTrades(target,'mintA',observed,5000);
 assert.equal(first.added,2);
 assert.equal(first.rows[0].source,'gecko_pool_sample');
 assert.equal(first.rows[0].role,'gecko_sample');
 assert.equal(first.rows[0].swapConfirmed,false);
 const second=mergeObservedTrades(first.rows,'mintA',observed,5000);
 assert.equal(second.added,0);
 assert.equal(second.rows.length,2);
 const otherMint=mergeObservedTrades(second.rows,'mintB',observed,5000);
 assert.equal(otherMint.added,2);
 assert.equal(otherMint.rows.length,4);
});
test('pool trade persistence enforces a bounded rolling history',()=>{
 const existing=Array.from({length:4},(_,i)=>({wallet:'old'+i,mint:'old',signature:'old'+i,source:'gecko_pool_sample'}));
 const result=mergeObservedTrades(existing,'new',[{wallet:'new',direction:'buy',volumeUsd:1,at:'2026-11-22T10:00:00Z',signature:'new'}],3);
 assert.equal(result.rows.length,3);
 assert.equal(result.rows.at(-1).signature,'new');
});

test('Gecko sample does not duplicate a wallet RPC observation for the same swap',()=>{
 const existing=[{wallet:'walletA',mint:'mintA',signature:'same-sig',at:'2026-11-22T10:00:00Z',direction:'buy',source:'solana_rpc'}];
 const result=mergeObservedTrades(existing,'mintA',[{wallet:'walletA',mint:'mintA',signature:'same-sig',at:'2026-11-22T10:00:00Z',direction:'buy',volumeUsd:10}],5000);
 assert.equal(result.added,0);
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].source,'solana_rpc');
});

test('early buyer window stays incomplete when the five-minute end is not observed',()=>{
 const created='2026-11-22T10:00:00.000Z';
 const payload={data:[['walletA','10:00:01.000Z'],['walletB','10:00:20.000Z']].map(([wallet,time],i)=>({id:'short'+i,attributes:{tx_from_address:wallet,kind:'buy',block_timestamp:'2026-11-22T'+time,volume_in_usd:'200',block_number:800+i}}))};
 const result=analyzePoolTrades(payload,created,Date.parse('2026-11-22T10:10:00.000Z'));
 assert.equal(result.earlyWindow.complete,false);
 assert.equal(result.earlyWindow.reason,'five_minute_window_end_not_observed');
 assert.equal(result.earlyBuyers.length,0);
});

test('early buyer window stays incomplete when the GeckoTerminal sample reaches its 300-trade cap',()=>{
 const created=Date.parse('2026-11-22T10:00:00.000Z');
 const data=Array.from({length:300},(_,i)=>({id:'cap'+i,attributes:{tx_from_address:'walletA',kind:'buy',block_timestamp:new Date(created+(i===299?290000:i*900)).toISOString(),volume_in_usd:'10',block_number:900+i}}));
 const result=analyzePoolTrades({data},new Date(created).toISOString(),created+3600000);
 assert.equal(result.earlyWindow.complete,false);
 assert.equal(result.earlyWindow.reason,'trade_sample_at_api_cap');
 assert.equal(result.earlyBuyers.length,0);
});

test('early buyer window stays incomplete until five minutes have elapsed since pool creation',()=>{
 const created=Date.now()-60000;
 const payload={data:[0,30000,59000].map((offset,i)=>({id:'young'+i,attributes:{tx_from_address:'walletA',kind:'buy',block_timestamp:new Date(created+offset).toISOString(),volume_in_usd:'200',block_number:1000+i}}))};
 const result=analyzePoolTrades(payload,new Date(created).toISOString(),created+60000);
 assert.equal(result.earlyWindow.complete,false);
 assert.equal(result.earlyWindow.reason,'five_minute_window_not_elapsed');
 assert.equal(result.earlyBuyers.length,0);
});

test('GeckoTerminal rejects oversized response bodies before JSON parsing',async()=>{
 const {fetchNewPools}=require('../lib/gecko-discovery');
 const response={ok:true,headers:{get:()=> '100'},body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(100)));controller.close();}})};
 await assert.rejects(()=>fetchNewPools({fetchImpl:async()=>response,maxBytes:32}),/trop volumineuse/);
});
