'use strict';
const {buildWalletTokenSignals}=require('./wallet-token-signals');
const HORIZONS=['15m','1h','6h','24h','7d'];
const MAX_CHECKS=120;
const MAX_TOKENS=1200;
const MAX_TRADES=5000;
const ms=v=>{const x=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(x)?(x<1e12?x*1000:x):null;};
function upperBound(rows,time){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].atMs<=time)lo=mid+1;else hi=mid;}return lo;}
function median(values){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return Number((a.length%2?a[m]:(a[m-1]+a[m])/2).toFixed(2));}
function summarize(rows,horizon){
 const outcomes=rows.map(row=>row.forecast?.outcomes?.[horizon]).filter(x=>x&&x.returnPct!==null&&x.returnPct!==undefined&&Number.isFinite(Number(x.returnPct)));
 const returns=outcomes.map(x=>Number(x.returnPct));
 const avg=values=>values.length?Number((values.reduce((s,x)=>s+x,0)/values.length).toFixed(2)):null;
 const favorable=outcomes.filter(x=>x.maxFavorablePct!==null&&x.maxFavorablePct!==undefined).map(x=>Number(x.maxFavorablePct)).filter(Number.isFinite);
 const adverse=outcomes.filter(x=>x.maxAdversePct!==null&&x.maxAdversePct!==undefined).map(x=>Number(x.maxAdversePct)).filter(Number.isFinite);
 return {
  tokens:returns.length,
  positive15Pct:returns.length?Number((returns.filter(x=>x>=15).length/returns.length*100).toFixed(1)):null,
  averageReturnPct:avg(returns),medianReturnPct:median(returns),
  loss20Pct:returns.length?Number((returns.filter(x=>x<=-20).length/returns.length*100).toFixed(1)):null,
  severeLoss50Pct:returns.length?Number((returns.filter(x=>x<=-50).length/returns.length*100).toFixed(1)):null,
  averageMaxFavorablePct:avg(favorable),averageMaxAdversePct:avg(adverse),
  liquidityCollapsePct:outcomes.length?Number((outcomes.filter(x=>x.label==='liquidity_collapse').length/outcomes.length*100).toFixed(1)):null
 };
}
function buildWalletSignalBacktest(state={},options={}){
 const maxChecks=Math.max(1,Math.min(MAX_CHECKS,Number(options.maxChecks)||MAX_CHECKS));
 const rawTrades=Array.isArray(state.walletTrades)?state.walletTrades.slice(-MAX_TRADES):[];
 const trades=rawTrades.map(t=>({...t,atMs:ms(t.at)})).filter(t=>t.swapConfirmed===true&&t.atMs!==null&&t.mint&&t.wallet&&['buy','sell'].includes(t.direction)).sort((a,b)=>a.atMs-b.atMs);
 const tokens=state.tokens&&typeof state.tokens==='object'?state.tokens:{};
 const tokenRows=Object.values(tokens).filter(t=>t&&t.mint&&Array.isArray(t.forecasts)&&t.forecasts.length).slice(0,MAX_TOKENS);
 const firstResolvedByHorizon=Object.fromEntries(HORIZONS.map(h=>[h,new Map()])),firstResolvedAny=new Set(),signals=[],buyEvents=new Map();let candidateChecks=0;
 for(const event of trades)if(event.direction==='buy'){
  const rows=buyEvents.get(event.mint)||[];rows.push(event);buyEvents.set(event.mint,rows);
 }
 for(const token of tokenRows){
  const forecasts=[...token.forecasts].filter(f=>ms(f.at)!==null&&Number(f.priceUsd)>0).sort((a,b)=>ms(a.at)-ms(b.at));
  for(const f of forecasts)for(const horizon of HORIZONS)if(f.outcomes?.[horizon]&&f.outcomes[horizon].returnPct!==null&&f.outcomes[horizon].returnPct!==undefined&&Number.isFinite(Number(f.outcomes[horizon].returnPct))){
   if(!firstResolvedByHorizon[horizon].has(token.mint))firstResolvedByHorizon[horizon].set(token.mint,{mint:token.mint,forecast:f});
   firstResolvedAny.add(token.mint);
  }
  const buys=buyEvents.get(token.mint)||[];
  if(buys.length<2)continue;
  for(const forecast of forecasts){
   const at=ms(forecast.at),cutoff=at-6*60*60*1000;
   const recentWallets=new Set();
   for(let i=buys.length-1;i>=0;i--){if(buys[i].atMs>at)continue;if(buys[i].atMs<cutoff)break;recentWallets.add(buys[i].wallet);if(recentWallets.size>=2)break;}
   if(recentWallets.size<2)continue;
   if(candidateChecks>=maxChecks)break;
   candidateChecks++;
   const end=upperBound(trades,at),pastTrades=trades.slice(0,end);
   const pointInTimeState={tokens,walletTrades:pastTrades};
   const signal=buildWalletTokenSignals(pointInTimeState,at)[token.mint];
   if(signal?.qualified===true&&Number.isFinite(Number(signal.score))){
    signals.push({mint:token.mint,at:forecast.at,score:signal.score,wallets:signal.trustedWalletBuys,earlyWallets:signal.earlyWallets,sellingWallets:signal.sellingWallets,forecast});
    break;
   }
  }
  if(candidateChecks>=maxChecks)break;
 }
 const byHorizon={};
 for(const horizon of HORIZONS){
  const signalMetrics=summarize(signals,horizon),firstResolved=firstResolvedByHorizon[horizon];
  const universeRows=[...firstResolved.values()].map(x=>({mint:x.mint,forecast:x.forecast}));
  const universe=summarize(universeRows,horizon);
  const sameTokenFirst=summarize(signals.map(s=>({mint:s.mint,forecast:firstResolved.get(s.mint)?.forecast})).filter(x=>x.forecast),horizon);
  byHorizon[horizon]={
   walletSignal:signalMetrics,firstObservedTokenBaseline:universe,
   sameTokensAtFirstObservation:sameTokenFirst,
   signalVsUniverseAverageReturnPct:signalMetrics.averageReturnPct!==null&&universe.averageReturnPct!==null?Number((signalMetrics.averageReturnPct-universe.averageReturnPct).toFixed(2)):null,
   signalVsSameTokensFirstObservationPct:signalMetrics.averageReturnPct!==null&&sameTokenFirst.averageReturnPct!==null?Number((signalMetrics.averageReturnPct-sameTokenFirst.averageReturnPct).toFixed(2)):null
  };
 }
 const tradeTimes=trades.map(x=>x.atMs);
 const resolvedOneHour=summarize(signals,'1h').tokens;
 const result={
  generatedAt:new Date().toISOString(),
  status:signals.length===0?'no_wallet_convergence_observed':resolvedOneHour>=30?'descriptive_sample_available':'insufficient_sample',
  summary:{tokensWithForecasts:tokenRows.length,firstObservedTokens:firstResolvedAny.size,confirmedWalletTrades:trades.length,distinctWallets:new Set(trades.map(x=>x.wallet)).size,signalTokens:signals.length,candidateChecks,evaluationLimit:maxChecks,evaluationLimitReached:candidateChecks>=maxChecks,historyStartAt:tradeTimes.length?new Date(tradeTimes[0]).toISOString():null,historyEndAt:tradeTimes.length?new Date(tradeTimes.at(-1)).toISOString():null},
  byHorizon,
  recentSignals:signals.slice(-10).reverse().map(s=>({mint:s.mint,at:s.at,score:s.score,wallets:s.wallets,earlyWallets:s.earlyWallets,sellingWallets:s.sellingWallets})),
  methodology:{
   signal:'Premier forecast par token où deux wallets distincts ayant chacun au moins deux positions clôturées observées achètent dans une fenêtre de six heures. Le score et la réputation sont recalculés uniquement avec les swaps confirmés horodatés au plus tard à l’instant du signal.',
   baseline:'Comparaison descriptive avec le premier forecast résolu de chaque token suivi, puis avec le premier forecast résolu des mêmes tokens signalés. Une seule observation par token et par cohorte.',
   outcomes:'Rendements et excursions proviennent des snapshots de prix/liquidité déjà enregistrés après chaque horizon. Ils ne simulent ni frais, ni slippage, ni impact de marché, ni liquidité réellement exécutable.',
   limitations:'Historique des wallets limité aux 5 000 derniers swaps conservés et historique de forecasts limité par token. La collecte commence à l’activation du suivi; les wallets non suivis et les tokens non découverts sont absents. Ce résultat est descriptif, pas une preuve de prédiction ni une validation statistique. Les scores de réputation sont reconstruits point-in-time pour éviter d’utiliser les transactions futures.'
  }
 };
 return result;
}
function walletSignalBacktest(){
 const now=Date.now(),cached=this._walletSignalBacktestCache;
 if(cached&&now-cached.at<300000)return cached.value;
 const value=buildWalletSignalBacktest(this.state);
 this._walletSignalBacktestCache={at:now,value};
 return value;
}
module.exports={buildWalletSignalBacktest,walletSignalBacktest};
