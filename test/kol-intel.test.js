'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeLeaderboard,normalizeTrades,normalizeKOLPnl,mergeLeaderboard,mergeTrades,portfolioFor,buildTokenSignals,buildExpertSnapshot,MadeOnSolRadar}=require('../lib/kol-intel');
const walletA='CyaE1Vxv111111111111111111111111111111111111';
const walletB='FixmSpsB111111111111111111111111111111111111';
const mint='tca3tbFf111111111111111111111111111111111111';

test('KOL PnL endpoint normalizes realized results and closed positions',()=>{
 const pnl=normalizeKOLPnl({period:'30d',summary:{realized_pnl_sol:12.5,win_rate:0.625,profit_factor:1.8,max_drawdown_sol:3.2,avg_roi_pct:18,avg_hold_minutes:45,win_count:10,loss_count:6},closed_positions:[{token_mint:mint,token_symbol:'COIN',pnl_sol:2.4,roi_pct:120,hold_minutes:32,result:'win'}],open_positions:[{token_mint:mint,token_name:'Coin',token_symbol:'COIN',buy_count:3,bought_sol:2.1,held_value_sol:3.4,unrealized_pnl_sol:1.3,is_priced:true,first_buy_at:'2026-11-21T10:00:00Z'}]});
 assert.equal(pnl.realizedPnlSol,12.5);assert.equal(pnl.winRatePct,62.5);assert.equal(pnl.closedPositions[0].symbol,'COIN');assert.equal(pnl.openPositions[0].heldValueSol,3.4);assert.equal(pnl.openPositions[0].isPriced,true);
});

test('leaderboard rejects shortened addresses and keeps separate ranking evidence',()=>{
 const rows=normalizeLeaderboard({period:'7d',leaderboard:[{wallet:walletA,name:'Cented',pnl:12,win_rate:60,percentile_early_entry_30d:82},{wallet:'CyaE...ga54o',name:'truncated'}]},'pnl');
 assert.equal(rows.length,1);assert.equal(rows[0].wallet,walletA);assert.equal(rows[0].pnlSol,12);
 const state={experts:[]};mergeLeaderboard(state,rows,'pnl','2026-11-22T00:00:00.000Z');
 mergeLeaderboard(state,[{...rows[0],rank:2,earlyEntryPct:90}],'early_entry_pct','2026-11-22T00:01:00.000Z');
 assert.equal(state.experts.length,1);assert.equal(state.experts[0].rankings.pnl.rank,1);assert.equal(state.experts[0].rankings.early_entry_pct.rank,2);
 mergeLeaderboard(state,[], 'pnl','2026-11-23T00:00:00.000Z');
 assert.equal(state.experts[0].rankings.pnl,undefined);
});

test('trade feed validates events and normalizes time and trade amounts',()=>{
 const rows=normalizeTrades({trades:[
  {wallet_address:walletA,token_mint:mint,action:'buy',sol_amount:2,token_amount:1000,price_usd_at_trade:0.002,tx_signature:'sig-a',traded_at:'2026-11-22T00:00:00Z',kol_name:'Cented'},
  {wallet_address:'short',token_mint:mint,action:'buy',sol_amount:2,token_amount:1000,traded_at:'2026-11-22T00:00:00Z'},
  {wallet_address:walletA,token_mint:mint,action:'transfer',sol_amount:2,token_amount:1000,traded_at:'2026-11-22T00:00:00Z'}
 ]});
 assert.equal(rows.length,1);assert.equal(rows[0].action,'buy');assert.equal(rows[0].solAmount,2);
});

test('feed merge deduplicates signatures and stores only ranked expert wallets',()=>{
 const state={experts:[{wallet:walletA,name:'Cented'}],expertTrades:[]};
 const row=normalizeTrades({trades:[{wallet_address:walletA,token_mint:mint,action:'buy',sol_amount:1,token_amount:500,tx_signature:'same',traded_at:'2026-11-22T00:00:00Z'}]})[0];
 assert.equal(mergeTrades(state,[row,row]).added,1);assert.equal(mergeTrades(state,[row]).added,0);assert.equal(state.expertTrades.length,1);
 const outsider={...row,id:'other',wallet:walletB};assert.equal(mergeTrades(state,[outsider]).added,0);
});

test('observed portfolio estimates average-cost exits and marks coverage incomplete',()=>{
 const events=[
  {wallet:walletA,mint,action:'buy',solAmount:2,tokenAmount:1000,priceUsd:0.002,at:'2026-11-22T00:00:00Z',name:'Coin',symbol:'COIN'},
  {wallet:walletA,mint,action:'buy',solAmount:2,tokenAmount:1000,priceUsd:0.004,at:'2026-11-22T00:01:00Z'},
  {wallet:walletA,mint,action:'sell',solAmount:3,tokenAmount:1000,priceUsd:0.003,at:'2026-11-22T00:02:00Z'}
 ];
 const result=portfolioFor({wallet:walletA},events,{[mint]:{priceUsd:0.006,name:'Coin',symbol:'COIN'}});
 assert.equal(result.openPositionCount,1);assert.equal(result.openPositions[0].quantity,1000);
 assert.equal(result.openPositions[0].averageEntryUsd,0.003);assert.equal(result.openPositions[0].unrealizedPct,100);
 assert.equal(result.observedRealizedPnlSol,1);assert.equal(result.historyComplete,false);
});

test('portfolio does not invent current prices or treat unmatched sells as profit',()=>{
 const result=portfolioFor({wallet:walletA},[
  {wallet:walletA,mint,action:'sell',solAmount:1,tokenAmount:100,priceUsd:null,at:'2026-11-22T00:00:00Z'}
 ],{});
 assert.equal(result.openPositionCount,0);assert.equal(result.observedRealizedPnlSol,null);assert.equal(result.unmatchedSells,1);
});


test('leaderboard keeps provider win-rate percentages and average ROI field',()=>{
 const rows=normalizeLeaderboard({leaderboard:[{wallet:walletA,name:'Cented',win_rate:62.5,avg_roi:18.4}]});
 assert.equal(rows[0].winRatePct,62.5);assert.equal(rows[0].avgRoiPct,18.4);
});

test('token-level KOL signal counts distinct buyers and net flow over six hours',()=>{
 const state={experts:[{wallet:walletA,name:'Cented',winRatePct:62.5},{wallet:walletB,name:'Marcell',winRatePct:55}],expertTrades:[
  {wallet:walletA,mint,action:'buy',solAmount:2,at:'2026-11-22T00:00:00.000Z'},
  {wallet:walletB,mint,action:'buy',solAmount:1,at:'2026-11-22T00:01:00.000Z'},
  {wallet:walletA,mint,action:'sell',solAmount:.5,at:'2026-11-22T00:02:00.000Z'}
 ]};
 const signals=buildTokenSignals(state,Date.parse('2026-11-22T00:03:00.000Z'));
 assert.equal(signals[mint].uniqueBuyers,2);assert.equal(signals[mint].netSol,2.5);assert.equal(signals[mint].signal,'multi_kol_interest');
});

test('provider errors trigger a 30-minute cooldown instead of burning the free quota',async()=>{
 let now=Date.parse('2026-11-22T00:00:00Z'),calls=0;
 const fetchImpl=async()=>{calls++;return {ok:false,status:429,statusText:'Too Many Requests',text:async()=>JSON.stringify({error:'rate limited'})};};
 const state={sources:{},experts:[],expertTrades:[]};
 const radar=new MadeOnSolRadar({state,apiKey:'msk_test_key',fetchImpl,now:()=>now});
 await radar.refresh();const firstCalls=calls;assert.equal(firstCalls,3);
 now+=5*60*1000;await radar.refresh();assert.equal(calls,firstCalls);
 now+=26*60*1000;await radar.refresh();assert.equal(calls,firstCalls+3);
});

test('MadeOnSol poller stays inert without an API key',async()=>{
 const state={sources:{}};const radar=new MadeOnSolRadar({state,apiKey:''});
 const result=await radar.refresh();assert.equal(result.configured,false);assert.equal(state.sources.madeOnSol.connected,false);
});

test('MadeOnSol poller respects the free-tier 30-minute profile budget',async()=>{
 let now=Date.parse('2026-11-22T00:00:00Z');const calls=[];
 const response=(data)=>({ok:true,status:200,statusText:'OK',text:async()=>JSON.stringify(data)});
 const fetchImpl=async(url)=>{calls.push(url);if(url.includes('/kol/leaderboard'))return response({period:'7d',leaderboard:[{wallet:walletA,name:'Cented',pnl:5,rank:1,percentile_early_entry_30d:80},{wallet:walletB,name:'Marcell',pnl:4,rank:2}]});if(url.includes('/kol/feed'))return response({trades:[{wallet_address:walletA,token_mint:mint,action:'buy',sol_amount:1,token_amount:100,tx_signature:'feed-sig',traded_at:'2026-11-22T00:00:00Z',kol_name:'Cented'}]});return response({kol:{name:'Cented'},summary:{realized_pnl_sol:2,win_rate:.6,profit_factor:1.5,max_drawdown_sol:1},open_positions:[],closed_positions:[]});};
 const state={sources:{},experts:[],expertTrades:[]};
 const radar=new MadeOnSolRadar({state,apiKey:'msk_test_key',fetchImpl,now:()=>now});
 const first=await radar.refresh();assert.equal(first.successful,4);assert.equal(state.experts.length,2);assert.equal(state.expertTrades.length,1);assert.equal(calls.length,4);
 now+=5*60*1000;await radar.refresh();assert.equal(calls.length,4);
 now+=10*60*1000;await radar.refresh();assert.equal(calls.length,5);
 now+=15*60*1000;await radar.refresh();assert.equal(calls.length,7);
});
