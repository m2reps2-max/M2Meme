'use strict';

const FEATURES = ['activity','momentum','market','liquidityQuality','security','earlyBuyerSignal','walletReputationSignal','timing'];

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  const mid = Math.floor(sorted.length/2);
  return Number((sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2).toFixed(2));
}
function metrics(rows) {
  const returns=rows.map(row=>Number(row.returnPct)).filter(Number.isFinite);
  const losses=returns.filter(value=>value<=-20).length;
  return {
    tokens:returns.length,
    averageReturnPct:returns.length?Number((returns.reduce((sum,value)=>sum+value,0)/returns.length).toFixed(2)):null,
    medianReturnPct:median(returns),
    positive15Pct:returns.length?Number((returns.filter(value=>value>=15).length/returns.length*100).toFixed(1)):null,
    loss20Pct:returns.length?Number((losses/returns.length*100).toFixed(1)):null
  };
}
function stableHash(value) {
  let hash=2166136261;
  for(const char of String(value||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}
function pearson(xs,ys) {
  if(xs.length<3||xs.length!==ys.length)return 0;
  const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
  let numerator=0,dx=0,dy=0;
  for(let i=0;i<xs.length;i++){const x=xs[i]-mx,y=ys[i]-my;numerator+=x*y;dx+=x*x;dy+=y*y;}
  return dx>0&&dy>0?clamp(numerator/Math.sqrt(dx*dy),-1,1):0;
}
function extractRows(tokens) {
  const byMint=new Map();
  for(const token of Object.values(tokens||{})){
    const mint=String(token?.mint||'');
    if(!mint)continue;
    for(const forecast of Array.isArray(token.forecasts)?token.forecasts:[]){
      const outcome=forecast?.outcomes?.['1h'];
      const returned=Number(outcome?.returnPct);
      const at=Number(forecast?.at);
      const features=forecast?.features;
      if(!outcome||!Number.isFinite(returned)||!Number.isFinite(at)||!features||typeof features!=='object')continue;
      const values={};
      for(const key of FEATURES){const value=Number(features[key]);if(finite(value))values[key]=clamp(value,0,100);}
      if(Object.keys(values).length<4)continue;
      const row={mint,at,returnPct:clamp(returned,-1000,1000),score:forecast.score!==null&&forecast.score!==undefined&&finite(Number(forecast.score))?Number(forecast.score):null,features:values};
      const prior=byMint.get(mint);
      if(!prior||at<prior.at)byMint.set(mint,row);
    }
  }
  return [...byMint.values()].sort((a,b)=>a.at-b.at||a.mint.localeCompare(b.mint));
}
function applyModel(row,model) {
  if(!row?.features||!model?.coefficients)return null;
  let weighted=0,totalWeight=0,used=0;
  for(const key of FEATURES){
    const value=Number(row.features[key]),coefficient=Number(model.coefficients[key]);
    const mean=Number(model.means?.[key]),std=Number(model.stds?.[key]);
    if(!finite(value)||!finite(coefficient)||!finite(mean)||!finite(std)||std<=0)continue;
    const weight=Math.abs(coefficient);
    if(weight<0.005)continue;
    weighted+=clamp((value-mean)/std,-3,3)*coefficient;
    totalWeight+=weight;used++;
  }
  if(used<4||totalWeight<=0)return null;
  return Number(clamp(50+(weighted/totalWeight)*22,0,100).toFixed(2));
}
function buildAdaptiveModel(tokens) {
  const rows=extractRows(tokens);
  const split=Math.floor(rows.length*0.8);
  const training=rows.slice(0,split),validation=rows.slice(split);
  const empty={status:rows.length<100?'insufficient_sample':'not_validated',enabled:false,observations:rows.length,trainingTokens:training.length,validationTokens:validation.length,features:[],holdout:null,reason:rows.length<100?'Il faut au moins 100 tokens distincts avec résultat à 1 h et au moins quatre facteurs enregistrés.':'Le modèle attend une validation hors échantillon suffisante.'};
  if(training.length<80||validation.length<30)return empty;
  const returns=training.map(row=>row.returnPct);
  const means={},stds={},coefficients={},importance=[];
  for(const key of FEATURES){
    const pairs=training.filter(row=>finite(row.features[key]));
    if(pairs.length<Math.max(40,Math.floor(training.length*0.35)))continue;
    const values=pairs.map(row=>row.features[key]),mean=values.reduce((a,b)=>a+b,0)/values.length;
    const variance=values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length;
    const std=Math.sqrt(variance);
    if(std<1)continue;
    const correlation=pearson(values,pairs.map(row=>row.returnPct));
    const shrinkage=pairs.length/(pairs.length+50);
    means[key]=Number(mean.toFixed(3));
    stds[key]=Number(std.toFixed(3));
    coefficients[key]=Number((correlation*shrinkage).toFixed(5));
    importance.push({key,correlation:Number(correlation.toFixed(3)),samples:pairs.length,weight:coefficients[key]});
  }
  if(importance.length<4)return {...empty,reason:'Moins de quatre facteurs disposent d’assez de variation et d’observations.'};
  const model={means,stds,coefficients};
  const scored=rows.map(row=>({...row,predictedScore:applyModel(row,model)})).filter(row=>row.predictedScore!==null);
  const trainScored=scored.filter(row=>row.at<=training[training.length-1].at);
  const validationScored=scored.filter(row=>row.at>training[training.length-1].at);
  const topCount=Math.max(10,Math.ceil(validationScored.length*0.3));
  if(validationScored.length<30||validationScored.length-topCount<5)return {...empty,features:importance.sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight)),reason:'Échantillon de validation insuffisant après exclusion des observations incomplètes.'};
  const top=validationScored.slice().sort((a,b)=>b.predictedScore-a.predictedScore||a.mint.localeCompare(b.mint)).slice(0,topCount);
  const staticTop=validationScored.filter(row=>row.score!==null).slice().sort((a,b)=>b.score-a.score||a.mint.localeCompare(b.mint)).slice(0,top.length);
  const randomTop=validationScored.slice().sort((a,b)=>stableHash(a.mint)-stableHash(b.mint)).slice(0,top.length);
  const topMetrics=metrics(top),staticMetrics=metrics(staticTop),randomMetrics=metrics(randomTop),allMetrics=metrics(validationScored);
  const upliftVsStatic=topMetrics.averageReturnPct!==null&&staticMetrics.averageReturnPct!==null?Number((topMetrics.averageReturnPct-staticMetrics.averageReturnPct).toFixed(2)):null;
  const upliftVsRandom=topMetrics.averageReturnPct!==null&&randomMetrics.averageReturnPct!==null?Number((topMetrics.averageReturnPct-randomMetrics.averageReturnPct).toFixed(2)):null;
  const enabled=top.length>=10&&topMetrics.averageReturnPct>0&&upliftVsStatic>=3&&upliftVsRandom>=3&&topMetrics.loss20Pct<=Math.min(40,(staticMetrics.loss20Pct??100)+5);
  return {
    status:enabled?'validated':'not_validated',enabled,
    observations:rows.length,trainingTokens:training.length,validationTokens:validationScored.length,
    features:importance.sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight)).map(item=>({...item,weight:Number(item.weight.toFixed(4))})),
    coefficients,means,stds,
    holdout:{top:topMetrics,staticScoreTop:staticMetrics,randomSameSize:randomMetrics,all:allMetrics,selectedTokens:top.length,upliftVsStaticPctPoints:upliftVsStatic,upliftVsRandomPctPoints:upliftVsRandom},
    trainingPeriod:{from:new Date(training[0].at).toISOString(),to:new Date(training[training.length-1].at).toISOString()},
    validationPeriod:{from:new Date(validationScored[0].at).toISOString(),to:new Date(validationScored[validationScored.length-1].at).toISOString()},
    reason:enabled?'Le classement appris sur les données anciennes surperforme le score fixe et une sélection aléatoire sur la période récente.':'Le modèle ne surperforme pas assez clairement le score fixe et le témoin aléatoire; le classement actuel reste inchangé.',
    limitations:'Modèle descriptif léger fondé sur les facteurs enregistrés au moment du signal. Validation chronologique par token, mais l’univers reste limité aux tokens découverts et observés. Les rendements sont des variations de prix, pas des profits exécutables nets de frais et de slippage.'
  };
}
function scoreCandidate(token,model) {
  if(!model?.enabled)return null;
  const features=token?.analysis?.factors||{};
  return applyModel({features},model);
}
module.exports={FEATURES,buildAdaptiveModel,scoreCandidate};
