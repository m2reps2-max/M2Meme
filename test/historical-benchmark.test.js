'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {replayHistoricalCandles,getHistoricalBenchmark,resolveSearchMint,DOCUMENTED_CASE_STUDIES}=require('../lib/historical-benchmark');

test('historical replay reports terminal return and peak-to-trough drawdown',()=>{
 const base=Date.UTC(2026,0,1)/1000;
 const candles=[];
 for(let i=0;i<12;i++){
  const close=i<8?1+i*.1:i===8?2:1.1;
  candles.push([base+i*86400,close,close*1.1,close*.8,close,1000+i*100]);
 }
 const result=replayHistoricalCandles({symbol:'TEST',name:'Test',mint:null},candles);
 assert.ok(result.maxUpsidePct>0);
 assert.ok(result.maxDrawdownPct<0);
 assert.ok(Number.isFinite(result.terminalReturnPct));
 assert.ok(Number.isFinite(result.terminalDrawdownFromPeakPct));
});

test('historical cohorts expose winner and drawdown groups without hiding incomplete samples',()=>{
 const result=getHistoricalBenchmark.call({state:{historicalBenchmarks:{
  BONK:{symbol:'BONK',cohort:'cycle_winner',completed:true,terminalReturnPct:100,maxDrawdownPct:-30,signalCount:5,alertCount:2},
  CHILLGUY:{symbol:'CHILLGUY',cohort:'boom_bust',completed:true,terminalReturnPct:-70,maxDrawdownPct:-85,signalCount:4,alertCount:1}
 }}});
 assert.equal(result.completed,2);
 assert.ok(result.cohortSummary.cycle_winner.tokens>=1);
 assert.equal(result.cohortSummary.boom_bust.averageTerminalReturnPct,-70);
 assert.ok(result.total>result.completed);
 assert.match(result.limitations,/biais de survivance/i);
});

test('historical replay evaluates alerts at fixed 1d, 3d and 7d horizons without lookahead',()=>{
 const base=Date.UTC(2026,0,1)/1000;
 const candles=[];
 const closes=[1,1,1,1,1,1,1,1,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.5,1.6];
 for(let i=0;i<closes.length;i++)candles.push([base+i*86400,closes[i],closes[i]*1.05,closes[i]*.95,closes[i],i<8?100:10000]);
 const result=replayHistoricalCandles({symbol:'TEST',name:'Test'},candles);
 assert.ok(result.historicalSignalPerformance);
 assert.ok(result.historicalSignalPerformance['1d'].alerts.signals>0);
 assert.ok(result.historicalSignalPerformance['3d'].alerts.signals>0);
 assert.ok(result.historicalSignalPerformance['7d'].alerts.signals>0);
 assert.equal(result.signals[0].return1dForwardPct,10);
 assert.equal(result.signals[0].return3dForwardPct,20);
 assert.equal(result.signals[0].return7dForwardPct,40);
 assert.equal(result.signals.at(-1).return7dForwardPct,null);
 assert.ok(result.historicalSignalRisk.alertsWith7dPath>0);
});
test('benchmark token resolution requires exact token metadata and never matches symbol substrings',()=>{
 const payload={data:[
  {attributes:{reserve_in_usd:'999999'},relationships:{base_token:{data:{id:'solana_wrong'}},quote_token:{data:{id:'solana_quote'}}}},
  {attributes:{reserve_in_usd:'1000'},relationships:{base_token:{data:{id:'solana_right'}},quote_token:{data:{id:'solana_sol'}}}}
 ],included:[
  {id:'solana_wrong',attributes:{address:'Wrong11111111111111111111111111111111111',symbol:'NOTBONK',name:'Not Bonk'}},
  {id:'solana_quote',attributes:{address:'Quote1111111111111111111111111111111111',symbol:'SOL',name:'Solana'}},
  {id:'solana_right',attributes:{address:'Right1111111111111111111111111111111111',symbol:'BONK',name:'Bonk'}},
  {id:'solana_sol',attributes:{address:'So11111111111111111111111111111111111111112',symbol:'SOL',name:'Solana'}}
 ]};
 const resolved=resolveSearchMint(payload,{symbol:'BONK',name:'Bonk'});
 assert.equal(resolved.mint,'Right1111111111111111111111111111111111');
 assert.equal(resolveSearchMint(payload,{symbol:'BON',name:'Bon'}),null);
});

test('documented rug case studies are sourced and never counted as quantitative OHLCV replays',()=>{
 assert.equal(DOCUMENTED_CASE_STUDIES.length,2);
 const shar=DOCUMENTED_CASE_STUDIES.find(x=>x.symbol==='SHAR');
 const tws=DOCUMENTED_CASE_STUDIES.find(x=>x.symbol==='TWS');
 assert.equal(shar.reportedDrawdownPct,-96.3);
 assert.equal(shar.quantitativeReplay,false);
 assert.match(shar.evidenceUrl,/decrypt\.co/);
 assert.equal(tws.quantitativeReplay,false);
 assert.match(tws.evidenceUrl,/certik\.com/);
 assert.ok(shar.identityNote.includes('aucune adresse mint'));
});
