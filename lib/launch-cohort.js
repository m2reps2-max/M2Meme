'use strict';

const HORIZONS=[['15m',900000],['1h',3600000],['6h',21600000],['24h',86400000],['7d',604800000]];
const SAMPLE_INTERVAL=900000;
const MAX_SNAPSHOTS=700;
const n=value=>Number.isFinite(Number(value))?Number(value):null;

function launchObservedAt(token,now=Date.now()){
 const values=[token?.pumpCreatedAt,token?.geckoPoolCreatedAt,token?.pairCreatedAt,token?.firstSeenAt];
 for(const value of values){
  const parsed=typeof value==='number'?value:Date.parse(value||'');
  if(Number.isFinite(parsed)&&parsed>0)return parsed;
 }
 return now;
}
function ensureLaunchCohort(token,now=Date.now()){
 if(!token.launchCohort){
  token.launchCohort={
   source:token.launchSource||(token.geckoPoolAddress?'GeckoTerminal pool':'DexScreener discovery'),
   observedAt:launchObservedAt(token,now),
   firstMarketAt:null,baselinePrice:null,baselineLiquidity:null,
   marketStatus:'awaiting_market',noMarketAfter30mAt:null,
   snapshots:[],outcomes:{}
  };
 }
 return token.launchCohort;
}
function classify(returnPct,liquidityChangePct){
 if(liquidityChangePct!==null&&liquidityChangePct<=-60)return 'liquidity_collapse';
 if(liquidityChangePct!==null&&liquidityChangePct<=-30)return 'liquidity_stress';
 if(returnPct>=50)return 'strong_win';
 if(returnPct>=15)return 'win';
 if(returnPct<=-50)return 'severe_loss';
 if(returnPct<=-20)return 'loss';
 if(returnPct<=-8)return 'drawdown';
 return 'flat';
}
function observeLaunchCohort(token,snapshot){
 if(!token||!snapshot||!Number.isFinite(Number(snapshot.at)))return null;
 const cohort=ensureLaunchCohort(token,Number(snapshot.at));
 const price=n(snapshot.priceUsd);
 if(price===null||price<=0)return cohort;
 if(cohort.baselinePrice===null){
  cohort.firstMarketAt=Number(snapshot.at);
  cohort.baselinePrice=price;
  cohort.baselineLiquidity=n(snapshot.liquidityUsd);
  cohort.marketStatus=cohort.noMarketAfter30mAt?'late_market':'market_found';
  cohort.maxPrice=price;cohort.minPrice=price;
 }
 const last=cohort.snapshots.at(-1);
 if(!last||Number(snapshot.at)-last.at>=SAMPLE_INTERVAL){
  cohort.snapshots.push({at:Number(snapshot.at),priceUsd:price,liquidityUsd:n(snapshot.liquidityUsd)});
  cohort.snapshots=cohort.snapshots.slice(-MAX_SNAPSHOTS);
  cohort.maxPrice=Math.max(Number(cohort.maxPrice)||price,price);
  cohort.minPrice=Math.min(Number(cohort.minPrice)||price,price);
 }
 for(const [key,ms] of HORIZONS){
  if(cohort.outcomes[key]||Number(snapshot.at)<cohort.firstMarketAt+ms)continue;
  const tolerance=Math.max(300000,ms*.35);
  if(Number(snapshot.at)>cohort.firstMarketAt+ms+tolerance)continue;
  const returnPct=(price/cohort.baselinePrice-1)*100;
  const liquidityChangePct=cohort.baselineLiquidity>0&&n(snapshot.liquidityUsd)!==null?(Number(snapshot.liquidityUsd)/cohort.baselineLiquidity-1)*100:null;
  const maxFavorablePct=(Number(cohort.maxPrice||price)/cohort.baselinePrice-1)*100;
  const maxAdversePct=(Number(cohort.minPrice||price)/cohort.baselinePrice-1)*100;
  cohort.outcomes[key]={observedAt:Number(snapshot.at),delayMs:Number(snapshot.at)-cohort.firstMarketAt-ms,returnPct:Number(returnPct.toFixed(2)),maxFavorablePct:Number(maxFavorablePct.toFixed(2)),maxAdversePct:Number(maxAdversePct.toFixed(2)),liquidityChangePct:liquidityChangePct===null?null:Number(liquidityChangePct.toFixed(2)),label:classify(returnPct,liquidityChangePct)};
 }
 return cohort;
}
function resolveNoMarketCohorts(tokens,now=Date.now()){
 let newlyUnmarketed=0;
 for(const token of tokens||[]){
  if(!token||!(token.launchSource||token.geckoPoolAddress||token.pairAddress))continue;
  const cohort=ensureLaunchCohort(token,now);
  if(cohort.baselinePrice===null&&!cohort.noMarketAfter30mAt&&now-cohort.observedAt>=1800000){
   cohort.noMarketAfter30mAt=now;
   cohort.marketStatus='no_market_after_30m';
   newlyUnmarketed++;
  }
  if(cohort.baselinePrice!==null&&cohort.noMarketAfter30mAt)cohort.marketStatus='late_market';
 }
 return newlyUnmarketed;
}
function summarizeLaunchCohorts(tokens){
 const rows=(tokens||[]).map(token=>({token,cohort:token.launchCohort})).filter(x=>x.cohort);
 const summarize=items=>{
  const oneHour=items.map(x=>x.cohort.outcomes?.['1h']).filter(Boolean);
  const returns=oneHour.map(x=>x.returnPct);
  return {observed:items.length,marketFound:items.filter(x=>x.cohort.baselinePrice>0).length,noMarketAfter30m:items.filter(x=>x.cohort.marketStatus==='no_market_after_30m').length,lateMarket:items.filter(x=>x.cohort.marketStatus==='late_market').length,resolved1h:oneHour.length,positive15Pct:oneHour.length?Number((oneHour.filter(x=>x.returnPct>=15).length/oneHour.length*100).toFixed(1)):null,average1hPct:returns.length?Number((returns.reduce((sum,x)=>sum+x,0)/returns.length).toFixed(2)):null,loss20Pct:oneHour.length?Number((oneHour.filter(x=>x.returnPct<=-20).length/oneHour.length*100).toFixed(1)):null};
 };
 const bySource={};
 for(const row of rows)(bySource[row.cohort.source||'Source inconnue']||=[]).push(row);
 return {universe:summarize(rows),bySource:Object.fromEntries(Object.entries(bySource).map(([key,items])=>[key,summarize(items)])),method:'Cohorte prospective de tous les tokens observés par les sources du scanner, y compris les pools à faible liquidité. Une seule base prix par token, au premier marché observable; résolutions à 15m, 1h, 6h, 24h et 7d. Les tokens sans marché après 30 minutes restent comptés séparément. Ne couvre pas les lancements invisibles aux sources publiques et ne reconstitue pas les prix avant le premier marché observé.'};
}
module.exports={ensureLaunchCohort,observeLaunchCohort,resolveNoMarketCohorts,summarizeLaunchCohorts};
