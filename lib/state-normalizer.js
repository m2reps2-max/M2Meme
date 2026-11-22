'use strict';
function isRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function record(value){return isRecord(value)?value:{};}
function array(value,predicate=()=>true){return Array.isArray(value)?value.filter(predicate):[];}
function compactArray(value,predicate,max=Infinity){
 if(!Array.isArray(value))return [];
 let write=0;
 for(let read=0;read<value.length;read++)if(predicate(value[read]))value[write++]=value[read];
 value.length=write;
 if(value.length>max)value.splice(0,value.length-max);
 return value;
}
function freshState(){return {version:3,tokens:{},selectionCohorts:[],selectionCohortsUpdatedAt:null,alerts:[],watchlist:[],wallets:[],autoWallets:[],walletActivity:{},walletCursors:{},walletLatestCursors:{},walletPendingSignatures:{},walletMonitoringGaps:{},walletTrades:[],experts:[],expertTrades:[],expertMeta:{},expertCoverageSince:null,expertTradesUpdatedAt:null,sources:{},lastScanAt:null};}
function limitForecastHistory(tokens,maxTotal=40000,maxPerToken=700){
 const entries=Object.values(record(tokens));
 for(const token of entries)token.forecasts=Array.isArray(token.forecasts)?token.forecasts.filter(isRecord).slice(-maxPerToken):[];
 let total=entries.reduce((sum,token)=>sum+token.forecasts.length,0);
 if(total>maxTotal){
  const keepPerToken=Math.max(1,Math.floor(maxTotal/Math.max(1,entries.length)));
  for(const token of entries)token.forecasts=token.forecasts.slice(-keepPerToken);
  total=entries.reduce((sum,token)=>sum+token.forecasts.length,0);
 }
 return total;
}
function normalizeState(input,{mutate=false}={}){
 const raw=record(input),state=mutate?raw:{...freshState(),...raw};
 state.version=3;
 const sourceTokens=record(raw.tokens);
 const tokenRows=Object.entries(sourceTokens).filter(([mint,value])=>mint&&mint!=='__proto__'&&mint!=='constructor'&&isRecord(value)).sort((a,b)=>String(b[1].updatedAt||'').localeCompare(String(a[1].updatedAt||''))).slice(0,1200);
 const tokens=mutate?sourceTokens:{};
 if(mutate){
  const keep=new Set(tokenRows.map(([mint])=>mint));
  for(const mint of Object.keys(tokens))if(!keep.has(mint))delete tokens[mint];
 }
 for(const [mint,value] of tokenRows){
  const token=mutate?value:{...value,mint:String(value.mint||mint)};
  token.mint=String(value.mint||mint);
  token.sources=mutate?compactArray(token.sources,x=>typeof x==='string',30):array(token.sources,x=>typeof x==='string').slice(0,30);
  token.history=mutate?compactArray(token.history,isRecord,100):array(token.history,isRecord).slice(-100);
  token.forecasts=mutate?compactArray(token.forecasts,isRecord,700):array(token.forecasts,isRecord).slice(-700);
  if(mutate){
   token.smartMoney=record(token.smartMoney);
   token.smartMoney.hits=Number.isFinite(Number(token.smartMoney.hits))?Number(token.smartMoney.hits):0;
   token.smartMoney.wallets=compactArray(token.smartMoney.wallets,x=>typeof x==='string',100);
  }else{
   token.smartMoney={...record(token.smartMoney),hits:Number.isFinite(Number(token.smartMoney?.hits))?Number(token.smartMoney.hits):0,wallets:array(token.smartMoney?.wallets,x=>typeof x==='string').slice(0,100)};
  }
  token.volume=record(token.volume);token.txns=record(token.txns);
  token.security=isRecord(token.security)?token.security:null;
  token.analysis=isRecord(token.analysis)?token.analysis:null;
  tokens[mint]=token;
 }
 state.tokens=tokens;
 state.selectionCohorts=mutate?compactArray(raw.selectionCohorts,isRecord,500):array(raw.selectionCohorts,isRecord).slice(-500);
 state.selectionCohortsUpdatedAt=typeof raw.selectionCohortsUpdatedAt==='string'?raw.selectionCohortsUpdatedAt:null;
 if(mutate){
  state.alerts=compactArray(raw.alerts,isRecord,500);
  state.watchlist=[...new Set(compactArray(raw.watchlist,x=>typeof x==='string'&&x.length>0))].slice(-300);
  state.wallets=compactArray(raw.wallets,x=>isRecord(x)&&typeof x.address==='string'&&x.address.length>0,100);
  state.autoWallets=compactArray(raw.autoWallets,x=>isRecord(x)&&typeof x.address==='string'&&x.address.length>0,50);
  state.walletTrades=compactArray(raw.walletTrades,isRecord,5000);
  state.experts=compactArray(raw.experts,x=>isRecord(x)&&typeof x.wallet==='string'&&x.wallet.length>=32,50);
  state.expertTrades=compactArray(raw.expertTrades,isRecord,3000);
  state.walletActivity=record(raw.walletActivity);
  for(const key of Object.keys(state.walletActivity))if(!key||!isRecord(state.walletActivity[key]))delete state.walletActivity[key];
  state.walletCursors=record(raw.walletCursors);state.walletLatestCursors=record(raw.walletLatestCursors);
  state.walletPendingSignatures=record(raw.walletPendingSignatures);
  for(const [address,rows] of Object.entries(state.walletPendingSignatures))state.walletPendingSignatures[address]=compactArray(rows,isRecord,5000);
  state.walletMonitoringGaps=record(raw.walletMonitoringGaps);state.sources=record(raw.sources);
 }else{
  state.alerts=array(raw.alerts,isRecord).slice(-500);
  state.watchlist=[...new Set(array(raw.watchlist,x=>typeof x==='string'&&x.length>0))].slice(-300);
  state.wallets=array(raw.wallets,x=>isRecord(x)&&typeof x.address==='string'&&x.address.length>0).slice(-100);
  state.autoWallets=array(raw.autoWallets,x=>isRecord(x)&&typeof x.address==='string'&&x.address.length>0).slice(-50);
  state.walletTrades=array(raw.walletTrades,isRecord).slice(-5000);
  state.experts=array(raw.experts,x=>isRecord(x)&&typeof x.wallet==='string'&&x.wallet.length>=32).slice(0,50);
  state.expertTrades=array(raw.expertTrades,isRecord).slice(-3000);
  state.walletActivity=Object.fromEntries(Object.entries(record(raw.walletActivity)).filter(([address,value])=>address&&isRecord(value)));
  state.walletCursors=record(raw.walletCursors);state.walletLatestCursors=record(raw.walletLatestCursors);
  state.walletPendingSignatures=record(raw.walletPendingSignatures);
  for(const [address,rows] of Object.entries(state.walletPendingSignatures))state.walletPendingSignatures[address]=array(rows,isRecord).slice(0,5000);
  state.walletMonitoringGaps=record(raw.walletMonitoringGaps);state.sources=record(raw.sources);
 }
 state.expertMeta=record(raw.expertMeta);state.expertCoverageSince=typeof raw.expertCoverageSince==='string'?raw.expertCoverageSince:null;state.expertTradesUpdatedAt=typeof raw.expertTradesUpdatedAt==='string'?raw.expertTradesUpdatedAt:null;
 limitForecastHistory(tokens);
 return state;
}
module.exports={freshState,normalizeState,isRecord,limitForecastHistory};
