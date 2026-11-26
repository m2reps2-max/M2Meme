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
 return attributed.map(([wallet,delta])=>({wallet,mint,signature:txSignature,slot:Number.isFinite(Number(slot??transaction.slot))?Number(slot??transaction.slot):null,at:new Date(timestamp).toISOString(),direction:delta>0?'buy':'sell',tokenAmount:Math.abs(delta),swapConfirmed:true,source:'helius_pool_rpc',volumeUsd:Number.isFinite(Number(volumeUsd))&&Number(volumeUsd)>0?Number(volumeUsd):null,volumeSource:volumeSource||null}));
}
function summarizePoolSwapEvents(events=[],checkedAt=new Date().toISOString()){
 const checkedMs=Date.parse(checkedAt);
 const rows=(Array.isArray(events)?events:[]).filter(row=>{const at=Date.parse(row?.at||'');return Number.isFinite(at)&&(!Number.isFinite(checkedMs)||(at<=checkedMs+60000&&checkedMs-at<=15*60*1000));});
 const buys=rows.filter(x=>x.direction==='buy'),sells=rows.filter(x=>x.direction==='sell');
 const buyers=new Set(buys.map(x=>x.wallet).filter(Boolean)),sellers=new Set(sells.map(x=>x.wallet).filter(Boolean));
 const priced=rows.filter(x=>Number.isFinite(Number(x.volumeUsd))&&Number(x.volumeUsd)>0);
 const buyVolumeUsd=buys.filter(x=>Number.isFinite(Number(x.volumeUsd))).reduce((s,x)=>s+Number(x.volumeUsd),0);
 const sellVolumeUsd=sells.filter(x=>Number.isFinite(Number(x.volumeUsd))).reduce((s,x)=>s+Number(x.volumeUsd),0);
 const buyerVolumes=new Map();for(const row of buys)if(Number.isFinite(Number(row.volumeUsd)))buyerVolumes.set(row.wallet,(buyerVolumes.get(row.wallet)||0)+Number(row.volumeUsd));
 const top5=[...buyerVolumes.values()].sort((a,b)=>b-a).slice(0,5).reduce((s,x)=>s+x,0),total=[...buyerVolumes.values()].reduce((s,x)=>s+x,0);
 return {checkedAt,tradeCount:rows.length,buys:buys.length,sells:sells.length,uniqueBuyers:buyers.size,uniqueSellers:sellers.size,buyVolumeUsd:priced.length?Number(buyVolumeUsd.toFixed(2)):null,sellVolumeUsd:priced.length?Number(sellVolumeUsd.toFixed(2)):null,volumeCoverage:rows.length?Number((priced.length/rows.length*100).toFixed(1)):0,top5BuyerSharePct:total>0?Number((top5/total*100).toFixed(1)):null,lastTradeAt:rows.length?rows.reduce((latest,row)=>Date.parse(row.at)>Date.parse(latest)?row.at:latest,rows[0].at):null};
}
function preserveRpcTradeEvidence(geckoIntel,previousIntel){
 const rpcEvidence=Object.fromEntries(Object.entries(previousIntel||{}).filter(([key])=>key.startsWith('rpcConfirmed')));
 return {...(geckoIntel||{}),...rpcEvidence};
}
module.exports={extractPoolSwapEvents,summarizePoolSwapEvents,signerWallets,ownerDeltas,preserveRpcTradeEvidence};
