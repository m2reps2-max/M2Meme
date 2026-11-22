'use strict';
function isRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function record(value){return isRecord(value)?value:{};}
function array(value,predicate=()=>true){return Array.isArray(value)?value.filter(predicate):[];}
function freshState(){return {version:3,tokens:{},selectionCohorts:[],selectionCohortsUpdatedAt:null,alerts:[],watchlist:[],wallets:[],autoWallets:[],walletActivity:{},walletCursors:{},walletLatestCursors:{},walletPendingSignatures:{},walletMonitoringGaps:{},walletTrades:[],experts:[],expertTrades:[],expertMeta:{},expertCoverageSince:null,expertTradesUpdatedAt:null,sources:{},lastScanAt:null};}
function limitForecastHistory(tokens,maxTotal=40000,maxPerToken=700){
 const entries=Object.values(record(tokens));
 for(const token of entries)token.forecasts=array(token.forecasts,isRecord).slice(-maxPerToken);
 let total=entries.reduce((sum,token)=>sum+token.forecasts.length,0);
 if(total>maxTotal){
  const keepPerToken=Math.max(1,Math.floor(maxTotal/Math.max(1,entries.length)));
  for(const token of entries)token.forecasts=token.forecasts.slice(-keepPerToken);
  total=entries.reduce((sum,token)=>sum+token.forecasts.length,0);
 }
 return total;
}
function normalizeState(input){
 const raw=record(input),state={...freshState(),...raw,version:3},tokens={};
 const tokenRows=Object.entries(record(raw.tokens)).filter(([mint,value])=>mint&&mint!=='__proto__'&&mint!=='constructor'&&isRecord(value)).sort((a,b)=>String(b[1].updatedAt||'').localeCompare(String(a[1].updatedAt||''))).slice(0,1200);
 for(const [mint,value] of tokenRows){
  const token={...value,mint:String(value.mint||mint)};
  token.sources=array(token.sources,x=>typeof x==='string').slice(0,30);
  token.history=array(token.history,isRecord).slice(-100);
  token.forecasts=array(token.forecasts,isRecord).slice(-700);
  token.smartMoney={...record(token.smartMoney),hits:Number.isFinite(Number(token.smartMoney?.hits))?Number(token.smartMoney.hits):0,wallets:array(token.smartMoney?.wallets,x=>typeof x==='string').slice(0,100)};
  token.volume=record(token.volume);token.txns=record(token.txns);
  token.security=isRecord(token.security)?token.security:null;
  token.analysis=isRecord(token.analysis)?token.analysis:null;
  tokens[mint]=token;
 }
 state.tokens=tokens;
 state.selectionCohorts=array(raw.selectionCohorts,isRecord).slice(-500);
 state.selectionCohortsUpdatedAt=typeof raw.selectionCohortsUpdatedAt==='string'?raw.selectionCohortsUpdatedAt:null;
 limitForecastHistory(tokens);
 state.alerts=array(raw.alerts,isRecord).slice(-500);
 state.watchlist=[...new Set(array(raw.watchlist,x=>typeof x==='string'&&x.length>0))].slice(-300);
 state.wallets=array(raw.wallets,x=>isRecord(x)&&typeof x.address==='string'&&x.address.length>0).slice(-100);
 state.autoWallets=array(raw.autoWallets,x=>isRecord(x)&&typeof x.address==='string'&&x.address.length>0).slice(-50);
 state.walletTrades=array(raw.walletTrades,isRecord).slice(-5000);
 state.experts=array(raw.experts,x=>isRecord(x)&&typeof x.wallet==='string'&&x.wallet.length>=32).slice(0,50);
 state.expertTrades=array(raw.expertTrades,isRecord).slice(-3000);
 state.expertMeta=record(raw.expertMeta);state.expertCoverageSince=typeof raw.expertCoverageSince==='string'?raw.expertCoverageSince:null;state.expertTradesUpdatedAt=typeof raw.expertTradesUpdatedAt==='string'?raw.expertTradesUpdatedAt:null;
 state.walletActivity=Object.fromEntries(Object.entries(record(raw.walletActivity)).filter(([address,value])=>address&&isRecord(value)));
 state.walletCursors=record(raw.walletCursors);state.walletLatestCursors=record(raw.walletLatestCursors);
 state.walletPendingSignatures=record(raw.walletPendingSignatures);
 for(const [address,rows] of Object.entries(state.walletPendingSignatures))state.walletPendingSignatures[address]=array(rows,isRecord).slice(0,5000);
 state.walletMonitoringGaps=record(raw.walletMonitoringGaps);state.sources=record(raw.sources);
 return state;
}
module.exports={freshState,normalizeState,isRecord,limitForecastHistory};
