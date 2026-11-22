'use strict';

const HORIZONS=[['15m',900000,600000],['1h',3600000,1200000],['6h',21600000,3600000],['24h',86400000,14400000],['7d',604800000,86400000]];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const stableHash=value=>{let hash=2166136261;for(const char of String(value||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;};
function capture(token,category,at){
 if(!(finite(token.priceUsd)&&token.priceUsd>0&&finite(token.liquidityUsd)&&token.liquidityUsd>0))return null;
 return {mint:token.mint,category,at,priceUsd:token.priceUsd,liquidityUsd:token.liquidityUsd,score:finite(token.analysis?.score)?token.analysis.score:null,coverage:finite(token.analysis?.coverage)?token.analysis.coverage:null,volume1h:finite(token.volume?.h1)?token.volume.h1:null,outcomes:{}};
}
function evaluateRow(row,token,now){
 const forecasts=(token?.forecasts||[]).filter(x=>finite(x.at)&&x.at>=row.at&&finite(x.priceUsd)&&x.priceUsd>0).sort((a,b)=>a.at-b.at);
 if(!forecasts.length)return;
 for(const [key,ms,tolerance] of HORIZONS){
  if(row.outcomes[key]||row.missed?.[key])continue;
  const target=row.at+ms;
  if(now<target-tolerance)continue;
  let closest=null,distance=Infinity;
  for(const sample of forecasts){
   const delta=Math.abs(sample.at-target);
   if(delta<=tolerance&&delta<distance){closest=sample;distance=delta;}
   if(sample.at>target+tolerance)break;
  }
  if(!closest){
   if(now>target+tolerance)row.missed={...(row.missed||{}),[key]:true};
   continue;
  }
  const path=forecasts.filter(x=>x.at<=closest.at);
  const prices=path.map(x=>x.priceUsd).filter(x=>finite(x)&&x>0);
  const minLiquidity=path.map(x=>x.liquidityUsd).filter(x=>finite(x)&&x>=0);
  const ret=(closest.priceUsd/row.priceUsd-1)*100;
  const liq=finite(closest.liquidityUsd)?(closest.liquidityUsd/row.liquidityUsd-1)*100:null;
  const maxFavorable=prices.length?(Math.max(...prices)/row.priceUsd-1)*100:null;
  const maxAdverse=prices.length?(Math.min(...prices)/row.priceUsd-1)*100:null;
  const label=liq!==null&&liq<=-60?'liquidity_collapse':ret>=50?'strong_win':ret>=15?'win':ret<=-50?'severe_loss':ret<=-20?'loss':ret<=-8?'drawdown':'flat';
  row.outcomes[key]={observedAt:closest.at,delayMs:closest.at-target,returnPct:Number(ret.toFixed(2)),maxFavorablePct:maxFavorable===null?null:Number(maxFavorable.toFixed(2)),maxAdversePct:maxAdverse===null?null:Number(maxAdverse.toFixed(2)),liquidityChangePct:liq===null?null:Number(liq.toFixed(2)),liquidityFailure:liq!==null&&liq<=-60,label};
 }
}
function updateSelectionCohorts(state,selection,now=Date.now()){
 state.selectionCohorts=Array.isArray(state.selectionCohorts)?state.selectionCohorts:[];
 const rows=state.selectionCohorts,byMint=new Map(rows.map(x=>[x.mint,x]));
 const tokens=state.tokens||{},selected=new Map();
 for(const [category,list] of [['best',selection?.best||[]],['watch',selection?.observe||[]]]){
  for(const card of list)if(card?.mint)selected.set(card.mint,category);
 }
 for(const [mint,category] of selected){
  const token=tokens[mint];if(!token)continue;
  const prior=byMint.get(mint);
  if(prior&&prior.category!=='baseline')continue;
  const fresh=capture(token,category,now);if(!fresh)continue;
  if(prior){Object.assign(prior,fresh);prior.promotedFromBaselineAt=now;}
  else{rows.push(fresh);byMint.set(mint,fresh);}
 }
 const candidates=Object.values(tokens).filter(t=>t?.mint&&(t.pairAddress||t.geckoPoolAddress)&&finite(t.priceUsd)&&t.priceUsd>0&&finite(t.liquidityUsd)&&t.liquidityUsd>0&&!selected.has(t.mint)&&!byMint.has(t.mint));
 const day=Math.floor(now/86400000);
 candidates.sort((a,b)=>stableHash(day+':'+a.mint)-stableHash(day+':'+b.mint));
 for(const token of candidates.slice(0,2)){
  const row=capture(token,'baseline',now);if(row){rows.push(row);byMint.set(token.mint,row);}
 }
 for(const row of rows){const token=tokens[row.mint];if(token)evaluateRow(row,token,now);}
 if(rows.length>500){
  const removable=rows.filter(x=>x.category==='baseline'&&Object.keys(x.outcomes||{}).length>0).sort((a,b)=>a.at-b.at);
  while(rows.length>500&&removable.length){const old=removable.shift();const i=rows.indexOf(old);if(i>=0)rows.splice(i,1);}
  while(rows.length>500){const completed=rows.filter(x=>Object.keys(x.outcomes||{}).length>0).sort((a,b)=>a.at-b.at);const old=completed[0]||rows[0];rows.splice(rows.indexOf(old),1);}
 }
 state.selectionCohortsUpdatedAt=new Date(now).toISOString();
}
function median(values){
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
 return Number((sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2).toFixed(2));
}
function buildSelectionPerformance(state){
 const rows=Array.isArray(state?.selectionCohorts)?state.selectionCohorts:[];
 const groups={};
 for(const category of ['best','watch','baseline']){
  const items=rows.filter(x=>x.category===category);
  const horizons={};
  for(const [key] of HORIZONS){
   const outcomes=items.map(x=>x.outcomes?.[key]).filter(x=>x&&finite(x.returnPct));
   const returns=outcomes.map(x=>x.returnPct);
   const drawdowns=outcomes.map(x=>x.maxAdversePct).filter(finite);
   const failures=outcomes.filter(x=>x.liquidityFailure).length;
   horizons[key]={resolved:outcomes.length,pending:items.filter(x=>!x.outcomes?.[key]&&!x.missed?.[key]).length,missed:items.filter(x=>x.missed?.[key]).length,positive15Pct:returns.length?Number((returns.filter(x=>x>=15).length/returns.length*100).toFixed(1)):null,averageReturnPct:returns.length?Number((returns.reduce((a,b)=>a+b,0)/returns.length).toFixed(2)):null,medianReturnPct:median(returns),loss20Pct:returns.length?Number((returns.filter(x=>x<=-20).length/returns.length*100).toFixed(1)):null,averageMaxDrawdownPct:drawdowns.length?Number((drawdowns.reduce((a,b)=>a+b,0)/drawdowns.length).toFixed(2)):null,liquidityFailurePct:returns.length?Number((failures/returns.length*100).toFixed(1)):null};
  }
  groups[category]={tokens:items.length,firstAt:items.length?new Date(Math.min(...items.map(x=>x.at))).toISOString():null,horizons};
 }
 const compare=(horizon,field)=>{
  const a=groups.best.horizons[horizon][field],b=groups.baseline.horizons[horizon][field];
  return finite(a)&&finite(b)?Number((a-b).toFixed(2)):null;
 };
 return {updatedAt:state.selectionCohortsUpdatedAt||null,totalTracked:rows.length,groups,comparison:{bestVsBaselineAverageReturn1h:compare('1h','averageReturnPct'),bestVsBaselinePositive15Rate1h:compare('1h','positive15Pct'),bestVsBaselineAverageReturn24h:compare('24h','averageReturnPct')},method:'Une seule entrée par mint au premier signal de Sélection (ou à sa promotion depuis la baseline). La baseline est un petit échantillon déterministe de tokens avec pool, prix et liquidité observables. Les résultats utilisent les snapshots de prévision du scanner, avec tolérance temporelle; les absences de snapshot sont signalées séparément et ne sont pas comptées comme pertes. Pas de frais, slippage ni simulation de sortie.',status:rows.length<30?'collecting':'prospective_sample'};
}
module.exports={updateSelectionCohorts,buildSelectionPerformance,HORIZONS};
