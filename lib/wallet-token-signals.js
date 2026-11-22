'use strict';
const {buildWalletReputation,tokenLaunchTime}=require('./wallet-reputation');
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const ms=v=>{const x=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(x)?(x<1e12?x*1000:x):null;};
function buildWalletTokenSignals(state={},now=Date.now()){
 const reputation=buildWalletReputation(state,now);
 const trusted=new Map(reputation.wallets
  .filter(w=>w.closedTrades>=2&&w.reputationScore>=25&&w.confidence!=='très faible')
  .map(w=>[w.address,w]));
 const tokens=state.tokens||{},byMint=new Map(),seen=new Set();
 const events=Array.isArray(state.walletTrades)?state.walletTrades:[];
 for(const e of events){
  if(!e||e.swapConfirmed!==true||!WALLET_RE.test(String(e.wallet||''))||!trusted.has(e.wallet)||!e.mint||!['buy','sell'].includes(e.direction))continue;
  const at=ms(e.at);if(at===null||at>now+60000||now-at>6*60*60*1000||!(n(e.tokenAmount)>0))continue;
  const signature=String(e.signature||'');if(!signature)continue;
  const key=[e.wallet,e.mint,signature].join('|');if(seen.has(key))continue;seen.add(key);
  const rows=byMint.get(e.mint)||[];
  rows.push({...e,atMs:at});byMint.set(e.mint,rows);
 }
 const result={};
 for(const [mint,rows] of byMint){
  const launch=tokenLaunchTime(tokens[mint]||{});
  const buys=rows.filter(e=>e.direction==='buy'),sells=rows.filter(e=>e.direction==='sell'&&now-e.atMs<=30*60*1000);
  const walletBuys=new Map(),walletSells=new Map();
  for(const e of buys){const w=trusted.get(e.wallet);const row=walletBuys.get(e.wallet)||{wallet:e.wallet,reputationScore:w.reputationScore,closedTrades:w.closedTrades,confidence:w.confidence,firstBuyAt:e.atMs,buyCount:0,early:false};row.firstBuyAt=Math.min(row.firstBuyAt,e.atMs);row.buyCount++;row.early=row.early||(launch!==null&&e.atMs>=launch&&e.atMs-launch<=30*60*1000);walletBuys.set(e.wallet,row);}
  for(const e of sells)walletSells.set(e.wallet,(walletSells.get(e.wallet)||0)+1);
  const supporters=[...walletBuys.values()].sort((a,b)=>b.reputationScore-a.reputationScore);
  const independentWallets=supporters.length;
  const reputationWeight=supporters.reduce((sum,w)=>sum+(w.closedTrades>=5?1:.65),0);
  const avgReputation=reputationWeight&&independentWallets?supporters.reduce((sum,w)=>sum+w.reputationScore*(w.closedTrades>=5?1:.65),0)/supporters.reduce((sum,w)=>sum+(w.closedTrades>=5?1:.65),0):0;
  const earlyWallets=supporters.filter(w=>w.early).length;
  const sellingWallets=[...walletSells.keys()].filter(w=>walletBuys.has(w)).length;
  const enoughEvidence=independentWallets>=2;
  let score=null;
  if(enoughEvidence){
   const convergence=Math.min(20,(independentWallets-1)*10);
   const earlyBonus=launch!==null?Math.min(10,earlyWallets*5):0;
   const sellPenalty=Math.min(35,sellingWallets*18);
   score=Math.max(0,Math.min(100,Math.round(avgReputation*.65+convergence+earlyBonus-sellPenalty)));
  }
  result[mint]={
   available:true,score,qualified:enoughEvidence,confidence:independentWallets>=3&&supporters.filter(w=>w.closedTrades>=5).length>=2?'élevée':enoughEvidence?'modérée':'faible',
   trustedWalletBuys:independentWallets,earlyWallets,sellingWallets,confirmedBuys:buys.length,confirmedSells:sells.length,
   windowHours:6,lastBuyAt:buys.map(e=>e.at).sort().at(-1)||null,
   wallets:supporters.slice(0,8).map(w=>({address:w.wallet,reputationScore:w.reputationScore,closedTrades:w.closedTrades,confidence:w.confidence,buyCount:w.buyCount,early:w.early,soldRecently:walletSells.has(w.wallet)})),
   reason:!enoughEvidence?'Moins de deux wallets fiables ont un achat confirmé observé sur les six dernières heures.':sellingWallets?'Achats convergents, mais des ventes récentes de wallets suivis réduisent le signal.':'Achats confirmés de plusieurs wallets ayant au moins deux positions clôturées observées.',
   coverage:'Swaps confirmés et wallets suivis uniquement; historique local partiel.'
  };
 }
 return result;
}
module.exports={buildWalletTokenSignals};
