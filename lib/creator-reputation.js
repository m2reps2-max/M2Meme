'use strict';

const n=value=>Number.isFinite(Number(value))?Number(value):null;
const clamp=value=>Math.max(0,Math.min(100,value));

function firstMaturedOutcome(token){
 const rows=Array.isArray(token?.forecasts)?token.forecasts:[];
 const eligible=rows.filter(row=>row&&row.outcomes&&row.outcomes['1h']&&Number.isFinite(Number(row.outcomes['1h'].returnPct)));
 eligible.sort((a,b)=>Date.parse(a.at||0)-Date.parse(b.at||0));
 return eligible[0]?.outcomes['1h']||null;
}

function buildCreatorReputation(tokens=[]){
 const groups=new Map();
 for(const token of Array.isArray(tokens)?tokens:[]){
  if(token?.creatorObservedAtLaunch!==true||!token.creator)continue;
  const address=String(token.creator);
  const row=groups.get(address)||{address,launches:[],funders:new Set()};
  const outcome=firstMaturedOutcome(token);
  const sales=n(token.creatorSaleSummary?.soldPctSupply24h);
  const migrated=token.migrated===true||Boolean(token.geckoPoolAddress||token.pairAddress);
  row.launches.push({
   mint:token.mint||null,symbol:token.symbol||'—',
   migrated, risk:token.analysis?.risk||'unknown',
   return1hPct:outcome?n(outcome.returnPct):null,
   maxAdversePct:outcome?n(outcome.maxAdversePct):null,
   creatorSoldPct24h:sales,
   creatorSaleObserved:(token.creatorSaleEvents||[]).length>0
  });
  if(token.creatorFunding?.funder)row.funders.add(token.creatorFunding.funder);
  groups.set(address,row);
 }
 return [...groups.values()].map(row=>{
  const launches=row.launches;
  const outcomes=launches.filter(x=>x.return1hPct!==null);
  const returns=outcomes.map(x=>x.return1hPct);
  const positive=returns.filter(x=>x>=15).length;
  const severeLosses=returns.filter(x=>x<=-20).length;
  const migrated=launches.filter(x=>x.migrated).length;
  const creatorSales=launches.filter(x=>x.creatorSaleObserved||x.creatorSoldPct24h!==null);
  const materialSales=launches.filter(x=>x.creatorSoldPct24h!==null&&x.creatorSoldPct24h>=5);
  const avg=returns.length?returns.reduce((sum,x)=>sum+x,0)/returns.length:null;
  const reliability=outcomes.length/(outcomes.length+8);
  const raw=returns.length?clamp(50+(positive/returns.length*100-50)*0.45+clamp(50+(avg||0)*0.35,-50,100)*0.25-(severeLosses/returns.length*100)*0.2):50;
  const score=returns.length>=3?Math.round(50+(raw-50)*reliability):null;
  const confidence=outcomes.length>=20?'échantillon conséquent':outcomes.length>=8?'échantillon limité':outcomes.length>=3?'échantillon faible':'insuffisant';
  const warnings=[];
  if(materialSales.length)warnings.push('Ventes créateur observées représentant au moins 5 % de la supply sur 24 h pour '+materialSales.length+' lancement(s).');
  if(launches.some(x=>x.risk==='high'))warnings.push('Au moins un lancement associé présente un risque élevé.');
  if(row.funders.size>1)warnings.push('Plusieurs financeurs initiaux observés : cela ne prouve pas une séparation réelle des contrôles.');
  return {
   address:row.address,score,confidence,launches:launches.length,evaluatedLaunches:outcomes.length,
   positive15Pct:returns.length?Number((positive/returns.length*100).toFixed(1)):null,
   severeLoss20Pct:returns.length?Number((severeLosses/returns.length*100).toFixed(1)):null,
   average1hReturnPct:avg===null?null:Number(avg.toFixed(2)),
   migrationRatePct:launches.length?Number((migrated/launches.length*100).toFixed(1)):null,
   creatorSaleLaunches:creatorSales.length,materialCreatorSaleLaunches:materialSales.length,
   observedFunders:row.funders.size,warnings,
   method:'Un résultat 1h maximum par lancement, première prévision arrivée à maturité. Score rétréci vers 50 tant que l’échantillon est faible. Les ventes créateur sont des sorties swap-like observées, pas une preuve de vente totale.'
  };
 }).map(row=>({address:row.address,reputation:{
  score:row.score,confidence:row.confidence,launches:row.launches,evaluatedLaunches:row.evaluatedLaunches,
  positive15Pct:row.positive15Pct,severeLoss20Pct:row.severeLoss20Pct,average1hReturnPct:row.average1hReturnPct,
  migrationRatePct:row.migrationRatePct,creatorSaleLaunches:row.creatorSaleLaunches,
  materialCreatorSaleLaunches:row.materialCreatorSaleLaunches,observedFunders:row.observedFunders,
  warnings:row.warnings,method:row.method
 }}));
}

module.exports={buildCreatorReputation,firstMaturedOutcome};
