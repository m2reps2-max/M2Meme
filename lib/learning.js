'use strict';
const HORIZONS=[['15m',900000],['1h',3600000],['6h',21600000],['24h',86400000],['7d',604800000]];
const n=v=>Number.isFinite(Number(v))?Number(v):null;
function classifyOutcomeLabel(returnPct,liquidityChangePct){
 if(returnPct===null||returnPct===undefined||returnPct==='')return 'unresolved';
 const ret=Number(returnPct);
 if(!Number.isFinite(ret))return 'unresolved';
 const liquidity=liquidityChangePct!==null&&liquidityChangePct!==undefined&&liquidityChangePct!==''?Number(liquidityChangePct):null;
 if(liquidity!==null&&Number.isFinite(liquidity)&&liquidity<=-60)return 'liquidity_collapse';
 if(liquidity!==null&&Number.isFinite(liquidity)&&liquidity<=-30)return 'liquidity_stress';
 if(ret>=50)return 'strong_win';if(ret>=15)return 'win';if(ret<=-50)return 'severe_loss';if(ret<=-20)return 'loss';if(ret<=-8)return 'drawdown';return 'flat';
}
const { summarizeLaunchCohorts } = require('./launch-cohort');
const { FEATURES, buildAdaptiveModel, netReturnPct } = require('./adaptive-model');
function forecastRows(token){
 const rows=Array.isArray(token?.forecasts)?token.forecasts:[];
 const first=token?.firstForecast;
 if(first&&!rows.some(row=>(first.id&&row?.id===first.id)||Number(row?.at)===Number(first.at)))return [first,...rows];
 return rows;
}
function evaluateForecasts(token,snap){
 const rows=Array.isArray(token.forecasts)?token.forecasts:[];
 const evaluationRows=forecastRows(token);
 for(const f of evaluationRows){
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
   const grossLabel=classifyOutcomeLabel(ret,liq);
   const netRet=netReturnPct(ret,f.liquidityUsd,snap.liquidityUsd,100);
   const label=grossLabel,netLabel=classifyOutcomeLabel(netRet,liq);
   f.outcomes[key]={observedAt:snap.at,delayMs:snap.at-f.at,returnPct:Number(ret.toFixed(2)),grossReturnPct:Number(ret.toFixed(2)),netReturnPct:Number(netRet.toFixed(2)),grossLabel,netLabel,exitLiquidityUsd:snap.liquidityUsd!==null&&snap.liquidityUsd!==undefined&&Number.isFinite(Number(snap.liquidityUsd))?Number(snap.liquidityUsd):null,maxFavorablePct:maxFavorable===null?null:Number(maxFavorable.toFixed(2)),maxAdversePct:maxAdverse===null?null:Number(maxAdverse.toFixed(2)),liquidityChangePct:liq===null?null:Number(liq.toFixed(2)),volumeChangePct:f.volume1h>0?Number(((snap.volume1h/f.volume1h-1)*100).toFixed(1)):null,label,lateByMs:Math.max(0,snap.at-(f.at+ms)),resolutionQuality:snap.at-(f.at+ms)>Math.max(180000,ms*.35)?'late_observation':'within_tolerance'};
  }
 }
 token.forecasts=rows.slice(-700);
 if(!token.firstForecast&&rows.length)token.firstForecast=rows[0];
 else if(token.firstForecast){
  const retained=rows.find(row=>(token.firstForecast.id&&row?.id===token.firstForecast.id)||Number(row?.at)===Number(token.firstForecast.at));
  if(retained)token.firstForecast=retained;
 }
}
function recordForecast(token,snap){
 evaluateForecasts(token,snap);
 const last=token.forecasts?.at(-1)||token.firstForecast;
 if(last&&snap.at-last.at<900000)return;
 if(!(snap.priceUsd>0&&snap.liquidityUsd>0))return;
 token.forecasts ||= [];
 if(!token.firstForecast&&token.forecasts.length)token.firstForecast=token.forecasts[0];
 const age=token.launchAgeHours??token.ageHours;
 const features={};for(const key of FEATURES){const value=snap.factors?.[key];if(typeof value==='number'&&Number.isFinite(value))features[key]=Math.max(0,Math.min(100,value));}
 const forecast={id:token.mint+':'+snap.at,at:snap.at,criteriaVersion:Number(snap.criteriaVersion)||1,legacyScore:snap.legacyScore!==null&&snap.legacyScore!==undefined&&Number.isFinite(Number(snap.legacyScore))?Number(snap.legacyScore):null,launchPhase:snap.launchPhase||null,priceUsd:snap.priceUsd,liquidityUsd:snap.liquidityUsd,volume1h:snap.volume1h,volume24h:snap.volume24h,buys1h:snap.buys1h,sells1h:snap.sells1h,fdv:snap.fdv,score:snap.score,coverage:snap.coverage,classification:snap.classification,risk:snap.risk||'unknown',flags:snap.flags||[],features,source:token.launchSource||(token.geckoPoolAddress?'GeckoTerminal pool':'DexScreener discovery'),liquidityBand:snap.liquidityUsd<1000?'under_1k':snap.liquidityUsd<5000?'1k_5k':snap.liquidityUsd<25000?'5k_25k':'25k_plus',launchAgeHours:age===null||age===undefined?null:Number.isFinite(Number(age))?Number(age):null,outcomes:{},path:{maxPrice:snap.priceUsd,minPrice:snap.priceUsd,minLiquidity:snap.liquidityUsd}};
 if(!token.firstForecast)token.firstForecast=forecast;
 token.forecasts.push(forecast);
 token.forecasts=token.forecasts.slice(-700);
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
  const valid=items.map(row=>({row,raw:row.outcomes['1h'].grossReturnPct??row.outcomes['1h'].returnPct}))
   .filter(x=>x.raw!==null&&x.raw!==undefined&&x.raw!==''&&Number.isFinite(Number(x.raw)));
  const grossReturns=valid.map(x=>Number(x.raw));
  const returns=valid.map(x=>netReturnPct(Number(x.raw),x.row.liquidityUsd,x.row.outcomes['1h'].exitLiquidityUsd,100)).filter(Number.isFinite);
  const losses=returns.filter(x=>x<=-20).length;
  return {
   tokens:returns.length,
   positive15Pct:returns.length?Number((returns.filter(x=>x>=15).length/returns.length*100).toFixed(1)):null,
   averageReturnPct:returns.length?Number((returns.reduce((sum,x)=>sum+x,0)/returns.length).toFixed(2)):null,
   grossAverageReturnPct:grossReturns.length?Number((grossReturns.reduce((sum,x)=>sum+x,0)/grossReturns.length).toFixed(2)):null,
   medianReturnPct:median(returns),
   loss20Pct:returns.length?Number((losses/returns.length*100).toFixed(1)):null
  };
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
  returnBasis:'net_simulated',
  costAssumptions:{costModelVersion:2,notionalUsd:100,baseSlippagePct:0.5,maxSlippagePct:15,unknownLiquiditySlippagePct:10,feePerSidePct:0.3,slippageModel:'0.5% + 1.5 × montant / liquidité, plafonné à 15%; liquidité inconnue = 10%.'},
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
  limitations:'Les rendements de validation sont nets d’un proxy de slippage dépendant de la liquidité et de frais fixes (0,3% par côté). Le proxy reste approximatif et ne reproduit pas une cotation ni une exécution réelle. La séparation chronologique réduit la fuite temporelle mais ne supprime pas le biais de survivance : seuls les tokens découverts et conservés par le scanner sont représentés. Un seul premier signal résolu par mint est utilisé. Le seuil n’est jamais appliqué automatiquement.'
 };
}
function learningSummary(){
 const now=Date.now();
 const cached=this._learningSummaryCache;
 if(cached&&now-cached.at<15000)return cached.value;
 const tokens=Object.values(this.state.tokens||{});
 const horizons={};
 const horizonCounts={};
 for(const [key] of HORIZONS)horizonCounts[key]={resolved:0,sum:0,wins:0,losses:0,strong:0};
 const bands=[[0,44,'0–44'],[45,64,'45–64'],[65,79,'65–79'],[80,100,'80–100']];
 const bandCounts=bands.map(([min,max,label])=>({min,max,label,predictions:0,resolved:0,sum:0,wins:0,losses:0}));
 const labels={},grossLabels={};
 const bySource=new Map(),byLaunchAge=new Map(),byLiquidity=new Map();
 const outOfSampleRows=[];
 const firstResolvedByMint=new Map();
 const recent=[];
 let forecastCount=0,resolvedForecasts=0,trackedTokenCount=0,oneHourCount=0,successful=0,strongSignals=0,rugLike=0;
 const cohortBucket=()=>({predictions:0,resolved:0,sum:0,wins:0,losses:0});
 const netOutcome=(f,outcome)=>{
  const rawGross=outcome?.grossReturnPct??outcome?.returnPct;
  const gross=rawGross!==null&&rawGross!==undefined&&rawGross!==''?Number(rawGross):NaN;
  const exitLiquidity=outcome?.exitLiquidityUsd!==null&&outcome?.exitLiquidityUsd!==undefined?Number(outcome.exitLiquidityUsd)
   :outcome?.liquidityChangePct!==null&&outcome?.liquidityChangePct!==undefined&&Number(f?.liquidityUsd)>0?Number(f.liquidityUsd)*(1+Number(outcome.liquidityChangePct)/100):f?.liquidityUsd;
  return netReturnPct(gross,f?.liquidityUsd,exitLiquidity,100);
 };
 const netLabel=(ret,outcome)=>classifyOutcomeLabel(ret,outcome?.liquidityChangePct);
 const addCohort=(map,key,f,outcome)=>{
  let bucket=map.get(key);if(!bucket){bucket=cohortBucket();map.set(key,bucket);}
  bucket.predictions++;
  if(!outcome)return;
  const ret=netOutcome(f,outcome);
  if(!Number.isFinite(ret))return;
  bucket.resolved++;bucket.sum+=ret;
  const label=netLabel(ret,outcome);
  if(['win','strong_win'].includes(label))bucket.wins++;
  if(['drawdown','loss','severe_loss','liquidity_stress','liquidity_collapse'].includes(label))bucket.losses++;
 };
 for(const token of tokens){
  const mint=token.mint||'';
  const tokenForecasts=forecastRows(token);
  if(tokenForecasts.length)trackedTokenCount++;
  for(const f of tokenForecasts){
   forecastCount++;
   const outcomes=f.outcomes||{};
   const keys=Object.keys(outcomes);
   if(keys.length)resolvedForecasts++;
   const one=outcomes['1h']||null;
   const score=Number(f.score);
   const hasScore=f.score!==null&&f.score!==undefined&&Number.isFinite(score);
   const band=hasScore?bandCounts.find(x=>score>=x.min&&score<=x.max):null;
   if(band)band.predictions++;
   if(one){
    const ret=netOutcome(f,one);
    if(Number.isFinite(ret)){
     oneHourCount++;
     const label=netLabel(ret,one);
     if(ret>=15)successful++;
     if(hasScore&&score>=65){strongSignals++;if(['liquidity_stress','liquidity_collapse','loss','severe_loss'].includes(label))rugLike++;}
     if(band){band.resolved++;band.sum+=ret;if(['win','strong_win'].includes(label))band.wins++;if(['drawdown','loss','severe_loss'].includes(label))band.losses++;}
     const prior=firstResolvedByMint.get(mint);
     if(!prior||Number(f.at)<Number(prior.at))firstResolvedByMint.set(mint,{mint,at:f.at,score:f.score,liquidityUsd:f.liquidityUsd,outcomes:{'1h':one}});
    }
   }
   for(const [key] of HORIZONS){
    const outcome=outcomes[key];if(!outcome)continue;
    const bucket=horizonCounts[key],ret=netOutcome(f,outcome);
    if(!Number.isFinite(ret))continue;
    bucket.resolved++;bucket.sum+=ret;
    const label=netLabel(ret,outcome);
    if(['win','strong_win'].includes(label))bucket.wins++;
    if(['drawdown','loss','severe_loss','liquidity_stress','liquidity_collapse'].includes(label))bucket.losses++;
    if(label==='strong_win')bucket.strong++;
   }
   for(const [horizon,outcome] of Object.entries(outcomes)){
    const ret=netOutcome(f,outcome),label=Number.isFinite(ret)?netLabel(ret,outcome):'unresolved';
    labels[label] ||= {};labels[label][horizon]=(labels[label][horizon]||0)+1;
    const grossLabel=outcome.grossLabel||outcome.label||'unclassified';
    grossLabels[grossLabel] ||= {};grossLabels[grossLabel][horizon]=(grossLabels[grossLabel][horizon]||0)+1;
   }
   const source=f.source||'Source inconnue';
   const age=f.launchAgeHours;
   const ageKey=age===null||age===undefined?'Âge inconnu':age<5/60?'0–5 min':age<0.5?'5–30 min':age<2?'30 min–2 h':'2 h+';
   addCohort(bySource,source,f,one);
   addCohort(byLaunchAge,ageKey,f,one);
   addCohort(byLiquidity,f.liquidityBand||'liquidity_unknown',f,one);
   const netOutcomes={};
   for(const [horizon,outcome] of Object.entries(outcomes)){
    const ret=netOutcome(f,outcome),grossRaw=outcome.grossReturnPct??outcome.returnPct;
    netOutcomes[horizon]={...outcome,grossLabel:outcome.grossLabel||outcome.label||'unclassified',returnPct:Number.isFinite(ret)?Number(ret.toFixed(2)):null,netReturnPct:Number.isFinite(ret)?Number(ret.toFixed(2)):null,label:Number.isFinite(ret)?netLabel(ret,outcome):'unresolved',netLabel:Number.isFinite(ret)?netLabel(ret,outcome):'unresolved',grossReturnPct:grossRaw!==null&&grossRaw!==undefined&&grossRaw!==''&&Number.isFinite(Number(grossRaw))?Number(grossRaw):null};
   }
   recent.push({symbol:token.symbol||'—',score:f.score,at:f.at,outcomes:netOutcomes});
   if(recent.length>100)recent.shift();
  }
 }
 for(const [key] of HORIZONS){
  const x=horizonCounts[key],count=x.resolved;
  horizons[key]={resolved:count,averageReturnPct:count?Number((x.sum/count).toFixed(2)):null,winRatePct:count?Number((x.wins/count*100).toFixed(1)):null,lossRatePct:count?Number((x.losses/count*100).toFixed(1)):null,strongWinRatePct:count?Number((x.strong/count*100).toFixed(1)):null};
 }
 const calibration=bandCounts.map(x=>({label:x.label,predictions:x.predictions,resolved1h:x.resolved,average1hPct:x.resolved?Number((x.sum/x.resolved).toFixed(2)):null,winRate1hPct:x.resolved?Number((x.wins/x.resolved*100).toFixed(1)):null,lossRate1hPct:x.resolved?Number((x.losses/x.resolved*100).toFixed(1)):null}));
 const successRate={horizon:'1h',minReturnPct:15,evaluated:oneHourCount,successful,ratePct:oneHourCount?Number((successful/oneHourCount*100).toFixed(1)):null,averageReturnPct:horizons['1h'].averageReturnPct,lossRatePct:horizons['1h'].lossRatePct,definition:'Un signal est compté comme réussi si son rendement net simulé dépasse +15 % après environ 1 heure, après frais et slippage estimé selon la liquidité. Les observations neutres et négatives restent dans le total.'};
 const falsePositiveAnalysis={strongSignals,rugLikeOrSevereLoss:rugLike,ratePct:strongSignals?Number((rugLike/strongSignals*100).toFixed(1)):null,definition:'Parmi les prévisions de score >=65 résolues à 1h, part ayant subi une forte perte ou une forte baisse de liquidité. Ce proxy ne prouve pas un rug.'};
 const cohort=(x)=>({predictions:x.predictions,resolved:x.resolved,average1hPct:x.resolved?Number((x.sum/x.resolved).toFixed(2)):null,winRate1hPct:x.resolved?Number((x.wins/x.resolved*100).toFixed(1)):null,lossRate1hPct:x.resolved?Number((x.losses/x.resolved*100).toFixed(1)):null});
 const cohorts={bySource:Object.fromEntries([...bySource].map(([k,v])=>[k,cohort(v)])),byLaunchAge:Object.fromEntries([...byLaunchAge].map(([k,v])=>[k,cohort(v)])),byLiquidity:Object.fromEntries([...byLiquidity].map(([k,v])=>[k,cohort(v)]))};
 const eligible=calibration.filter(x=>['65–79','80–100'].includes(x.label)&&x.resolved1h>=30&&x.winRate1hPct>=60&&x.lossRate1hPct<=25&&x.average1hPct>0).sort((a,b)=>a.label==='65–79'?-1:1);
 const recommended=eligible[0]||null;
 const adaptiveThreshold=recommended?(recommended.label==='65–79'?65:80):null;
 const outOfSample=outOfSampleCalibration([...firstResolvedByMint.values()]);
 const launchCohorts=summarizeLaunchCohorts(tokens);
 const activeAdaptiveModel=buildAdaptiveModel(this.state.tokens||{});
 const archiveAdaptiveModel=this.state.archiveLearning?.adaptiveModel||null;
 const archiveGeneratedAt=Date.parse(this.state.archiveLearningGeneratedAt||'');
 const archiveAgeMs=Number.isFinite(archiveGeneratedAt)?now-archiveGeneratedAt:Infinity;
 const archiveFresh=archiveAgeMs>=-300000&&archiveAgeMs<=5*86400000;
 const useArchiveAdaptiveModel=!activeAdaptiveModel.enabled&&archiveFresh&&archiveAdaptiveModel?.enabled===true;
 const adaptiveModel={
  ...(useArchiveAdaptiveModel?archiveAdaptiveModel:activeAdaptiveModel),
  source:useArchiveAdaptiveModel?'cold_archive':'active_cache',
  generatedAt:useArchiveAdaptiveModel?new Date(archiveGeneratedAt).toISOString():new Date(now).toISOString()
 };
 const adaptiveModelSources={
  active:{status:activeAdaptiveModel.status,enabled:activeAdaptiveModel.enabled===true,observations:activeAdaptiveModel.observations||0},
  archive:{status:archiveAdaptiveModel?.status||'unavailable',enabled:archiveFresh&&archiveAdaptiveModel?.enabled===true,observations:archiveAdaptiveModel?.observations||0,generatedAt:Number.isFinite(archiveGeneratedAt)?new Date(archiveGeneratedAt).toISOString():null,fresh:archiveFresh}
 };
 const value={successRate,falsePositiveAnalysis,adaptiveModel,adaptiveModelSources,adaptiveThreshold:null,inSampleThresholdHint:adaptiveThreshold,cohorts,outOfSample,launchCohorts,summary:{forecasts:forecastCount,resolvedForecasts,trackedTokens:trackedTokenCount,horizons},calibration,labels,grossLabels,recommendation:recommended?{bestObservedScoreBand:recommended.label,winRate1hPct:recommended.winRate1hPct,samples:recommended.resolved1h,automaticScoringChanges:false,criteria:'30+ résultats à 1 h, au moins 60% gagnants, au plus 25% perdants et rendement moyen positif'}:null,recent:recent.reverse().map(x=>({...x,at:new Date(x.at).toISOString()})),method:'Chaque prévision est figée au moment du scan puis évaluée avec la première observation disponible après chaque horizon. Les rendements moyens sont nets d’un proxy de slippage lié à la liquidité (montant simulé de 100 USD) et de 0,3 % de frais par côté. Les labels de trajectoire restent descriptifs; ce ne sont pas des trades exécutés ni des cotations garanties.',horizonsAvailable:HORIZONS.map(x=>x[0])};
 this._learningSummaryCache={at:now,value};
 return value;
}

module.exports={recordForecast,learningSummary};
