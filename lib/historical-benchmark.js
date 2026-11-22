'use strict';
const API='https://api.geckoterminal.com/api/v2';
const COINS=[
 {symbol:'BONK',name:'Bonk',mint:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'},
 {symbol:'WIF',name:'dogwifhat',mint:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'},
 {symbol:'POPCAT',name:'Popcat',mint:'7GCihgDB8fe6KNjn2MYtkZcRjQy3t9GHdC8uHYmW2hr'},
 {symbol:'BOME',name:'BOOK OF MEME',mint:'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82'},
 {symbol:'MEW',name:'cat in a dogs world',mint:'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5'},
 {symbol:'TRUMP',name:'Official Trump',mint:'6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'},
 {symbol:'PENGU',name:'Pudgy Penguins',mint:'2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv'}
];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){const r=await fetch(url,{headers:{accept:'application/json;version=20230302'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('GeckoTerminal HTTP '+r.status);return r.json();}
function replay(coin,candles){
 const bars=candles.map(x=>({at:Number(x[0])*1000,open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5])})).filter(x=>x.at&&x.close>0&&Number.isFinite(x.volume)).sort((a,b)=>a.at-b.at);
 const signals=[];
 for(let i=7;i<bars.length;i++){
  const b=bars[i],prior=bars.slice(i-7,i),avgVol=prior.reduce((s,x)=>s+x.volume,0)/prior.length,volRatio=avgVol>0?b.volume/avgVol:0;
  const r3=i>=3?(b.close/bars[i-3].close-1)*100:0,r7=b.close/bars[i-7].close-1;
  const activity=Math.max(0,Math.min(100,Math.log10(1+volRatio)*55));
  const momentum=Math.max(0,Math.min(100,50+r3*3.2+r7*1.6));
  const score=Math.round(activity*.5+momentum*.5);
  const future=bars.slice(i+1),peak=future.reduce((m,x)=>Math.max(m,x.high),b.high),peakIndex=future.findIndex(x=>x.high===peak);
  signals.push({at:new Date(b.at).toISOString(),price:b.close,volumeUsd:b.volume,volumeVsPrevious7d:Number(volRatio.toFixed(2)),return3dPct:Number(r3.toFixed(2)),return7dPct:Number((r7*100).toFixed(2)),activityScore:Math.round(activity),momentumScore:Math.round(momentum),proxyScore:score,alert:score>=65,forwardMaxUpsidePct:Number(((peak/b.close-1)*100).toFixed(1)),daysToForwardPeak:peakIndex<0?null:Math.round((future[peakIndex].at-b.at)/86400000)});
 }
 const alerts=signals.filter(x=>x.alert),first=alerts[0]||null,best=signals.reduce((a,b)=>!a||b.proxyScore>a.proxyScore?b:a,null);
 const period=bars.length?{from:new Date(bars[0].at).toISOString(),to:new Date(bars[bars.length-1].at).toISOString(),candles:bars.length}:null;
 return {symbol:coin.symbol,name:coin.name,mint:coin.mint,poolAddress:null,period,signalCount:signals.length,alertCount:alerts.length,firstAlert:first,bestSignal:best,signals:signals.slice(-180),maxObservedPrice:bars.length?Math.max(...bars.map(x=>x.high)):null};
}
async function runOne(scanner){
 scanner.state.historicalBenchmarks ||= {};
 const existing=Object.keys(scanner.state.historicalBenchmarks);
 const coin=COINS.find(x=>!scanner.state.historicalBenchmarks[x.symbol]?.completed)||COINS[0];
 const old=scanner.state.historicalBenchmarks[coin.symbol];
 if(old?.completed&&Date.now()-Date.parse(old.fetchedAt)<7*86400000)return {done:true,benchmark:old,progress:existing.length,total:COINS.length};
 try{
  const pools=await get(API+'/networks/solana/tokens/'+coin.mint+'/pools?page=1');
  const list=Array.isArray(pools.data)?pools.data:[];
  if(!list.length)throw new Error('Aucun pool indexé par GeckoTerminal pour ce token');
  list.sort((a,b)=>Number(b.attributes?.reserve_in_usd||0)-Number(a.attributes?.reserve_in_usd||0));
  const pool=list[0],poolAddress=pool.attributes?.address;
  if(!poolAddress)throw new Error('Adresse de pool absente');
  await wait(6500);
  const raw=await get(API+'/networks/solana/pools/'+poolAddress+'/ohlcv/day?aggregate=1&limit=180&currency=usd&token=base');
  const candles=raw.data?.attributes?.ohlcv_list||[];
  if(candles.length<10)throw new Error('Historique OHLCV insuffisant ('+candles.length+' bougies)');
  const result=replay(coin,candles);result.poolAddress=poolAddress;result.poolName=pool.attributes?.name||null;result.fetchedAt=new Date().toISOString();result.completed=true;result.source='GeckoTerminal public OHLCV';result.method='Replay journalier proxy : volume relatif sur 7 jours + momentum de prix sur 3/7 jours. Pas de transactions acheteurs/vendeurs, holders, sécurité, wallets ni liquidité historique.';
  scanner.state.historicalBenchmarks[coin.symbol]=result;scanner.save();
  return {done:false,benchmark:result,progress:Object.keys(scanner.state.historicalBenchmarks).length,total:COINS.length};
 }catch(e){scanner.state.historicalBenchmarks[coin.symbol]={symbol:coin.symbol,name:coin.name,mint:coin.mint,completed:false,error:e.message,fetchedAt:new Date().toISOString()};scanner.save();return {done:false,error:e.message,symbol:coin.symbol,progress:Object.keys(scanner.state.historicalBenchmarks).length,total:COINS.length};}
}
function getHistorical(scanner){const data=COINS.map(c=>scanner.state.historicalBenchmarks?.[c.symbol]||{symbol:c.symbol,name:c.name,mint:c.mint,completed:false});return {coins:data,completed:data.filter(x=>x.completed).length,total:COINS.length,source:'GeckoTerminal Public API',limitations:'Historique public généralement limité à une fenêtre récente (environ six mois) et à 180 bougies journalières demandées. Ce replay ne reconstitue pas le lancement initial des tokens plus anciens et ne rejoue pas tous les capteurs temps réel.'};}
module.exports={runHistoricalBenchmark:runOne,getHistoricalBenchmark:getHistorical};
