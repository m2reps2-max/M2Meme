'use strict';
const H=[['1m',60000],['5m',300000],['10m',600000],['30m',1800000],['1h',3600000]];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
function creatorIntel(){
 const groups=new Map();
 for(const t of Object.values(this.state.tokens)){
  const security=t.security?.data||{};
  const address=t.creator||security.mintAuthority||security.freezeAuthority;
  if(!address)continue;
  const attribution=t.creator?'creator_wallet_from_launch_event':'authority_onchain_proxy';
  const x=groups.get(address)||{address,attribution,tokens:[],flags:[],latestAt:null,observedOutcomes:[]};
  const forecasts=(t.forecasts||[]).filter(f=>f.outcomes?.['1h']);
  for(const f of forecasts)x.observedOutcomes.push(f.outcomes['1h']);
  x.tokens.push({mint:t.mint,name:t.name||'Token',symbol:t.symbol||'—',liquidityUsd:n(t.liquidityUsd),score:t.analysis?.score??null,risk:t.analysis?.risk||'unknown',migrated:Boolean(t.migrated),dexUrl:t.dexUrl||null});
  if(!x.latestAt||String(t.updatedAt)>x.latestAt)x.latestAt=t.updatedAt;
  if(security.freezeAuthorityActive===true)x.flags.push('Freeze authority active');
  if(security.mintAuthorityActive===true)x.flags.push('Mint authority active');
  groups.set(address,x);
 }
 return [...groups.values()].map(x=>{
  const returns=x.observedOutcomes.map(o=>n(o.returnPct));
  return {...x,tokenCount:x.tokens.length,flags:[...new Set(x.flags)],evaluatedForecasts:returns.length,average1hReturnPct:returns.length?Number((returns.reduce((a,b)=>a+b,0)/returns.length).toFixed(2)):null,positiveForecastRatePct:returns.length?Number((returns.filter(v=>v>=15).length/returns.length*100).toFixed(1)):null,assessment:x.attribution==='creator_wallet_from_launch_event'?'Créateur observé à la création': 'Autorité on-chain utilisée comme indice'};
 }).sort((a,b)=>b.tokenCount-a.tokenCount).slice(0,100);
}
function walletIntel(){
 const trades=this.state.walletTrades||[];
 const wallets=(this.state.wallets||[]).map(w=>{
  const events=trades.filter(x=>x.wallet===w.address).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  const mints=[...new Set(events.map(x=>x.mint))];
  const matched=[];
  for(const event of events.filter(x=>x.direction==='buy')){
   const token=this.state.tokens[event.mint];if(!token)continue;
   const eventAt=Date.parse(event.at||0);if(!Number.isFinite(eventAt))continue;
   const history=(token.history||[]).filter(x=>Number.isFinite(x.at)&&Number.isFinite(x.priceUsd)&&x.priceUsd>0);
   const baseline=history.filter(x=>x.at>=eventAt-120000&&x.at<=eventAt+300000).sort((a,b)=>Math.abs(a.at-eventAt)-Math.abs(b.at-eventAt))[0];
   if(!baseline)continue;
   const target=baseline.at+3600000;
   const future=history.filter(x=>x.at>=target&&x.at<=target+1200000).sort((a,b)=>a.at-b.at)[0];
   if(!future)continue;
   matched.push({mint:event.mint,return1hPct:Number(((future.priceUsd/baseline.priceUsd-1)*100).toFixed(2)),at:event.at,baselineAt:baseline.at,baselineOffsetMs:baseline.at-eventAt,observedAt:future.at});
  }
  const returns=matched.map(x=>x.return1hPct);
  return {address:w.address,label:w.label||'Wallet',eventCount:events.length,tokenCount:mints.length,lastActivityAt:events.at(-1)?.at||this.state.walletActivity[w.address]?.at||null,error:this.state.walletActivity[w.address]?.error||null,performance:{matchedBuys:matched.length,average1hReturnPct:returns.length?Number((returns.reduce((a,b)=>a+b,0)/returns.length).toFixed(2)):null,winRatePct:returns.length?Number((returns.filter(x=>x>=15).length/returns.length*100).toFixed(1)):null,confidence:matched.length>=20?'échantillon exploitable':matched.length>=5?'échantillon limité':'pas assez de données',method:'Variation du prix du token entre un snapshot proche de l’achat observé et le snapshot disponible environ 1h après. Ce n’est pas le PnL du wallet.'},tokens:mints.map(mint=>{const e=events.filter(x=>x.mint===mint);return {mint,name:this.state.tokens[mint]?.name||mint.slice(0,6)+'…',symbol:this.state.tokens[mint]?.symbol||'—',buys:e.filter(x=>x.direction==='buy').length,sells:e.filter(x=>x.direction==='sell').length,lastAt:e.at(-1)?.at||null};}),events:events.slice(-100)};
 });
 const byMinute=new Map();
 for(const w of wallets)for(const e of w.events||[])if(e.direction==='buy'){
  const at=Date.parse(e.at);if(!Number.isFinite(at))continue;
  const key=e.mint+':'+Math.floor(at/60000);
  const row=byMinute.get(key)||{mint:e.mint,at:e.at,wallets:new Set()};
  row.wallets.add(w.address);byMinute.set(key,row);
 }
 const clusters=[...byMinute.values()].filter(x=>x.wallets.size>=3).map(x=>({mint:x.mint,at:x.at,trackedWallets:x.wallets.size,warning:'Achats rapprochés par au moins trois wallets surveillés; cela ne prouve pas qu’ils sont liés.'}));
 return {wallets,clusters:clusters.slice(-50).reverse()};
}
function backtest(){
 const rows=[];
 for(const t of Object.values(this.state.tokens)){
  const history=Array.isArray(t.history)?t.history:[];
  for(const snap of history){
   if(!Number.isFinite(snap.score)||!Number.isFinite(snap.priceUsd)||snap.priceUsd<=0)continue;
   const outcomes={};
   for(const [key,ms] of H){
    const target=snap.at+ms,tolerance=Math.max(90000,ms*.5);
    const future=history.filter(x=>x.at>snap.at&&x.at<=target+tolerance&&Number.isFinite(x.priceUsd)&&x.priceUsd>0);
    const observed=future.find(x=>x.at>=target);
    if(!observed)continue;
    const path=future.filter(x=>x.at<=observed.at);
    const high=path.reduce((value,x)=>Math.max(value,x.priceUsd),snap.priceUsd);
    const low=path.reduce((value,x)=>Math.min(value,x.priceUsd),snap.priceUsd);
    outcomes[key]={returnPct:Number(((observed.priceUsd/snap.priceUsd-1)*100).toFixed(2)),maxFavorablePct:Number(((high/snap.priceUsd-1)*100).toFixed(2)),maxAdversePct:Number(((low/snap.priceUsd-1)*100).toFixed(2)),delayMs:observed.at-target};
   }
   rows.push({mint:t.mint,symbol:t.symbol||'—',at:new Date(snap.at).toISOString(),score:snap.score,coverage:snap.coverage??null,outcomes});
  }
 }
 const horizons={};
 for(const [key] of H){
  const values=rows.map(x=>x.outcomes[key]?.returnPct).filter(Number.isFinite);
  horizons[key]={count:values.length,averageReturnPct:values.length?Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(2)):null,positiveRatePct:values.length?Number((values.filter(x=>x>0).length/values.length*100).toFixed(1)):null};
 }
 const scoreBands=[[80,100,'80–100'],[65,79,'65–79'],[45,64,'45–64'],[0,44,'0–44']].map(([min,max,label])=>{
  const selected=rows.filter(x=>x.score>=min&&x.score<=max),values=selected.map(x=>x.outcomes['5m']?.returnPct).filter(Number.isFinite);
  return {label,samples:selected.length,avg5mPct:values.length?Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(2)):null,positive5mPct:values.length?Number((values.filter(x=>x>0).length/values.length*100).toFixed(1)):null};
 });
 return {summary:{samples:rows.length,tokens:new Set(rows.map(x=>x.mint)).size,horizons},scoreBands,method:'Snapshots réellement collectés; chaque horizon accepte uniquement une observation dans une fenêtre de tolérance limitée. Les excursions max favorables/défavorables sont mesurées sur les snapshots disponibles. Sans frais, slippage ni historique antérieur au démarrage.',horizonsAvailable:H.map(x=>x[0]),recent:rows.slice(-300).reverse()};
}
module.exports={creatorIntel,walletIntel,backtest};