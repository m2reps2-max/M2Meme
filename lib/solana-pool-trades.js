'use strict';
const { hasVerifiedSwapInstruction } = require('./wallet-transaction-evidence');
function keyText(value){return typeof value==='string'?value:String(value?.pubkey||value?.key||'');}
function signerWallets(transaction){
 const keys=transaction?.transaction?.message?.accountKeys||transaction?.message?.accountKeys||[];
 const marked=keys.filter(key=>key&&typeof key==='object'&&key.signer===true).map(keyText).filter(Boolean);
 if(marked.length)return [...new Set(marked)];
 const required=Number(transaction?.transaction?.message?.header?.numRequiredSignatures??transaction?.message?.header?.numRequiredSignatures);
 if(Number.isInteger(required)&&required>0)return [...new Set(keys.slice(0,required).map(keyText).filter(Boolean))];
 return keys.length?[keyText(keys[0])].filter(Boolean):[];
}
function tokenAmount(balance){
 const amount=balance?.uiTokenAmount||{};
 if(amount.uiAmountString!==undefined&&amount.uiAmountString!==null){const parsed=Number(amount.uiAmountString);if(Number.isFinite(parsed))return parsed;}
 const raw=Number(amount.amount),decimals=Number(amount.decimals);
 if(!Number.isFinite(raw)||!Number.isInteger(decimals)||decimals<0||decimals>18)return 0;
 return raw/(10**decimals);
}
function ownerDeltas(transaction,mint){
 const before=Array.isArray(transaction?.meta?.preTokenBalances)?transaction.meta.preTokenBalances:[];
 const after=Array.isArray(transaction?.meta?.postTokenBalances)?transaction.meta.postTokenBalances:[];
 const owners=new Map();
 for(const row of before)if(row?.mint===mint&&row?.owner)owners.set(row.owner,(owners.get(row.owner)||0)-tokenAmount(row));
 for(const row of after)if(row?.mint===mint&&row?.owner)owners.set(row.owner,(owners.get(row.owner)||0)+tokenAmount(row));
 return [...owners.entries()].filter(([,delta])=>Number.isFinite(delta)&&Math.abs(delta)>0);
}
function extractPoolSwapEvents(transaction,mint,{signature=null,slot=null,blockTime=null,volumeUsd=null,volumeSource=null}={}){
 if(!transaction?.meta||transaction.meta.err||!mint||!hasVerifiedSwapInstruction(transaction))return [];
 const signers=signerWallets(transaction);if(!signers.length)return [];
 const deltas=ownerDeltas(transaction,mint);let attributed=deltas.filter(([owner])=>signers.includes(owner));
 if(!attributed.length&&deltas.length===0&&signers.length===1){
  const pre=(transaction.meta.preTokenBalances||[]).filter(row=>row?.mint===mint);
  const post=(transaction.meta.postTokenBalances||[]).filter(row=>row?.mint===mint);
  const delta=post.reduce((sum,row)=>sum+tokenAmount(row),0)-pre.reduce((sum,row)=>sum+tokenAmount(row),0);
  if(Number.isFinite(delta)&&Math.abs(delta)>0)attributed=[[signers[0],delta]];
 }
 const rawTime=blockTime??transaction.blockTime,timestamp=Number.isFinite(Number(rawTime))?Number(rawTime)*1000:NaN;
 const txSignature=String(signature||transaction.signature||'');
 if(!Number.isFinite(timestamp)||!txSignature)return [];
 return attributed.map(([wallet,delta],index)=>({wallet,mint,signature:txSignature,slot:Number.isFinite(Number(slot??transaction.slot))?Number(slot??transaction.slot):null,at:new Date(timestamp).toISOString(),direction:delta>0?'buy':'sell',tokenAmount:Math.abs(delta),swapConfirmed:true,source:'helius_pool_rpc',volumeUsd:index===0&&Number.isFinite(Number(volumeUsd))&&Number(volumeUsd)>0?Number(volumeUsd):null,volumeSource:index===0?(volumeSource||null):null}));
}
function summarizePoolSwapEvents(events=[],checkedAt=new Date().toISOString()){
 const checkedMs=Date.parse(checkedAt);
 const rows=(Array.isArray(events)?events:[]).filter(row=>{const at=Date.parse(row?.at||'');return Number.isFinite(at)&&(!Number.isFinite(checkedMs)||(at<=checkedMs+60000&&checkedMs-at<=15*60*1000));});
 const swaps=new Map();
 for(const row of rows){const key=String(row.signature||'')+'|'+String(row.direction||'');if(!swaps.has(key))swaps.set(key,row);}
 const uniqueSwaps=[...swaps.values()],buys=uniqueSwaps.filter(x=>x.direction==='buy'),sells=uniqueSwaps.filter(x=>x.direction==='sell');
 const buyers=new Set(rows.filter(x=>x.direction==='buy').map(x=>x.wallet).filter(Boolean)),sellers=new Set(rows.filter(x=>x.direction==='sell').map(x=>x.wallet).filter(Boolean));
 const swapSignatures=new Set(uniqueSwaps.map(x=>x.signature).filter(Boolean));
 const pricedSignatures=new Set(uniqueSwaps.filter(x=>Number.isFinite(Number(x.volumeUsd))&&Number(x.volumeUsd)>0).map(x=>x.signature).filter(Boolean));
 const buyVolumeUsd=buys.filter(x=>Number.isFinite(Number(x.volumeUsd))&&Number(x.volumeUsd)>0).reduce((sum,x)=>sum+Number(x.volumeUsd),0);
 const sellVolumeUsd=sells.filter(x=>Number.isFinite(Number(x.volumeUsd))&&Number(x.volumeUsd)>0).reduce((sum,x)=>sum+Number(x.volumeUsd),0);
 const buyerVolumes=new Map();for(const row of buys)if(row.wallet&&Number.isFinite(Number(row.volumeUsd))&&Number(row.volumeUsd)>0)buyerVolumes.set(row.wallet,(buyerVolumes.get(row.wallet)||0)+Number(row.volumeUsd));
 const top5=[...buyerVolumes.values()].sort((a,b)=>b-a).slice(0,5).reduce((sum,value)=>sum+value,0),total=[...buyerVolumes.values()].reduce((sum,value)=>sum+value,0);
 return {checkedAt,tradeCount:swapSignatures.size,buys:buys.length,sells:sells.length,uniqueBuyers:buyers.size,uniqueSellers:sellers.size,buyVolumeUsd:pricedSignatures.size?Number(buyVolumeUsd.toFixed(2)):null,sellVolumeUsd:pricedSignatures.size?Number(sellVolumeUsd.toFixed(2)):null,volumeCoverage:swapSignatures.size?Number((pricedSignatures.size/swapSignatures.size*100).toFixed(1)):0,top5BuyerSharePct:total>0?Number((top5/total*100).toFixed(1)):null,lastTradeAt:uniqueSwaps.length?uniqueSwaps.reduce((latest,row)=>Date.parse(row.at)>Date.parse(latest)?row.at:latest,uniqueSwaps[0].at):null};
}
function preserveRpcTradeEvidence(geckoIntel,previousIntel){
 const rpcEvidence=Object.fromEntries(Object.entries(previousIntel||{}).filter(([key])=>key.startsWith('rpcConfirmed')));
 return {...(geckoIntel||{}),...rpcEvidence};
}
function summarizePoolRpcCoverage(tokens=[],now=Date.now(),limit=8){
 const rows=(Array.isArray(tokens)?tokens:Object.values(tokens||{})).filter(token=>token&&typeof token==='object'&&token.poolRpcTradeIntel&&typeof token.poolRpcTradeIntel==='object').map(token=>{
  const intel=token.poolRpcTradeIntel||{},state=token.poolRpcTradeState||{};
  const checkedAt=intel.checkedAt||state.checkedAt||null,lastTradeAt=intel.lastTradeAt||null;
  const checkedMs=Date.parse(checkedAt||''),tradeMs=Date.parse(lastTradeAt||'');
  const ageMinutes=ms=>Number.isFinite(ms)&&ms<=now?Number(((now-ms)/60000).toFixed(1)):null;
  const numberOrNull=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
  return {mint:token.mint||null,symbol:token.symbol||null,score:numberOrNull(token.analysis?.score),poolAddress:intel.poolAddress||state.poolAddress||null,poolAddressSource:intel.poolAddressSource||state.poolAddressSource||null,checkedAt,lastTradeAt,checkAgeMinutes:ageMinutes(checkedMs),lastTradeAgeMinutes:ageMinutes(tradeMs),confirmedSwaps:numberOrNull(intel.tradeCount),uniqueBuyers:numberOrNull(intel.uniqueBuyers),uniqueSellers:numberOrNull(intel.uniqueSellers),buyVolumeUsd:numberOrNull(intel.buyVolumeUsd),sellVolumeUsd:numberOrNull(intel.sellVolumeUsd),volumeCoveragePct:numberOrNull(intel.volumeCoverage),pending:Number(state.pending?.length??intel.pendingCount)||0,processedLastBatch:Number(intel.processedLastBatch)||0,failedLastBatch:Number(intel.failedLastBatch)||0,gapDetected:state.gapDetected===true||intel.gapDetected===true,error:intel.error||state.error||null};
 }).sort((a,b)=>(Date.parse(b.checkedAt||'')||0)-(Date.parse(a.checkedAt||'')||0)||Number(b.score||0)-Number(a.score||0));
 const fresh=rows.filter(row=>row.checkAgeMinutes!==null&&row.checkAgeMinutes<=10);
 return {inspectedPools:rows.length,freshChecks10m:fresh.length,poolsWithRecentSwaps:rows.filter(row=>row.lastTradeAgeMinutes!==null&&row.lastTradeAgeMinutes<=15&&row.confirmedSwaps>0).length,confirmedSwapsByPoolSum:rows.reduce((sum,row)=>sum+row.confirmedSwaps,0),uniqueBuyersByPool:rows.reduce((sum,row)=>sum+row.uniqueBuyers,0),pendingTransactions:rows.reduce((sum,row)=>sum+row.pending,0),failedTransactionsLastBatch:rows.reduce((sum,row)=>sum+row.failedLastBatch,0),poolsWithGaps:rows.filter(row=>row.gapDetected).length,latestCheckAt:rows[0]?.checkedAt||null,topPools:rows.slice(0,Math.max(1,Math.min(20,Number(limit)||8)))};
}
module.exports={extractPoolSwapEvents,summarizePoolSwapEvents,signerWallets,ownerDeltas,preserveRpcTradeEvidence,summarizePoolRpcCoverage};
