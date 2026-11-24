'use strict';

const { scoreCandidate } = require('./adaptive-model');
const { qualifyOpportunity } = require('./alert-quality');
function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function linked(token){return Boolean(token?.pairAddress||token?.geckoPoolAddress);}
function factorSet(token,keys){const factors=token?.analysis?.factors||{};return keys.every(key=>finite(factors[key]));}
function timestamp(value){
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'&&value.trim()){const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;}
 return null;
}
function ageMinutes(value,now){
 const at=timestamp(value);
 return at===null||at>now+60000?null:Math.max(0,(now-at)/60000);
}
function freshness(token,now){
 const history=Array.isArray(token?.history)?token.history:[];
 const latest=history.at(-1)||null;
 return {
  marketAgeMinutes:ageMinutes(latest?.at,now),
  securityAgeMinutes:ageMinutes(token?.security?.checkedAt,now),
  transactionAgeMinutes:ageMinutes(token?.tradeIntel?.checkedAt,now)
 };
}
function rank(a,b,model){
 const learnedA=scoreCandidate(a,model),learnedB=scoreCandidate(b,model);
 const scoreA=learnedA===null?Number(a.analysis?.score||0):Number(a.analysis?.score||0)*0.7+learnedA*0.3;
 const scoreB=learnedB===null?Number(b.analysis?.score||0):Number(b.analysis?.score||0)*0.7+learnedB*0.3;
 return scoreB-scoreA||Number(b.liquidityUsd||0)-Number(a.liquidityUsd||0)||Number(b.volume?.h1||0)-Number(a.volume?.h1||0);
}
function card(token,now,model){
 const a=token.analysis||{},f=freshness(token,now);
 return {
  mint:token.mint,name:token.name,symbol:token.symbol,
  pairAddress:token.pairAddress||null,geckoPoolAddress:token.geckoPoolAddress||null,
  liquidityUsd:finite(token.liquidityUsd)?token.liquidityUsd:null,
  volume:{h1:finite(token.volume?.h1)?token.volume.h1:null},
  txns:{h1:{buys:finite(token.txns?.h1?.buys)?token.txns.h1.buys:null,sells:finite(token.txns?.h1?.sells)?token.txns.h1.sells:null}},
  analysis:{
   score:finite(a.score)?a.score:null,learnedScore:scoreCandidate(token,model),coverage:finite(a.coverage)?a.coverage:0,
   risk:a.risk||'unknown',securityComprehensive:a.securityComprehensive===true,
   hardBlocked:a.hardBlocked===true,
   factors:Object.fromEntries(['activity','momentum','market','liquidityQuality','security'].filter(k=>finite(a.factors?.[k])).map(k=>[k,a.factors[k]]))
  },
  freshness:f
 };
}
function earlyCard(token,now){
 const createdAt=timestamp(token.launchCreatedAt||token.pumpCreatedAt||token.firstSeenAt);
 const age=createdAt===null?null:Math.max(0,(now-createdAt)/60000);
 return {
  mint:token.mint,name:token.name||'Nouveau lancement',symbol:token.symbol||'—',
  source:token.launchSource||'Source de lancement détectée',
  createdAt:createdAt===null?null:new Date(createdAt).toISOString(),
  ageMinutes:age===null?null:Number(age.toFixed(1)),
  phase:'pre_market',marketLinked:false,
  securityStatus:token.security?.checkedAt?'Contrôle disponible':'Contrôle en attente',
  risk:token.analysis?.risk||'unknown',
  hardBlocked:token.analysis?.hardBlocked===true,
  score:null,
  message:'Création détectée avant la disponibilité d’un marché DEX exploitable. Aucun potentiel ni sécurité ne peut encore être confirmé.'
 };
}
function resolveAdaptiveSelectionThreshold(outOfSample,fallback=68){
 const holdout=outOfSample?.holdoutAtSelectedThreshold||{};
 const validation=outOfSample?.validation||{};
 const selected=Number(outOfSample?.selectedThreshold);
 const validated=outOfSample?.status==='holdout_available'
  &&Number(validation.tokens)>=20
  &&Number(holdout.tokens)>=20
  &&Number(holdout.positive15Pct)>=55
  &&Number(holdout.averageReturnPct)>0
  &&Number(holdout.loss20Pct)<=25
  &&Number.isFinite(selected)&&selected>=55&&selected<=90;
 return {threshold:validated?selected:fallback,source:validated?'out_of_sample_validation':'conservative_default',validated,samples:Number(holdout.tokens)||0,reason:validated?'Seuil confirmé sur un échantillon chronologique indépendant.':'Pas encore assez de résultats indépendants pour ajuster le seuil.'};
}

function buildSelection(input,now=Date.now(),options={}){
 const settings=options.settings||{};
 const minScore=Number.isFinite(Number(options.minScore))?Math.max(55,Math.min(95,Number(options.minScore))):Number(settings.minScore)||80;
 const minLiquidityUsd=Number(settings.minLiquidityUsd)||5000;
 const minVolume1hUsd=Number(settings.minVolume1hUsd)||750;
 const minCoverage=Number(settings.minCoverage)||70;
 const minTransactions1h=Number(settings.minTransactions1h)||8;
 const minBuyRatioPct=Number.isFinite(Number(settings.minBuyRatioPct))?Number(settings.minBuyRatioPct):50;
 const maxFdvLiquidityRatio=Number(settings.maxFdvLiquidityRatio)||35;
 const requireComprehensiveSecurity=settings.requireComprehensiveSecurity!==false;
 const all=Array.isArray(input)?input:Object.values(input||{});
 const eligible=all.filter(linked);
 const early=all.filter(t=>!linked(t)&&Boolean(t.launchSource||t.pumpCreatedAt||t.launchCreatedAt)&&t.analysis?.hardBlocked!==true&&t.analysis?.risk!=='high').map(t=>({token:t,age:ageMinutes(t.launchCreatedAt||t.pumpCreatedAt||t.firstSeenAt,now)})).filter(x=>x.age!==null&&x.age<=30).sort((a,b)=>a.age-b.age).slice(0,5).map(x=>earlyCard(x.token,now));
 const candidates=eligible.filter(t=>!t.analysis?.hardBlocked&&t.analysis?.risk!=='high'&&t.analysis?.risk!=='unknown');
 const freshnessRows=candidates.map(token=>({token,age:freshness(token,now)}));
 const freshForBest=freshnessRows.filter(x=>x.age.marketAgeMinutes!==null&&x.age.marketAgeMinutes<=5);
 const freshForWatch=freshnessRows.filter(x=>x.age.marketAgeMinutes!==null&&x.age.marketAgeMinutes<=15
  &&(x.age.securityAgeMinutes===null||x.age.securityAgeMinutes<=60));
 const qualificationSettings={...settings,minScore,minCoverage,minLiquidityUsd,minVolume1hUsd,minTransactions1h,minBuyRatioPct,maxFdvLiquidityRatio,requireComprehensiveSecurity};
 const best=freshForBest.filter(({token:t,age})=>
  qualifyOpportunity(t,qualificationSettings).eligible
   &&age.securityAgeMinutes!==null&&age.securityAgeMinutes<=65
   &&age.transactionAgeMinutes!==null&&age.transactionAgeMinutes<=30
   &&factorSet(t,['activity','momentum','market','liquidityQuality','security'])
 ).map(x=>x.token).sort((a,b)=>rank(a,b,options.adaptiveModel)).slice(0,5);
 const selected=new Set(best.map(t=>t.mint));
 const observe=freshForWatch.filter(({token:t})=>!selected.has(t.mint)
  &&Number(t.analysis?.coverage||0)>=Math.max(55,minCoverage-15)
  &&Number(t.analysis?.score||0)>=Math.max(55,minScore-25)
  &&Number(t.liquidityUsd||0)>=Math.max(2500,Math.round(minLiquidityUsd*.4))
  &&Number(t.volume?.h1||0)>0
  &&factorSet(t,['market','security'])
 ).map(x=>x.token).sort((a,b)=>rank(a,b,options.adaptiveModel)).slice(0,5);
 const diagnostics={
  linked:eligible.length,
  blockedOrUnknownRisk:eligible.filter(t=>t.analysis?.hardBlocked||t.analysis?.risk==='high'||t.analysis?.risk==='unknown').length,
  missingMarketTimestamp:freshnessRows.filter(x=>x.age.marketAgeMinutes===null).length,
  staleMarketOver15m:freshnessRows.filter(x=>x.age.marketAgeMinutes!==null&&x.age.marketAgeMinutes>15).length,
  bestRejectedStaleMarket:freshnessRows.filter(x=>x.age.marketAgeMinutes===null||x.age.marketAgeMinutes>5).length,
  bestRejectedStaleSecurity:freshnessRows.filter(x=>x.age.securityAgeMinutes===null||x.age.securityAgeMinutes>65).length,
  bestRejectedStaleTransactions:freshnessRows.filter(x=>x.age.transactionAgeMinutes===null||x.age.transactionAgeMinutes>30).length
 };
 return {
  best:best.map(t=>card(t,now,options.adaptiveModel)),observe:observe.map(t=>card(t,now,options.adaptiveModel)),early,
  eligible:eligible.length,considered:all.length,diagnostics,
  qualityGate:{profile:settings.preset||'elite',bestMinScore:minScore,bestMinCoverage:minCoverage,bestMinLiquidityUsd:minLiquidityUsd,bestMinVolume1hUsd:minVolume1hUsd,bestMinTransactions1h:minTransactions1h,bestMinBuyRatioPct:minBuyRatioPct,bestMaxFdvLiquidityRatio:maxFdvLiquidityRatio,requireComprehensiveSecurity,bestMarketMaxAgeMinutes:5,watchMarketMaxAgeMinutes:15,bestSecurityMaxAgeMinutes:65,bestTransactionsMaxAgeMinutes:30,watchSecurityMaxAgeMinutes:60}
 };
}
module.exports={buildSelection,resolveAdaptiveSelectionThreshold};
