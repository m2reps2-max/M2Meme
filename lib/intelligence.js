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
   const at=Date.parse(event.at||0);if(!Number.isFinite(at))continue;
   const forecast=(token.forecasts||[]).filter(f=>f.at>=at&&f.at-at<=1800000&&f.outcomes?.['1h']).sort((a,b)=>a.at-b.at)[0];
   if(forecast)matched.push({mint:event.mint,return1hPct:forecast.outcomes['1h'].returnPct,at:event.at});
  }
  const returns=matched.map(x=>n(x.return1hPct));
  return {address:w.address,label:w.label||'Wallet',eventCount:events.length,tokenCount:mints.length,lastActivityAt:events.at(-1)?.at||this.state.walletActivity[w.address]?.at||null,error:this.state.walletActivity[w.address]?.error||null,performance:{matchedBuys:matched.length,average1hReturnPct:returns.length?Number((returns.reduce((a,b)=>a+b,0)/returns.length).toFixed(2)):null,winRatePct:returns.length?Number((returns.filter(x=>x>=15).length/returns.length*100).toFixed(1)):null,confidence:matched.length>=20?'échantillon exploitable':matched.length>=5?'échantillon limité':'pas assez de données',method:'Performance indicative du token après un achat observé; ce n’est pas le PnL du wallet.'},tokens:mints.map(mint=>{const e=events.filter(x=>x.mint===mint);return {mint,name:this.state.tokens[mint]?.name||mint.slice(0,6)+'…',symbol:this.state.tokens[mint]?.symbol||'—',buys:e.filter(x=>x.direction==='buy').length,sells:e.filter(x=>x.direction==='sell').length,lastAt:e.at(-1)?.at||null};}),events:events.slice(-100)};
 });
 const byMinute=new Map();
 for(const w of wallets)for(const e of w.events||[])if(e.direction==='buy'){const key=e.mint+':'+Math.floor(Date.parse(e.at)/60000);const row=byMinute.get(key)||{mint:e.mint,at:e.at,wallets:new Set()};row.wallets.add(w.address);byMinute.set(key,row);}
 const clusters=[...byMinute.values()].filter(x=>x.wallets.size>=3).map(x=>({mint:x.mint,at:x.at,trackedWallets:x.wallets.size,warning:'Achats rapprochés par au moins trois wallets surveillés; cela ne prouve pas qu’ils sont liés.'}));
 return {wallets,clusters:clusters.slice(-50).reverse()};
}
function backtest(){const rows=[];for(const t of Object.values(this.state.tokens)){const h=Array.isArray(t.history)?t.history:[];for(const s of h){if(!Number.isFinite(s.score)||!Number.isFinite(s.priceUsd)||s.priceUsd<=0)continue;const outcomes={};for(const [key,ms] of H){const f=h.find(x=>x.at>=s.at+ms&&Number.isFinite(x.priceUsd)&&x.priceUsd>0);if(f)outcomes[key]=Number(((f.priceUsd/s.priceUsd-1)*100).toFixed(2));}rows.push({mint:t.mint,symbol:t.symbol||'—',at:new Date(s.at).toISOString(),score:s.score,coverage:s.coverage??null,outcomes});}}
 const horizons={};for(const [key] of H){const v=rows.map(x=>x.outcomes[key]).filter(Number.isFinite);horizons[key]={count:v.length,averageReturnPct:v.length?Number((v.reduce((a,b)=>a+b,0)/v.length).toFixed(2)):null,positiveRatePct:v.length?Number((v.filter(x=>x>0).length/v.length*100).toFixed(1)):null};}
 const scoreBands=[[80,100,'80–100'],[65,79,'65–79'],[45,64,'45–64'],[0,44,'0–44']].map(([min,max,label])=>{const a=rows.filter(x=>x.score>=min&&x.score<=max),v=a.map(x=>x.outcomes['5m']).filter(Number.isFinite);return {label,samples:a.length,avg5mPct:v.length?Number((v.reduce((x,y)=>x+y,0)/v.length).toFixed(2)):null,positive5mPct:v.length?Number((v.filter(x=>x>0).length/v.length*100).toFixed(1)):null};});
 return {summary:{samples:rows.length,tokens:new Set(rows.map(x=>x.mint)).size,horizons},scoreBands,method:'Snapshots réellement collectés; rendement du prix au signal au premier snapshot après horizon. Sans frais, slippage ni historique antérieur au démarrage.',horizonsAvailable:H.map(x=>x[0]),recent:rows.slice(-300).reverse()};
}
module.exports={creatorIntel,walletIntel,backtest};