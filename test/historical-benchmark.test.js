'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {replayHistoricalCandles,getHistoricalBenchmark}=require('../lib/historical-benchmark');

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
