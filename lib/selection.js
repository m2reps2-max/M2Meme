'use strict';

const { scoreCandidate } = require('./adaptive-model');
const { qualifyOpportunity, assessOpportunityEvidence, MAX_STATIC_SECURITY_EVIDENCE_AGE_MINUTES, MAX_SECURITY_EVIDENCE_AGE_MINUTES, MAX_TRADE_EVIDENCE_AGE_MINUTES, MAX_SELLABILITY_EVIDENCE_AGE_MINUTES } = require('./alert-quality');
const { evaluateMomentumRisk } = require('./momentum-risk');
function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function linked(token){return Boolean(token?.pairAddress||token?.geckoPoolAddress);}
function factorSet(token,keys){const factors=token?.analysis?.factors||{};return keys.every(key=>finite(factors[key]));}
function hasVerifiedDemand(token,now){
 const trade=token?.tradeIntel||{};
 const geckoAge=ageMinutes(trade.checkedAt,now),rpcAge=ageMinutes(trade.rpcConfirmedCheckedAt,now),lastTradeAge=ageMinutes(trade.rpcConfirmedLastTradeAt,now);
 const geckoCount=Number(trade.tradeCount),rpcCount=Number(trade.rpcConfirmedTradeCount),buyers=Number(trade.rpcConfirmedUniqueBuyers);
 const volumeCoverage=Number(trade.rpcConfirmedVolumeCoverage),buy=Number(trade.rpcConfirmedBuyVolumeUsd),sell=Number(trade.rpcConfirmedSellVolumeUsd);
 return geckoAge!==null&&geckoAge<=MAX_TRADE_EVIDENCE_AGE_MINUTES&&rpcAge!==null&&rpcAge<=MAX_TRADE_EVIDENCE_AGE_MINUTES&&lastTradeAge!==null&&lastTradeAge<=MAX_TRADE_EVIDENCE_AGE_MINUTES
  &&Number.isFinite(geckoCount)&&geckoCount>=20&&Number.isFinite(rpcCount)&&rpcCount>=5&&Number.isFinite(buyers)&&buyers>=5
  &&Number.isFinite(volumeCoverage)&&volumeCoverage>=80&&Number.isFinite(buy)&&buy>=0&&Number.isFinite(sell)&&sell>=0&&buy+sell>0&&buy>=sell;
}
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
 const marketAgeMinutes=ageMinutes(latest?.at,now)??ageMinutes(token?.marketObservedAt,now);
 const evidence=assessOpportunityEvidence(token,now);
 return {
  marketAgeMinutes,
  securityAgeMinutes:evidence.securityAgeMinutes,
  staticSecurityAgeMinutes:evidence.staticSecurityAgeMinutes,
  dynamicSecurityAgeMinutes:evidence.dynamicSecurityAgeMinutes,
  staticSecurityFresh:evidence.staticSecurityFresh,
  dynamicSecurityFresh:evidence.dynamicSecurityFresh,
  transactionAgeMinutes:evidence.transactionAgeMinutes,
  sellabilityAgeMinutes:(()=>{const at=Date.parse(token.sellability?.checkedAt||'');return Number.isFinite(at)?Math.max(0,(now-at)/60000):null;})(),
  exitCapacityUsd:finite(token.analysis?.exitCapacityUsd)?token.analysis.exitCapacityUsd:null
 };
}
function rank(a,b,model){
 const learnedA=scoreCandidate(a,model),learnedB=scoreCandidate(b,model);
 const scoreA=(learnedA===null?Number(a.analysis?.score||0):Number(a.analysis?.score||0)*0.7+learnedA*0.3)+evaluateMomentumRisk(a).adjustment;
 const scoreB=(learnedB===null?Number(b.analysis?.score||0):Number(b.analysis?.score||0)*0.7+learnedB*0.3)+evaluateMomentumRisk(b).adjustment;
 return scoreB-scoreA||Number(b.liquidityUsd||0)-Number(a.liquidityUsd||0)||Number(b.volume?.h1||0)-Number(a.volume?.h1||0);
}
function card(token,now,model){
 const a=token.analysis||{},f=freshness(token,now),momentumRisk=evaluateMomentumRisk(token);
 return {
  mint:token.mint,name:token.name,symbol:token.symbol,
  pairAddress:token.pairAddress||null,geckoPoolAddress:token.geckoPoolAddress||null,
  liquidityUsd:finite(token.liquidityUsd)?token.liquidityUsd:null,
  volume:{h1:finite(token.volume?.h1)?token.volume.h1:null},
  txns:{h1:{buys:finite(token.txns?.h1?.buys)?token.txns.h1.buys:null,sells:finite(token.txns?.h1?.sells)?token.txns.h1.sells:null}},
  launchPhase:a.launchPhase||'unknown',launchAgeHours:finite(a.launchAgeHours)?a.launchAgeHours:null,exitCapacityUsd:finite(a.exitCapacityUsd)?a.exitCapacityUsd:null,
  analysis:{
   score:finite(a.score)?a.score:null,learnedScore:scoreCandidate(token,model),coverage:finite(a.coverage)?a.coverage:0,
   risk:a.risk||'unknown',securityComprehensive:a.securityComprehensive===true,securityPublicationReady:a.securityPublicationReady===true,
   hardBlocked:a.hardBlocked===true,externalSecurity:a.externalSecurity||null,
   factors:Object.fromEntries(['activity','momentum','market','liquidityQuality','executionQuality','security','demandQuality','earlyBuyerSignal','walletReputationSignal','social'].filter(k=>finite(a.factors?.[k])).map(k=>[k,a.factors[k]]))
  },
  freshness:f,
  momentumRisk
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
 const requireComprehensiveSecurity=settings.requireComprehensiveSecurity===true;
 const all=Array.isArray(input)?input:Object.values(input||{});
 const eligible=all.filter(linked);
 const early=all.filter(t=>!linked(t)&&Boolean(t.launchSource||t.pumpCreatedAt||t.launchCreatedAt)&&t.analysis?.hardBlocked!==true&&t.analysis?.risk!=='high').map(t=>({token:t,age:ageMinutes(t.launchCreatedAt||t.pumpCreatedAt||t.firstSeenAt,now)})).filter(x=>x.age!==null&&x.age<=30).sort((a,b)=>a.age-b.age).slice(0,5).map(x=>earlyCard(x.token,now));
 const candidates=eligible.filter(t=>!t.analysis?.hardBlocked&&t.analysis?.risk!=='high'&&t.analysis?.risk!=='unknown');
 const freshnessRows=candidates.map(token=>({token,age:freshness(token,now)}));
 const marketMetricsFresh=token=>{
  const volumeAge=ageMinutes(token?.marketFieldsObservedAt?.volumeH1,now),transactionsAge=ageMinutes(token?.marketFieldsObservedAt?.txnsH1,now);
  return volumeAge!==null&&volumeAge<=15&&transactionsAge!==null&&transactionsAge<=15;
 };
 const freshForBest=freshnessRows.filter(x=>x.age.marketAgeMinutes!==null&&x.age.marketAgeMinutes<=5&&marketMetricsFresh(x.token));
 const freshForWatch=freshnessRows.filter(x=>x.age.marketAgeMinutes!==null&&x.age.marketAgeMinutes<=15
  &&(x.age.staticSecurityAgeMinutes===null||x.age.staticSecurityAgeMinutes<=MAX_STATIC_SECURITY_EVIDENCE_AGE_MINUTES)
  &&(x.age.dynamicSecurityAgeMinutes===null||x.age.dynamicSecurityAgeMinutes<=MAX_SECURITY_EVIDENCE_AGE_MINUTES));
 const qualificationSettings={...settings,minScore,minCoverage,minLiquidityUsd,minVolume1hUsd,minTransactions1h,minBuyRatioPct,maxFdvLiquidityRatio,requireComprehensiveSecurity};
 const best=freshForBest.filter(({token:t,age})=>
  qualifyOpportunity(t,qualificationSettings).eligible
   &&t.earlyBuyerExitSummary?.alert!==true
   &&!evaluateMomentumRisk(t).blockPublication
   &&(t.analysis?.securityPublicationReady===true||t.analysis?.securityComprehensive===true)
   &&age.staticSecurityAgeMinutes!==null&&age.staticSecurityAgeMinutes<=MAX_STATIC_SECURITY_EVIDENCE_AGE_MINUTES
   &&age.dynamicSecurityAgeMinutes!==null&&age.dynamicSecurityAgeMinutes<=MAX_SECURITY_EVIDENCE_AGE_MINUTES
   &&age.transactionAgeMinutes!==null&&age.transactionAgeMinutes<=MAX_TRADE_EVIDENCE_AGE_MINUTES
   &&age.sellabilityAgeMinutes!==null&&age.sellabilityAgeMinutes<=MAX_SELLABILITY_EVIDENCE_AGE_MINUTES
   &&age.exitCapacityUsd!==null&&age.exitCapacityUsd>=50
   &&hasVerifiedDemand(t,now)
   &&factorSet(t,['activity','momentum','market','liquidityQuality','executionQuality','security','demandQuality'])
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
  bestRejectedStaleMarketMetrics:freshnessRows.filter(x=>!marketMetricsFresh(x.token)).length,
  bestRejectedStaleSecurity:freshnessRows.filter(x=>x.age.dynamicSecurityAgeMinutes===null||x.age.dynamicSecurityAgeMinutes>MAX_SECURITY_EVIDENCE_AGE_MINUTES).length,
  bestRejectedStaleStaticSecurity:freshnessRows.filter(x=>x.age.staticSecurityAgeMinutes===null||x.age.staticSecurityAgeMinutes>MAX_STATIC_SECURITY_EVIDENCE_AGE_MINUTES).length,
  bestRejectedStaleTransactions:freshnessRows.filter(x=>x.age.transactionAgeMinutes===null||x.age.transactionAgeMinutes>MAX_TRADE_EVIDENCE_AGE_MINUTES).length,
  bestRejectedMissingMomentumFactor:freshnessRows.filter(x=>!factorSet(x.token,['momentum'])).length,
  bestRejectedIncompleteSecurity:freshnessRows.filter(x=>x.token.analysis?.securityPublicationReady!==true&&x.token.analysis?.securityComprehensive!==true).length,
  bestRejectedMissingDemandFactor:freshnessRows.filter(x=>!finite(x.token.analysis?.factors?.demandQuality)).length,
  bestRejectedUnverifiedDemand:freshnessRows.filter(x=>!hasVerifiedDemand(x.token,now)).length,
  bestRejectedMissingExitQuote:freshnessRows.filter(x=>x.age.sellabilityAgeMinutes===null||x.age.sellabilityAgeMinutes>MAX_SELLABILITY_EVIDENCE_AGE_MINUTES||x.age.exitCapacityUsd===null||x.age.exitCapacityUsd<50).length,
  bestRejectedEarlyBuyerExits:freshnessRows.filter(x=>x.token.earlyBuyerExitSummary?.alert===true).length,
  momentumExtended:freshnessRows.filter(x=>evaluateMomentumRisk(x.token).detectors.extendedMove).length,
  momentumExhaustion:freshnessRows.filter(x=>evaluateMomentumRisk(x.token).detectors.exhaustion).length,
  momentumSelloffBlocked:freshnessRows.filter(x=>evaluateMomentumRisk(x.token).blockPublication).length
 };
 return {
  best:best.map(t=>card(t,now,options.adaptiveModel)),observe:observe.map(t=>card(t,now,options.adaptiveModel)),early,
  eligible:eligible.length,considered:all.length,diagnostics,
  qualityGate:{profile:settings.preset||'elite',bestMinScore:minScore,bestMinCoverage:null,coverageUsedForBest:false,watchMinCoverage:Math.max(55,minCoverage-15),bestMinLiquidityUsd:minLiquidityUsd,bestMinVolume1hUsd:minVolume1hUsd,bestMinTransactions1h:minTransactions1h,bestMinBuyRatioPct:minBuyRatioPct,bestMaxFdvLiquidityRatio:maxFdvLiquidityRatio,requireComprehensiveSecurity:true,bestRequiresVerifiedHolderAccountSample:true,bestRequiresFullyResolvedOwnerMapping:false,bestMarketMaxAgeMinutes:5,bestMarketMetricsMaxAgeMinutes:15,watchMarketMaxAgeMinutes:15,bestStaticSecurityMaxAgeMinutes:MAX_STATIC_SECURITY_EVIDENCE_AGE_MINUTES,bestDynamicSecurityMaxAgeMinutes:MAX_SECURITY_EVIDENCE_AGE_MINUTES,bestTransactionsMaxAgeMinutes:MAX_TRADE_EVIDENCE_AGE_MINUTES,bestRequiresFreshExitQuote:true,bestMinimumExitCapacityUsd:50,bestSellabilityMaxAgeMinutes:MAX_SELLABILITY_EVIDENCE_AGE_MINUTES,bestRequiresVerifiedDemand:true,bestMinimumTradeSample:20,bestMinimumUniqueBuyers:5,bestMinimumBuyVolumeRatio:1,bestRequiresDemandFactor:true,bestRequiresExecutionQuality:true,watchSecurityMaxAgeMinutes:MAX_SECURITY_EVIDENCE_AGE_MINUTES,requireExternalSecurity:false,bestRequiresComprehensiveSecurity:true,bestRequiresNoConfirmedEarlyBuyerExits:true}
 };
}
module.exports={buildSelection,resolveAdaptiveSelectionThreshold,hasVerifiedDemand};
