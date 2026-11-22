'use strict';
function isRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function record(value){return isRecord(value)?value:{};}
function array(value,predicate=()=>true){return Array.isArray(value)?value.filter(predicate):[];}
function freshState(){return {version:3,tokens:{},alerts:[],watchlist:[],wallets:[],autoWallets:[],walletActivity:{},walletCursors:{},walletLatestCursors:{},walletPendingSignatures:{},walletMonitoringGaps:{},walletTrades:[],sources:{},lastScanAt:null};}
function normalizeState(input){
 const raw=record(input),state={...freshState(),...raw,version:3},tokens={};
 for(const [mint,value] of Object.entries(record(raw.tokens))){
  if(!mint||mint==='__proto__'||mint==='constructor'||!isRecord(value))continue;
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
 state.alerts=array(raw.alerts,isRecord).slice(-500);
 state.watchlist=[...new Set(array(raw.watchlist,x=>typeof x==='string'&&x.length>0))].slice(-300);
 state.wallets=array(raw.wallets,x=>isRecord(x)&&typeof x.address==='string'&&x.address.length>0).slice(-100);
 state.autoWallets=array(raw.autoWallets,x=>isRecord(x)&&typeof x.address==='string'&&x.address.length>0).slice(-15);
 state.walletTrades=array(raw.walletTrades,isRecord).slice(-5000);
 state.walletActivity=Object.fromEntries(Object.entries(record(raw.walletActivity)).filter(([address,value])=>address&&isRecord(value)));
 state.walletCursors=record(raw.walletCursors);state.walletLatestCursors=record(raw.walletLatestCursors);
 state.walletPendingSignatures=record(raw.walletPendingSignatures);
 for(const [address,rows] of Object.entries(state.walletPendingSignatures))state.walletPendingSignatures[address]=array(rows,isRecord).slice(0,5000);
 state.walletMonitoringGaps=record(raw.walletMonitoringGaps);state.sources=record(raw.sources);
 return state;
}
module.exports={freshState,normalizeState,isRecord};
