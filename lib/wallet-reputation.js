'use strict';
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const ms=v=>{const x=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(x)?(x<1e12?x*1000:x):null;};
function tokenLaunchTime(t){return ms(t?.pumpCreatedAt)||ms(t?.geckoPoolCreatedAt)||ms(t?.pairCreatedAt)||null;}
function buildWalletReputation(state={},now=Date.now()){
 const tokens=state.tokens||{},wallets=new Map(),add=(address,source,label)=>{
  if(!WALLET_RE.test(String(address||'')))return;
  const row=wallets.get(address)||{address,sources:[],label:null};
  if(source&&!row.sources.includes(source))row.sources.push(source);
  if(label&&!row.label)row.label=String(label).slice(0,80);
  wallets.set(address,row);
 };
 for(const w of state.wallets||[])add(w.address,'manual',w.label);
 for(const w of state.autoWallets||[])add(w.address,'early_buyer',w.label);
 for(const e of state.experts||[])add(e.wallet,'expert',e.name);
 const tradeRows=Array.isArray(state.walletTrades)?state.walletTrades:[],byWallet=new Map(),seen=new Set();
 for(const t of tradeRows){
  if(!t||!WALLET_RE.test(String(t.wallet||''))||!t.mint||t.swapConfirmed!==true||!['buy','sell'].includes(t.direction)||!(n(t.tokenAmount)>0))continue;
  const sig=String(t.signature||'');if(!sig)continue;
  const key=[t.wallet,t.mint,sig].join('|');if(seen.has(key))continue;seen.add(key);
  const at=ms(t.at);if(at===null)continue;
  const rows=byWallet.get(t.wallet)||[];
  rows.push({...t,atMs:at,quoteSpent:t.quoteSpent&&{asset:String(t.quoteSpent.asset||''),amount:n(t.quoteSpent.amount)},quoteReceived:t.quoteReceived&&{asset:String(t.quoteReceived.asset||''),amount:n(t.quoteReceived.amount)}});
  byWallet.set(t.wallet,rows);add(t.wallet,'observed_trade');
 }
 const earlyByWallet=new Map();
 for(const w of state.autoWallets||[])if(WALLET_RE.test(String(w.address||''))){
  const observations=Array.isArray(w.observations)?w.observations:[];
  earlyByWallet.set(w.address,{tokensObserved:new Set(observations.map(x=>x.mint).filter(Boolean)).size,discoveryScore:n(w.discoveryScore),discoveryVolumeUsd:n(w.buyVolumeUsd)});
 }
 const ranked=[];
 for(const [address,identity] of wallets){
  const events=(byWallet.get(address)||[]).sort((a,b)=>a.atMs-b.atMs),positions=new Map(),closed=[];
  let confirmedBuys=0,confirmedSells=0,unmatchedSells=0,quoteAssetMismatches=0;
  const tokensSeen=new Set(),earlyTokens=new Set();
  for(const e of events){
   tokensSeen.add(e.mint);const launch=tokenLaunchTime(tokens[e.mint]||{});
   if(e.direction==='buy'){
    confirmedBuys++;const q=e.quoteSpent;if(!q||!q.asset||!(q.amount>0))continue;
    let p=positions.get(e.mint);if(!p){p={mint:e.mint,quantity:0,cost:0,asset:q.asset,firstBuyAt:e.at};positions.set(e.mint,p);}
    if(p.asset!==q.asset){quoteAssetMismatches++;continue;}
    p.quantity+=n(e.tokenAmount);p.cost+=q.amount;
    if(launch!==null&&e.atMs>=launch&&e.atMs-launch<=1800000)earlyTokens.add(e.mint);
   }else{
    confirmedSells++;const p=positions.get(e.mint);if(!p||!(p.quantity>0)){unmatchedSells++;continue;}
    const sold=Math.min(p.quantity,n(e.tokenAmount)),cost=p.cost*(sold/p.quantity),q=e.quoteReceived;
    if(q&&q.asset===p.asset&&q.amount>0){
     const proceeds=q.amount*(sold/n(e.tokenAmount)),pnl=proceeds-cost;
     closed.push({mint:e.mint,at:e.at,asset:p.asset,cost,proceeds,pnl,roiPct:cost>0?pnl/cost*100:null,holdMinutes:Math.max(0,(e.atMs-ms(p.firstBuyAt))/60000)});
    }else quoteAssetMismatches++;
    p.quantity-=sold;p.cost=Math.max(0,p.cost-cost);if(p.quantity<=1e-12)positions.delete(e.mint);
   }
  }
  const discovery=earlyByWallet.get(address)||{tokensObserved:0,discoveryScore:0,discoveryVolumeUsd:0};
  const distinctTokens=Math.max(tokensSeen.size,discovery.tokensObserved);
  const winRatePct=closed.length?Number((wins.length/closed.length*100).toFixed(1)):null;
  const avgRoiPct=closed.length?Number((closed.reduce((s,x)=>s+(x.roiPct||0),0)/closed.length).toFixed(1)):null;
  const pnlByAsset={};
  for(const asset of new Set(closed.map(x=>x.asset))){
   const rows=closed.filter(x=>x.asset===asset),assetWins=rows.filter(x=>x.pnl>0),assetLosses=rows.filter(x=>x.pnl<0);
   pnlByAsset[asset]={realizedPnl:Number(rows.reduce((s,x)=>s+x.pnl,0).toFixed(6)),closedTrades:rows.length,winRatePct:Number((assetWins.length/rows.length*100).toFixed(1)),profitFactor:assetLosses.length?Number((assetWins.reduce((s,x)=>s+x.pnl,0)/Math.abs(assetLosses.reduce((s,x)=>s+x.pnl,0))).toFixed(2)):assetWins.length?null:null};
  }
  const quoteAssets=Object.keys(pnlByAsset);
  const profitFactor=quoteAssets.length===1?pnlByAsset[quoteAssets[0]].profitFactor:null;
  const recurrence=Math.min(25,distinctTokens*5),early=Math.min(20,earlyTokens.size*5);
  const winScore=winRatePct===null?0:Math.min(15,winRatePct/100*15*Math.min(1,closed.length/5));
  const roiScore=avgRoiPct===null?0:clamp(10+avgRoiPct/5,0,20)*Math.min(1,closed.length/5);
  const sample=Math.min(10,closed.length*2),discoveryBonus=Math.min(10,discovery.discoveryScore*.1);
  let score=Math.round(clamp(recurrence+early+winScore+roiScore+sample+discoveryBonus));
  if(closed.length<3)score=Math.min(score,54);
  if(!events.length)score=Math.min(score,Math.max(10,Math.round(discovery.discoveryScore*.45)));
  const confidence=closed.length>=10&&distinctTokens>=5?'élevée':closed.length>=5&&distinctTokens>=3?'moyenne':closed.length>=2?'faible':'très faible';
  ranked.push({address,label:identity.label||'Wallet observé',sources:identity.sources,reputationScore:score,confidence,closedTrades:closed.length,winRatePct,avgRoiPct,profitFactor,realizedPnlByQuoteAsset:pnlByAsset,distinctTokens,earlyTokens:earlyTokens.size,earlyEntryPct:tokensSeen.size?Number((earlyTokens.size/tokensSeen.size*100).toFixed(1)):null,confirmedBuys,confirmedSells,openPositions:[...positions.values()].filter(x=>x.quantity>0).length,unmatchedSells,quoteAssetMismatches,discoveryScore:discovery.discoveryScore,discoveryVolumeUsd:Number(discovery.discoveryVolumeUsd.toFixed(2)),firstObservedAt:events[0]?.at||null,lastObservedAt:events.at(-1)?.at||null,recentClosed:closed.slice(-5).reverse().map(x=>({mint:x.mint,at:x.at,asset:x.asset,pnl:Number(x.pnl.toFixed(6)),roiPct:x.roiPct===null?null:Number(x.roiPct.toFixed(1)),holdMinutes:Number(x.holdMinutes.toFixed(1))})),coverage:{tradeEvents:events.length,history:'observed_since_tracking',launchTimeCoverage:tokensSeen.size?Number(([...tokensSeen].filter(m=>tokenLaunchTime(tokens[m])).length/tokensSeen.size*100).toFixed(1)):0}});
 }
 ranked.sort((a,b)=>b.reputationScore-a.reputationScore||b.closedTrades-a.closedTrades||b.distinctTokens-a.distinctTokens||String(b.lastObservedAt||'').localeCompare(String(a.lastObservedAt||'')));
 const evidence=ranked.filter(x=>x.confirmedBuys+x.confirmedSells>0||x.discoveryScore>0),confirmed=tradeRows.filter(x=>x.swapConfirmed===true).length;
 return {generatedAt:new Date(now).toISOString(),summary:{walletsTracked:wallets.size,walletsWithEvidence:evidence.length,rankedWallets:evidence.length,confirmedSwapEvents:confirmed,closedPositions:evidence.reduce((s,x)=>s+x.closedTrades,0),highConfidence:evidence.filter(x=>x.confidence==='élevée').length},wallets:evidence.slice(0,50),methodology:{score:'Récurrence multi-tokens (25), entrées précoces (20), win rate (15), ROI réalisé moyen (20), échantillon (10), découverte initiale (10). Score plafonné à 54/100 avant 3 clôtures observées.',realizedPnl:'Coût moyen pondéré. Un PnL n’est calculé que pour des swaps confirmés avec actif de cotation identique. SOL, USDC et USDT ne sont jamais additionnés.',earlyEntry:'Achat dans les 30 minutes suivant une heure de création connue du pool/token. La première observation ne sert jamais de substitut à l’heure de création.',limitation:'Historique partiel depuis le début de la surveillance. Transactions non détectées, transferts, swaps multi-routes et cotations manquantes peuvent réduire la couverture. Ce classement décrit les observations disponibles, pas la performance totale réelle du wallet.'}};
}
module.exports={buildWalletReputation,tokenLaunchTime};
