'use strict';
const HORIZONS=[['15m',900000],['1h',3600000],['6h',21600000],['24h',86400000],['7d',604800000]];
const n=v=>Number.isFinite(Number(v))?Number(v):null;
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
   if(f.outcomes[key]||snap.at<f.at+ms||snap.at-f.at>ms+Math.max(180000,ms*.35))continue;
   if(!(f.priceUsd>0&&snap.priceUsd>=0))continue;
   const ret=snap.priceUsd>0?(snap.priceUsd/f.priceUsd-1)*100:-100;
   const liq=f.liquidityUsd>0&&snap.liquidityUsd>=0?(snap.liquidityUsd/f.liquidityUsd-1)*100:null;
   const maxFavorable=f.priceUsd>0&&Number.isFinite(f.path?.maxPrice)?(f.path.maxPrice/f.priceUsd-1)*100:null;
   const maxAdverse=f.priceUsd>0&&Number.isFinite(f.path?.minPrice)?(f.path.minPrice/f.priceUsd-1)*100:null;
   const label=liq!==null&&liq<=-60?'liquidity_collapse':liq!==null&&liq<=-30?'liquidity_stress':ret>=50?'strong_win':ret>=15?'win':ret<=-50?'severe_loss':ret<=-20?'loss':ret<=-8?'drawdown':'flat';
   f.outcomes[key]={observedAt:snap.at,delayMs:snap.at-f.at,returnPct:Number(ret.toFixed(2)),maxFavorablePct:maxFavorable===null?null:Number(maxFavorable.toFixed(2)),maxAdversePct:maxAdverse===null?null:Number(maxAdverse.toFixed(2)),liquidityChangePct:liq===null?null:Number(liq.toFixed(2)),volumeChangePct:f.volume1h>0?Number(((snap.volume1h/f.volume1h-1)*100).toFixed(1)):null,label};
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
 token.forecasts.push({id:token.mint+':'+snap.at,at:snap.at,priceUsd:snap.priceUsd,liquidityUsd:snap.liquidityUsd,volume1h:snap.volume1h,volume24h:snap.volume24h,buys1h:snap.buys1h,sells1h:snap.sells1h,fdv:snap.fdv,score:snap.score,coverage:snap.coverage,classification:snap.classification,risk:snap.risk||'unknown',flags:snap.flags||[],outcomes:{},path:{maxPrice:snap.priceUsd,minPrice:snap.priceUsd,minLiquidity:snap.liquidityUsd}});
 token.forecasts=token.forecasts.slice(-700);
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
 const rugLike=strongSignals.filter(x=>['liquidity_stress','liquidity_collapse','severe_loss'].includes(x.outcomes['1h'].label));
 const falsePositiveAnalysis={strongSignals:strongSignals.length,rugLikeOrSevereLoss:rugLike.length,ratePct:strongSignals.length?Number((rugLike.length/strongSignals.length*100).toFixed(1)):null,definition:'Parmi les prévisions de score >=65 résolues à 1h, part ayant subi une forte perte ou une forte baisse de liquidité. Ce proxy ne prouve pas un rug.'};
 const eligible=calibration.filter(x=>['65–79','80–100'].includes(x.label)&&x.resolved1h>=30&&x.winRate1hPct>=60&&x.lossRate1hPct<=25&&x.average1hPct>0).sort((a,b)=>a.label==='65–79'?-1:1);
 const recommended=eligible[0]||null;
 const adaptiveThreshold=recommended?(recommended.label==='65–79'?65:80):null;
 return {successRate,falsePositiveAnalysis,adaptiveThreshold,summary:{forecasts:rows.length,resolvedForecasts:resolved,trackedTokens:new Set(rows.map(x=>x.mint)).size,horizons},calibration,labels,recommendation:recommended?{bestObservedScoreBand:recommended.label,winRate1hPct:recommended.winRate1hPct,samples:recommended.resolved1h,automaticScoringChanges:false,criteria:'30+ résultats à 1 h, au moins 60% gagnants, au plus 25% perdants et rendement moyen positif'}:null,recent:rows.slice(-100).reverse().map(x=>({symbol:x.symbol,score:x.score,at:new Date(x.at).toISOString(),outcomes:x.outcomes})),method:'Chaque prévision est figée au moment du scan puis évaluée avec la première observation disponible après chaque horizon. Les résultats ne sont pas des trades exécutés : aucun slippage, frais, impact de marché ou possibilité réelle de vente n’est modélisé. Les horizons sont résolus avec tolérance temporelle.',horizonsAvailable:HORIZONS.map(x=>x[0])};
}
module.exports={recordForecast,learningSummary};
