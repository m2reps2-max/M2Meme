'use strict';

const FEATURES = ['activity','momentum','market','liquidityQuality','security','earlyBuyerSignal','walletReputationSignal','timing'];
const VALIDATION_HORIZONS = ['15m','1h','6h','24h','7d'];
const ENTRY_SLIPPAGE = 0.005;
const EXIT_SLIPPAGE = 0.005;
const FEE_RATE = 0.003;
const MIN_OBSERVATIONS = 250;
const MIN_TRAINING = 200;
const MIN_VALIDATION = 50;
const MIN_TOP_SAMPLE = 15;

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function median(values) {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  return Number((sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2).toFixed(2));
}
function netReturnPct(grossReturnPct) {
  const grossMultiplier=Math.max(0,1+grossReturnPct/100);
  const netMultiplier=grossMultiplier*(1-EXIT_SLIPPAGE)*(1-FEE_RATE)/((1+ENTRY_SLIPPAGE)*(1+FEE_RATE));
  return (netMultiplier-1)*100;
}
function metrics(rows) {
  const returns=rows.map(row=>Number(row.returnPct)).filter(Number.isFinite);
  const gross=rows.map(row=>Number(row.grossReturnPct)).filter(Number.isFinite);
  const losses=returns.filter(value=>value<=-20).length;
  return {
    tokens:returns.length,
    averageReturnPct:returns.length?Number((returns.reduce((sum,value)=>sum+value,0)/returns.length).toFixed(2)):null,
    grossAverageReturnPct:gross.length?Number((gross.reduce((sum,value)=>sum+value,0)/gross.length).toFixed(2)):null,
    medianReturnPct:median(returns),
    positive15Pct:returns.length?Number((returns.filter(value=>value>=15).length/returns.length*100).toFixed(1)):null,
    loss20Pct:returns.length?Number((losses/returns.length*100).toFixed(1)):null
  };
}
function metricsForHorizon(rows,horizon) {
  return metrics(rows.filter(row=>finite(row.outcomes?.[horizon])).map(row=>({
    returnPct:row.outcomes[horizon],
    grossReturnPct:row.grossOutcomes?.[horizon]
  })));
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
      const rawOne=forecast?.outcomes?.['1h']?.returnPct;
      const grossOne=Number(rawOne),at=Number(forecast?.at),features=forecast?.features;
      if(rawOne===null||rawOne===undefined||!Number.isFinite(grossOne)||!Number.isFinite(at)||!features||typeof features!=='object')continue;
      const values={};
      for(const key of FEATURES){const raw=features[key];if(typeof raw==='number'&&Number.isFinite(raw))values[key]=clamp(raw,0,100);}
      if(Object.keys(values).length<4)continue;
      const grossOutcomes={},outcomes={};
      for(const horizon of VALIDATION_HORIZONS){
        const raw=forecast.outcomes?.[horizon]?.returnPct;
        if(raw===null||raw===undefined||!Number.isFinite(Number(raw)))continue;
        const gross=clamp(Number(raw),-1000,1000);
        grossOutcomes[horizon]=gross;
        outcomes[horizon]=clamp(netReturnPct(gross),-1000,1000);
      }
      const row={
        mint,at,returnPct:outcomes['1h'],grossReturnPct:grossOutcomes['1h'],
        outcomes,grossOutcomes,
        score:forecast.score!==null&&forecast.score!==undefined&&finite(Number(forecast.score))?Number(forecast.score):null,
        features:values
      };
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
    const raw=row.features[key],coefficient=model.coefficients[key],mean=model.means?.[key],std=model.stds?.[key];
    if(typeof raw!=='number'||!finite(raw)||!finite(coefficient)||!finite(mean)||!finite(std)||std<=0)continue;
    const weight=Math.abs(coefficient);
    if(weight<0.005)continue;
    weighted+=clamp((raw-mean)/std,-3,3)*coefficient;
    totalWeight+=weight;used++;
  }
  if(used<4||totalWeight<=0)return null;
  return Number(clamp(50+(weighted/totalWeight)*22,0,100).toFixed(2));
}
function buildAdaptiveModel(tokens) {
  const rows=extractRows(tokens);
  const split=Math.floor(rows.length*0.8),training=rows.slice(0,split),validation=rows.slice(split);
  const empty={
    status:rows.length<MIN_OBSERVATIONS?'insufficient_sample':'not_validated',enabled:false,
    observations:rows.length,trainingTokens:training.length,validationTokens:validation.length,
    features:[],holdout:null,
    reason:rows.length<MIN_OBSERVATIONS?'Il faut au moins 250 tokens distincts résolus à 1 h, avec quatre facteurs enregistrés.':'Le modèle attend une validation chronologique indépendante suffisante.'
  };
  if(training.length<MIN_TRAINING||validation.length<MIN_VALIDATION)return empty;
  const means={},stds={},coefficients={},importance=[];
  for(const key of FEATURES){
    const pairs=training.filter(row=>finite(row.features[key]));
    if(pairs.length<Math.max(80,Math.floor(training.length*0.35)))continue;
    const values=pairs.map(row=>row.features[key]),mean=values.reduce((a,b)=>a+b,0)/values.length;
    const variance=values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length,std=Math.sqrt(variance);
    if(std<1)continue;
    const correlation=pearson(values,pairs.map(row=>row.returnPct)),shrinkage=pairs.length/(pairs.length+50);
    means[key]=Number(mean.toFixed(3));stds[key]=Number(std.toFixed(3));
    coefficients[key]=Number((correlation*shrinkage).toFixed(5));
    importance.push({key,correlation:Number(correlation.toFixed(3)),samples:pairs.length,weight:coefficients[key]});
  }
  if(importance.length<4)return {...empty,reason:'Moins de quatre facteurs disposent d’assez de variation et d’observations.'};
  const model={means,stds,coefficients};
  const scored=rows.map(row=>({...row,predictedScore:applyModel(row,model)}))
    .filter(row=>row.predictedScore!==null&&row.score!==null);
  const trainingEnd=training[training.length-1].at;
  const validationScored=scored.filter(row=>row.at>trainingEnd);
  if(validationScored.length<MIN_VALIDATION)return {...empty,features:importance.sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight)),reason:'Échantillon de validation insuffisant après exclusion des observations sans score fixe comparable.'};
  const topCount=Math.max(MIN_TOP_SAMPLE,Math.ceil(validationScored.length*0.3));
  if(validationScored.length-topCount<10)return {...empty,features:importance.sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight)),reason:'Il faut conserver au moins dix observations témoins en dehors du top sélectionné.'};
  const top=validationScored.slice().sort((a,b)=>b.predictedScore-a.predictedScore||a.mint.localeCompare(b.mint)).slice(0,topCount);
  const staticTop=validationScored.slice().sort((a,b)=>b.score-a.score||a.mint.localeCompare(b.mint)).slice(0,topCount);
  const randomTop=validationScored.slice().sort((a,b)=>stableHash(a.mint)-stableHash(b.mint)).slice(0,topCount);
  const topMetrics=metrics(top),staticMetrics=metrics(staticTop),randomMetrics=metrics(randomTop),allMetrics=metrics(validationScored);
  const upliftVsStatic=topMetrics.averageReturnPct!==null&&staticMetrics.averageReturnPct!==null?Number((topMetrics.averageReturnPct-staticMetrics.averageReturnPct).toFixed(2)):null;
  const upliftVsRandom=topMetrics.averageReturnPct!==null&&randomMetrics.averageReturnPct!==null?Number((topMetrics.averageReturnPct-randomMetrics.averageReturnPct).toFixed(2)):null;
  const horizonHoldout={};
  for(const horizon of VALIDATION_HORIZONS){
    const topH=metricsForHorizon(top,horizon),staticH=metricsForHorizon(staticTop,horizon),randomH=metricsForHorizon(randomTop,horizon);
    const upliftStatic=topH.averageReturnPct!==null&&staticH.averageReturnPct!==null?Number((topH.averageReturnPct-staticH.averageReturnPct).toFixed(2)):null;
    const upliftRandom=topH.averageReturnPct!==null&&randomH.averageReturnPct!==null?Number((topH.averageReturnPct-randomH.averageReturnPct).toFixed(2)):null;
    horizonHoldout[horizon]={top:topH,staticScoreTop:staticH,randomSameSize:randomH,upliftVsStaticPctPoints:upliftStatic,upliftVsRandomPctPoints:upliftRandom};
  }
  const enabled=top.length>=MIN_TOP_SAMPLE&&topMetrics.averageReturnPct>0&&upliftVsStatic>=5&&upliftVsRandom>=5
    &&topMetrics.loss20Pct<=Math.min(35,(staticMetrics.loss20Pct??100)+3);
  return {
    status:enabled?'validated':'not_validated',enabled,
    observations:rows.length,trainingTokens:training.length,validationTokens:validationScored.length,
    features:importance.sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight)).map(item=>({...item,weight:Number(item.weight.toFixed(4))})),
    coefficients,means,stds,
    holdout:{
      top:topMetrics,staticScoreTop:staticMetrics,randomSameSize:randomMetrics,all:allMetrics,
      selectedTokens:top.length,comparisonSampleSize:validationScored.length,
      upliftVsStaticPctPoints:upliftVsStatic,upliftVsRandomPctPoints:upliftVsRandom,horizons:horizonHoldout
    },
    trainingPeriod:{from:new Date(training[0].at).toISOString(),to:new Date(training[training.length-1].at).toISOString()},
    validationPeriod:{from:new Date(validationScored[0].at).toISOString(),to:new Date(validationScored[validationScored.length-1].at).toISOString()},
    evaluation:{
      returnBasis:'net_simulated',entrySlippagePct:ENTRY_SLIPPAGE*100,exitSlippagePct:EXIT_SLIPPAGE*100,
      feePerSidePct:FEE_RATE*100,minimumObservations:MIN_OBSERVATIONS,minimumTraining:MIN_TRAINING,
      minimumValidation:MIN_VALIDATION,minimumTopSample:MIN_TOP_SAMPLE
    },
    reason:enabled?'Le classement appris surpasse le score fixe et un témoin aléatoire sur un holdout chronologique, après frais et slippage simulés.':'Le modèle ne surperforme pas assez clairement le score fixe et le témoin aléatoire; le classement actuel reste inchangé.',
    limitations:'Validation chronologique par token sur les 80% les plus anciens et les 20% les plus récents. Les rendements sont nets de frais et slippage fixes simulés, mais ne reproduisent ni liquidité disponible, ni impact de marché, ni exécution réelle. Biais de survivance possible : seuls les tokens découverts et conservés par le scanner sont représentés.'
  };
}
function scoreCandidate(token,model) {
  if(!model?.enabled)return null;
  const features=token?.analysis?.factors||{};
  return applyModel({features},model);
}
module.exports={FEATURES,VALIDATION_HORIZONS,buildAdaptiveModel,scoreCandidate,netReturnPct};
