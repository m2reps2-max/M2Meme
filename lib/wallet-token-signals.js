'use strict';
const {buildWalletReputation,tokenLaunchTime}=require('./wallet-reputation');
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const ms=v=>{const x=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(x)?(x<1e12?x*1000:x):null;};

function independentBuyerClusters(supporters,buys){
 const parent=new Map(supporters.map(row=>[row.wallet,row.wallet]));
 const find=address=>{
  let root=address;
  while(parent.get(root)!==root)root=parent.get(root);
  let current=address;
  while(parent.get(current)!==current){const next=parent.get(current);parent.set(current,root);current=next;}
  return root;
 };
 const join=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(rb,ra);};
 const byTransaction=new Map();
 for(const event of buys){
  const signature=String(event.signature||'');
  if(!signature||!parent.has(event.wallet))continue;
  const group=byTransaction.get(signature)||[];
  group.push(event.wallet);byTransaction.set(signature,group);
 }
 for(const wallets of byTransaction.values()){
  const unique=[...new Set(wallets)];
  for(let i=1;i<unique.length;i++)join(unique[0],unique[i]);
 }
 const groups=new Map();
 for(const row of supporters){
  const root=find(row.wallet),group=groups.get(root)||[];
  group.push(row.wallet);groups.set(root,group);
 }
 return [...groups.values()].map(wallets=>({wallets,representative:supporters.find(row=>row.wallet===wallets[0])?.wallet||wallets[0]}));
}

function buildWalletTokenSignals(state={},now=Date.now()){
 const reputation=buildWalletReputation(state,now);
 // A wallet needs at least three genuinely closed positions across multiple tokens.
 // Discovery-only wallets remain candidates, never trusted Smart Money.
 const trusted=new Map(reputation.wallets
  .filter(w=>w.closedTrades>=3&&w.distinctTokens>=2&&w.reputationScore>=35&&w.confidence!=='très faible')
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
  for(const e of buys){
   const w=trusted.get(e.wallet);
   const row=walletBuys.get(e.wallet)||{wallet:e.wallet,reputationScore:w.reputationScore,closedTrades:w.closedTrades,distinctTokens:w.distinctTokens,confidence:w.confidence,firstBuyAt:e.atMs,buyCount:0,early:false};
   row.firstBuyAt=Math.min(row.firstBuyAt,e.atMs);row.buyCount++;
   row.early=row.early||(launch!==null&&e.atMs>=launch&&e.atMs-launch<=30*60*1000);
   walletBuys.set(e.wallet,row);
  }
  for(const e of sells)walletSells.set(e.wallet,(walletSells.get(e.wallet)||0)+1);
  const supporters=[...walletBuys.values()].sort((a,b)=>b.reputationScore-a.reputationScore);
  const clusters=independentBuyerClusters(supporters,buys);
  const rawWallets=supporters.length,independentWallets=clusters.length;
  const reputationWeight=supporters.reduce((sum,w)=>sum+(w.closedTrades>=5?1:.65),0);
  const avgReputation=reputationWeight?supporters.reduce((sum,w)=>sum+w.reputationScore*(w.closedTrades>=5?1:.65),0)/reputationWeight:0;
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
  const clusteredWallets=rawWallets-independentWallets;
  const reasons=[];
  if(!enoughEvidence)reasons.push('Moins de deux groupes d’acheteurs indépendants avec historique confirmé suffisant.');
  else reasons.push('Achats confirmés de plusieurs groupes de wallets ayant au moins trois positions clôturées sur plusieurs tokens.');
  if(clusteredWallets>0)reasons.push(clusteredWallets+' wallet(s) observé(s) dans la même transaction qu’un autre acheteur; ils ne sont pas comptés comme confirmations indépendantes.');
  if(sellingWallets>0)reasons.push(sellingWallets+' wallet(s) suivi(s) ont vendu récemment; le signal est pénalisé.');
  result[mint]={
   available:true,score,qualified:enoughEvidence,confidence:independentWallets>=3&&supporters.filter(w=>w.closedTrades>=5).length>=2?'élevée':enoughEvidence?'modérée':'faible',
   trustedWalletBuys:rawWallets,independentWallets,independentClusters:clusters.map(group=>group.wallets),
   sameTransactionClusteredWallets:clusteredWallets,earlyWallets,sellingWallets,confirmedBuys:buys.length,confirmedSells:sells.length,
   windowHours:6,lastBuyAt:buys.map(e=>e.at).sort().at(-1)||null,
   wallets:supporters.slice(0,8).map(w=>({address:w.wallet,reputationScore:w.reputationScore,closedTrades:w.closedTrades,distinctTokens:w.distinctTokens,confidence:w.confidence,buyCount:w.buyCount,early:w.early,soldRecently:walletSells.has(w.wallet)})),
   reason:reasons.join(' '),
   coverage:'Swaps confirmés et wallets suivis uniquement; historique local partiel. Les acheteurs de la même transaction sont regroupés par prudence; des transactions distinctes dans un même slot restent indépendantes.'
  };
 }
 return result;
}
module.exports={buildWalletTokenSignals,independentBuyerClusters};
