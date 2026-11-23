'use strict';

const { scoreCandidate } = require('./adaptive-model');
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
 const minScore=Number.isFinite(Number(options.minScore))?Math.max(55,Math.min(90,Number(options.minScore))):68;
 const all=Array.isArray(input)?input:Object.values(input||{});
 const eligible=all.filter(linked);
 const candidates=eligible.filter(t=>!t.analysis?.hardBlocked&&t.analysis?.risk!=='high'&&t.analysis?.risk!=='unknown');
 const freshnessRows=candidates.map(token=>({token,age:freshness(token,now)}));
 const freshForBest=freshnessRows.filter(x=>x.age.marketAgeMinutes!==null&&x.age.marketAgeMinutes<=5);
 const freshForWatch=freshnessRows.filter(x=>x.age.marketAgeMinutes!==null&&x.age.marketAgeMinutes<=15
  &&(x.age.securityAgeMinutes===null||x.age.securityAgeMinutes<=60));
 const best=freshForBest.filter(({token:t,age})=>
  Number(t.analysis?.coverage||0)>=80
  &&Number(t.analysis?.score||0)>=minScore
  &&Number(t.liquidityUsd||0)>=10000
  &&Number(t.volume?.h1||0)>=1000
  &&Number(t.txns?.h1?.buys||0)+Number(t.txns?.h1?.sells||0)>=10
  &&t.analysis?.securityComprehensive===true
  &&age.securityAgeMinutes!==null&&age.securityAgeMinutes<=65
  &&age.transactionAgeMinutes!==null&&age.transactionAgeMinutes<=30
  &&t.analysis?.risk==='observations_only'
  &&factorSet(t,['activity','momentum','market','liquidityQuality','security'])
 ).map(x=>x.token).sort((a,b)=>rank(a,b,options.adaptiveModel)).slice(0,5);
 const selected=new Set(best.map(t=>t.mint));
 const observe=freshForWatch.filter(({token:t})=>!selected.has(t.mint)
  &&Number(t.analysis?.coverage||0)>=65
  &&Number(t.analysis?.score||0)>=58
  &&Number(t.liquidityUsd||0)>=5000
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
  best:best.map(t=>card(t,now,options.adaptiveModel)),observe:observe.map(t=>card(t,now,options.adaptiveModel)),
  eligible:eligible.length,considered:all.length,diagnostics,
  qualityGate:{bestMinScore:minScore,bestMarketMaxAgeMinutes:5,watchMarketMaxAgeMinutes:15,bestSecurityMaxAgeMinutes:65,bestTransactionsMaxAgeMinutes:30,watchSecurityMaxAgeMinutes:60}
 };
}
module.exports={buildSelection,resolveAdaptiveSelectionThreshold};
