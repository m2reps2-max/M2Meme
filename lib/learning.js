'use strict';
const HORIZONS=[['15m',900000],['1h',3600000],['6h',21600000],['24h',86400000],['7d',604800000]];
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const { summarizeLaunchCohorts } = require('./launch-cohort');
function evaluateForecasts(token,snap){
 const rows=token.forecasts||[];
 for(const f of rows){
  if(!f.outcomes)f.outcomes={};
  if(snap.at>f.at&&snap.at-f.at<=604800000+259200000){
   f.path||={maxPrice:f.priceUsd,minPrice:f.priceUsd,minLiquidity:f.liquidityUsd};
   f.path.maxPrice=Math.max(Number(f.path.maxPrice)||0,snap.priceUsd||0);
   f.path.minPrice=Math.min(Number(f.path.minPrice)||Infinity,snap.priceUsd>0?snap.priceUsd:Infinity);
   if(snap.liquidityUsd>0)f.path.minLiquidity=Math.min(Number(f.path.minLiquidity)||snap.liquidityUsd,snap.liquidityUsd);
  }
  for(const [key,ms] of HORIZONS){
   if(f.outcomes[key]||snap.at<f.at+ms||snap.at-(f.at+ms)>Math.max(180000,ms))continue;
   if(!(f.priceUsd>0&&snap.priceUsd>=0))continue;
   const ret=snap.priceUsd>0?(snap.priceUsd/f.priceUsd-1)*100:-100;
   const liq=f.liquidityUsd>0&&snap.liquidityUsd>=0?(snap.liquidityUsd/f.liquidityUsd-1)*100:null;
   const maxFavorable=f.priceUsd>0&&Number.isFinite(f.path?.maxPrice)?(f.path.maxPrice/f.priceUsd-1)*100:null;
   const maxAdverse=f.priceUsd>0&&Number.isFinite(f.path?.minPrice)?(f.path.minPrice/f.priceUsd-1)*100:null;
   const label=liq!==null&&liq<=-60?'liquidity_collapse':liq!==null&&liq<=-30?'liquidity_stress':ret>=50?'strong_win':ret>=15?'win':ret<=-50?'severe_loss':ret<=-20?'loss':ret<=-8?'drawdown':'flat';
   f.outcomes[key]={observedAt:snap.at,delayMs:snap.at-f.at,returnPct:Number(ret.toFixed(2)),maxFavorablePct:maxFavorable===null?null:Number(maxFavorable.toFixed(2)),maxAdversePct:maxAdverse===null?null:Number(maxAdverse.toFixed(2)),liquidityChangePct:liq===null?null:Number(liq.toFixed(2)),volumeChangePct:f.volume1h>0?Number(((snap.volume1h/f.volume1h-1)*100).toFixed(1)):null,label,lateByMs:Math.max(0,snap.at-(f.at+ms)),resolutionQuality:snap.at-(f.at+ms)>Math.max(180000,ms*.35)?'late_observation':'within_tolerance'};
  }
 }
 token.forecasts=rows.slice(-700);
}
function recordForecast(token,snap){
 evaluateForecasts(token,snap);
 const last=token.forecasts?.at(-1);
 if(last&&snap.at-last.at<900000)return;
 if(!(snap.priceUsd>0&&snap.liquidityUsd>=1000))return;
 token.forecasts ||= [];
 const age=token.launchAgeHours??token.ageHours;
 token.forecasts.push({id:token.mint+':'+snap.at,at:snap.at,priceUsd:snap.priceUsd,liquidityUsd:snap.liquidityUsd,volume1h:snap.volume1h,volume24h:snap.volume24h,buys1h:snap.buys1h,sells1h:snap.sells1h,fdv:snap.fdv,score:snap.score,coverage:snap.coverage,classification:snap.classification,risk:snap.risk||'unknown',flags:snap.flags||[],source:token.launchSource||(token.geckoPoolAddress?'GeckoTerminal pool':'DexScreener discovery'),launchAgeHours:age===null||age===undefined?null:Number.isFinite(Number(age))?Number(age):null,outcomes:{},path:{maxPrice:snap.priceUsd,minPrice:snap.priceUsd,minLiquidity:snap.liquidityUsd}});
 token.forecasts=token.forecasts.slice(-700);
}
function stableHoldout(mint){
 let hash=2166136261;
 for(const char of String(mint||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return (hash>>>0)%5===0;
}
function stableHash(value){
 let hash=2166136261;
 for(const char of String(value||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return hash>>>0;
}
function outOfSampleCalibration(rows){
 const byMint=new Map();
 for(const row of rows.filter(x=>x.outcomes?.['1h']&&x.score!==null&&x.score!==undefined&&Number.isFinite(Number(x.score)))){
  const current=byMint.get(row.mint);
  if(!current||row.at<current.at)byMint.set(row.mint,row);
 }
 const unique=[...byMint.values()].sort((a,b)=>a.at-b.at||String(a.mint).localeCompare(String(b.mint)));
 const splitIndex=Math.max(1,Math.min(unique.length-1,Math.floor(unique.length*.8)));
 const training=unique.length>=2?unique.slice(0,splitIndex):unique;
 const validation=unique.length>=2?unique.slice(splitIndex):[];
 const median=values=>{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  return Number((sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2).toFixed(2));
 };
 const metrics=items=>{
  const returns=items.map(x=>Number(x.outcomes['1h'].returnPct)).filter(Number.isFinite);
  const losses=returns.filter(x=>x<=-20).length;
  return {tokens:items.length,positive15Pct:returns.length?Number((returns.filter(x=>x>=15).length/returns.length*100).toFixed(1)):null,averageReturnPct:returns.length?Number((returns.reduce((sum,x)=>sum+x,0)/returns.length).toFixed(2)):null,medianReturnPct:median(returns),loss20Pct:returns.length?Number((losses/returns.length*100).toFixed(1)):null};
 };
 const candidates=[60,65,70,75,80,85].map(threshold=>{
  const selected=training.filter(x=>Number(x.score)>=threshold);
  return {threshold,...metrics(selected)};
 }).filter(x=>x.tokens>=10&&x.averageReturnPct!==null&&x.positive15Pct>=50&&x.averageReturnPct>0);
 candidates.sort((a,b)=>b.averageReturnPct-a.averageReturnPct||b.positive15Pct-a.positive15Pct||(a.loss20Pct??100)-(b.loss20Pct??100)||b.tokens-a.tokens);
 const selected=candidates[0]||null;
 const holdout=selected?validation.filter(x=>Number(x.score)>=selected.threshold):[];
 const randomBaseline=holdout.length?[...validation].sort((a,b)=>stableHash(a.mint)-stableHash(b.mint)).slice(0,holdout.length):[];
 const validationMetrics=metrics(validation);
 const holdoutMetrics=metrics(holdout);
 const randomMetrics=metrics(randomBaseline);
 const trainingEndAt=training.length?new Date(training.at(-1).at).toISOString():null;
 const validationStartAt=validation.length?new Date(validation[0].at).toISOString():null;
 return {
  split:'Walk-forward chronologique par mint : les 80% de premiers signaux les plus anciens servent à sélectionner le seuil; les 20% les plus récents restent en validation. Un seul premier signal résolu par token.',
  uniqueResolvedTokens:unique.length,
  training:metrics(training),
  validation:validationMetrics,
  trainingEndAt,
  validationStartAt,
  thresholdCandidates:candidates,
  selectedThreshold:selected?.threshold??null,
  selectedTrainingMetrics:selected?{tokens:selected.tokens,positive15Pct:selected.positive15Pct,averageReturnPct:selected.averageReturnPct,medianReturnPct:selected.medianReturnPct,loss20Pct:selected.loss20Pct}:null,
  holdoutAtSelectedThreshold:selected?{threshold:selected.threshold,...holdoutMetrics}:null,
  baselineComparison:{
   validationAll:validationMetrics,
   randomSameSize:{...randomMetrics,selection:'Échantillon déterministe de même taille que les tokens retenus par le seuil'},
   thresholdVsAllValidation:holdout.length&&validationMetrics.averageReturnPct!==null?Number((holdoutMetrics.averageReturnPct-validationMetrics.averageReturnPct).toFixed(2)):null,
   thresholdVsRandomBaseline:holdout.length&&randomMetrics.averageReturnPct!==null?Number((holdoutMetrics.averageReturnPct-randomMetrics.averageReturnPct).toFixed(2)):null
  },
  status:unique.length<30?'insufficient_sample':!selected?'no_stable_training_threshold':holdout.length<5?'holdout_too_small':'holdout_available',
  limitations:'La séparation chronologique réduit la fuite temporelle mais ne supprime pas le biais de survivance : seuls les tokens découverts et conservés par le scanner sont représentés. Un seul premier signal résolu par mint est utilisé. Les observations de prix ne simulent ni frais, ni slippage, ni impact de marché, ni possibilité réelle de sortie. Le seuil n’est jamais appliqué automatiquement.'
 };
}
function learningSummary(){
 const rows=[];
 for(const t of Object.values(this.state.tokens||{}))for(const f of t.forecasts||[])rows.push({...f,mint:t.mint,symbol:t.symbol||'—'});
 const horizons={};
 for(const [key] of HORIZONS){
  const a=rows.filter(x=>x.outcomes?.[key]);
  const rets=a.map(x=>x.outcomes[key].returnPct),avg=rets.length?rets.reduce((s,x)=>s+x,0)/rets.length:null;
  horizons[key]={resolved:a.length,averageReturnPct:avg===null?null:Number(avg.toFixed(2)),winRatePct:a.length?Number((a.filter(x=>x.outcomes[key].label==='win'||x.outcomes[key].label==='strong_win').length/a.length*100).toFixed(1)):null,lossRatePct:a.length?Number((a.filter(x=>['drawdown','loss','severe_loss','liquidity_stress','liquidity_collapse'].includes(x.outcomes[key].label)).length/a.length*100).toFixed(1)):null,strongWinRatePct:a.length?Number((a.filter(x=>x.outcomes[key].label==='strong_win').length/a.length*100).toFixed(1)):null};
 }
 const bands=[[0,44,'0–44'],[45,64,'45–64'],[65,79,'65–79'],[80,100,'80–100']];
 const calibration=bands.map(([min,max,label])=>{const a=rows.filter(x=>x.score>=min&&x.score<=max),r=a.filter(x=>x.outcomes?.['1h']),v=r.map(x=>x.outcomes['1h'].returnPct);return {label,predictions:a.length,resolved1h:r.length,average1hPct:v.length?Number((v.reduce((s,x)=>s+x,0)/v.length).toFixed(2)):null,winRate1hPct:r.length?Number((r.filter(x=>['win','strong_win'].includes(x.outcomes['1h'].label)).length/r.length*100).toFixed(1)):null,lossRate1hPct:r.length?Number((r.filter(x=>['loss','severe_loss'].includes(x.outcomes['1h'].label)).length/r.length*100).toFixed(1)):null};});
 const labels={};for(const f of rows)for(const [h,o] of Object.entries(f.outcomes||{})){labels[o.label] ||= {};labels[o.label][h]=(labels[o.label][h]||0)+1;}
 const resolved=rows.filter(x=>Object.keys(x.outcomes||{}).length).length;
 const oneHour=rows.filter(x=>x.outcomes?.['1h']);
 const successful=oneHour.filter(x=>Number(x.outcomes['1h'].returnPct)>=15).length;
 const successRate={horizon:'1h',minReturnPct:15,evaluated:oneHour.length,successful,ratePct:oneHour.length?Number((successful/oneHour.length*100).toFixed(1)):null,averageReturnPct:horizons['1h'].averageReturnPct,lossRatePct:horizons['1h'].lossRatePct,definition:'Un signal est compté comme réussi si son prix progresse d’au moins 15 % après environ 1 heure. Les observations neutres et négatives restent dans le total.'};
 const strongSignals=oneHour.filter(x=>Number(x.score)>=65);
 const rugLike=strongSignals.filter(x=>['liquidity_stress','liquidity_collapse','loss','severe_loss'].includes(x.outcomes['1h'].label));
 const falsePositiveAnalysis={strongSignals:strongSignals.length,rugLikeOrSevereLoss:rugLike.length,ratePct:strongSignals.length?Number((rugLike.length/strongSignals.length*100).toFixed(1)):null,definition:'Parmi les prévisions de score >=65 résolues à 1h, part ayant subi une forte perte ou une forte baisse de liquidité. Ce proxy ne prouve pas un rug.'};
 const cohort=(items)=>{const returns=items.map(x=>x.outcomes?.['1h']?.returnPct).filter(x=>Number.isFinite(x));const resolved=items.filter(x=>x.outcomes?.['1h']);return {predictions:items.length,resolved:resolved.length,average1hPct:returns.length?Number((returns.reduce((s,x)=>s+x,0)/returns.length).toFixed(2)):null,winRate1hPct:resolved.length?Number((resolved.filter(x=>['win','strong_win'].includes(x.outcomes['1h'].label)).length/resolved.length*100).toFixed(1)):null,lossRate1hPct:resolved.length?Number((resolved.filter(x=>['loss','severe_loss','liquidity_stress','liquidity_collapse'].includes(x.outcomes['1h'].label)).length/resolved.length*100).toFixed(1)):null};};
 const bySource={};for(const row of rows){const key=row.source||'Source inconnue';(bySource[key] ||= []).push(row);}
 const byLaunchAge={};for(const row of rows){const age=row.launchAgeHours;const key=age===null||age===undefined?'Âge inconnu':age<5/60?'0–5 min':age<0.5?'5–30 min':age<2?'30 min–2 h':'2 h+';(byLaunchAge[key] ||= []).push(row);}
 const cohorts={bySource:Object.fromEntries(Object.entries(bySource).map(([key,items])=>[key,cohort(items)])),byLaunchAge:Object.fromEntries(Object.entries(byLaunchAge).map(([key,items])=>[key,cohort(items)]))};
 const eligible=calibration.filter(x=>['65–79','80–100'].includes(x.label)&&x.resolved1h>=30&&x.winRate1hPct>=60&&x.lossRate1hPct<=25&&x.average1hPct>0).sort((a,b)=>a.label==='65–79'?-1:1);
 const recommended=eligible[0]||null;
 const adaptiveThreshold=recommended?(recommended.label==='65–79'?65:80):null;
 const outOfSample=outOfSampleCalibration(rows);
 const launchCohorts=summarizeLaunchCohorts(Object.values(this.state.tokens||{}));
 return {successRate,falsePositiveAnalysis,adaptiveThreshold:null,inSampleThresholdHint:adaptiveThreshold,cohorts,outOfSample,launchCohorts,summary:{forecasts:rows.length,resolvedForecasts:resolved,trackedTokens:new Set(rows.map(x=>x.mint)).size,horizons},calibration,labels,recommendation:recommended?{bestObservedScoreBand:recommended.label,winRate1hPct:recommended.winRate1hPct,samples:recommended.resolved1h,automaticScoringChanges:false,criteria:'30+ résultats à 1 h, au moins 60% gagnants, au plus 25% perdants et rendement moyen positif'}:null,recent:rows.slice(-100).reverse().map(x=>({symbol:x.symbol,score:x.score,at:new Date(x.at).toISOString(),outcomes:x.outcomes})),method:'Chaque prévision est figée au moment du scan puis évaluée avec la première observation disponible après chaque horizon. Les résultats ne sont pas des trades exécutés : aucun slippage, frais, impact de marché ou possibilité réelle de vente n’est modélisé. Les horizons sont résolus avec tolérance temporelle.',horizonsAvailable:HORIZONS.map(x=>x[0])};
}
module.exports={recordForecast,learningSummary};
