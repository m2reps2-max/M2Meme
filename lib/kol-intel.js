'use strict';

const MAX_EXPERTS=50;
const MAX_TRADES=3000;
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const finite=(value)=>Number.isFinite(Number(value))?Number(value):null;
const dateMs=(value)=>{const n=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(n)?(n<1e12?n*1000:n):null;};
const unwrap=(payload,key)=>Array.isArray(payload?.[key])?payload[key]:Array.isArray(payload?.data?.[key])?payload.data[key]:[];
function normalizeLeaderboard(payload,sort='pnl',now=new Date().toISOString()){
 const rows=unwrap(payload,'leaderboard').length?unwrap(payload,'leaderboard'):unwrap(payload,'kols');
 return rows.map((row,index)=>{
  const wallet=String(row?.wallet||row?.wallet_address||row?.address||'');
  if(!WALLET_RE.test(wallet))return null;
  const rank=Number.isInteger(Number(row.rank))&&Number(row.rank)>0?Number(row.rank):index+1;
  return {
   wallet,name:String(row.name||row.kol_name||row.username||'KOL').slice(0,80),
   twitterUrl:typeof row.twitter_url==='string'&&/^https:\/\/(www\.)?x\.com\//.test(row.twitter_url)?row.twitter_url:null,
   strategyTag:String(row.strategy_tag||row.strategy||'').slice(0,40)||null,
   pnlSol:finite(row.pnl),winRatePct:(()=>{const value=finite(row.win_rate??row.winrate??row.win_rate_7d);return value===null?null:Number((value>=0&&value<=1?value*100:value).toFixed(2));})(),
   profitFactor:finite(row.profit_factor),avgRoiPct:finite(row.avg_roi_pct),
   buyCount:finite(row.buy_count),sellCount:finite(row.sell_count),volumeSol:finite(row.volume),
   medianHoldMinutes:finite(row.median_hold_minutes_30d??row.median_hold_minutes),
   earlyEntryPct:finite(row.percentile_early_entry_30d??row.early_entry_pct??row.early_entry_share),
   rank,rankType:sort,period:String(payload?.period||payload?.data?.period||'7d'),updatedAt:now
  };
 }).filter(Boolean);
}
function normalizeTrades(payload){
 return unwrap(payload,'trades').map(row=>{
  const wallet=String(row?.wallet_address||row?.wallet||'');
  const mint=String(row?.token_mint||row?.mint||'');
  const action=String(row?.action||row?.direction||'').toLowerCase();
  const at=dateMs(row?.traded_at||row?.block_time_iso||row?.timestamp||row?.at);
  const solAmount=finite(row?.sol_amount??row?.quote_amount_sol);
  const tokenAmount=finite(row?.token_amount??row?.amount);
  if(!WALLET_RE.test(wallet)||!WALLET_RE.test(mint)||!['buy','sell'].includes(action)||!at||!(solAmount>0)||!(tokenAmount>0))return null;
  const signature=String(row?.tx_signature||row?.signature||'').slice(0,120);
  const id=signature||[wallet,mint,action,at,tokenAmount].join(':');
  const price=finite(row?.price_usd_at_trade??row?.price_usd);
  const marketCap=finite(row?.market_cap_usd_at_trade??row?.market_cap_usd);
  return {
   id,signature:signature||null,wallet,mint,action,solAmount:Number(solAmount.toFixed(9)),
   tokenAmount:Number(tokenAmount.toFixed(9)),priceUsd:price>0?price:null,
   marketCapUsd:marketCap>0?marketCap:null,
   name:String(row?.token_name||'').slice(0,100)||null,
   symbol:String(row?.token_symbol||'').slice(0,30)||null,
   kolName:String(row?.kol_name||'').slice(0,80)||null,
   twitterUrl:typeof row?.kol_twitter==='string'&&/^https:\/\/(www\.)?x\.com\//.test(row.kol_twitter)?row.kol_twitter:null,
   at:new Date(at).toISOString(),source:'madeonsol_kol_feed'
  };
 }).filter(Boolean);
}
function mergeLeaderboard(state,rows,sort='pnl',now=new Date().toISOString()){
 state.experts=Array.isArray(state.experts)?state.experts:[];
 const map=new Map(state.experts.filter(x=>x&&WALLET_RE.test(x.wallet||'')).map(x=>[x.wallet,x]));
 let accepted=0;
 for(const row of rows||[]){
  const prior=map.get(row.wallet)||{wallet:row.wallet,name:row.name,firstSeenAt:now,rankings:{}};
  prior.name=row.name||prior.name;prior.twitterUrl=row.twitterUrl||prior.twitterUrl||null;
  prior.strategyTag=row.strategyTag||prior.strategyTag||null;
  prior.rankings=prior.rankings||{};
  prior.rankings[sort]={rank:row.rank,period:row.period,updatedAt:now};
  for(const key of ['pnlSol','winRatePct','profitFactor','avgRoiPct','buyCount','sellCount','volumeSol','medianHoldMinutes','earlyEntryPct']){
   if(row[key]!==null&&row[key]!==undefined)prior[key]=row[key];
  }
  prior.lastRankedAt=now;prior.provider='MadeOnSol';prior.attribution='provider_label_unverified_onchain';
  map.set(row.wallet,prior);accepted++;
 }
 const all=[...map.values()].map(expert=>{
  const ranks=Object.values(expert.rankings||{}).map(x=>Number(x.rank)).filter(x=>Number.isFinite(x)&&x>0);
  return {...expert,combinedRank:ranks.length?Number((ranks.reduce((a,b)=>a+b,0)/ranks.length).toFixed(2)):9999};
 }).sort((a,b)=>a.combinedRank-b.combinedRank||Number(b.pnlSol||-Infinity)-Number(a.pnlSol||-Infinity));
 state.experts=all.slice(0,MAX_EXPERTS);
 return {accepted,total:state.experts.length};
}
function mergeTrades(state,rows,now=new Date().toISOString()){
 state.expertTrades=Array.isArray(state.expertTrades)?state.expertTrades:[];
 const known=new Set((state.experts||[]).map(x=>x.wallet));
 const existing=new Set(state.expertTrades.map(x=>x.id));
 let added=0;
 for(const row of rows||[]){
  if(!known.has(row.wallet)||existing.has(row.id))continue;
  state.expertTrades.push(row);existing.add(row.id);added++;
  const expert=state.experts.find(x=>x.wallet===row.wallet);
  if(expert){
   expert.name=row.kolName||expert.name;
   expert.twitterUrl=row.twitterUrl||expert.twitterUrl||null;
   expert.lastTradeAt=row.at;
  }
 }
 state.expertTrades=state.expertTrades.slice(-MAX_TRADES);
 state.expertCoverageSince=state.expertCoverageSince||now;
 state.expertTradesUpdatedAt=now;
 return {added,stored:state.expertTrades.length};
}
function portfolioFor(expert,trades,tokenMap={}){
 const rows=trades.filter(x=>x.wallet===expert.wallet).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const positions=new Map();let realizedPnlSol=0,realizedEvents=0,unmatchedSells=0;
 for(const event of rows){
  const p=positions.get(event.mint)||{mint:event.mint,name:event.name||event.mint.slice(0,7)+'…',symbol:event.symbol||'—',quantity:0,costSol:0,costUsd:0,costUsdKnown:true,buyCount:0,sellCount:0,firstBuyAt:null,lastTradeAt:event.at,unmatchedSell:false};
  p.lastTradeAt=event.at;
  if(event.action==='buy'){
   p.quantity+=event.tokenAmount;p.costSol+=event.solAmount;p.buyCount++;
   if(event.priceUsd>0)p.costUsd+=event.tokenAmount*event.priceUsd;else p.costUsdKnown=false;
   p.firstBuyAt=p.firstBuyAt||event.at;
  }else{
   p.sellCount++;
   const sold=Math.min(event.tokenAmount,p.quantity);
   if(sold>0&&p.quantity>0){
    const avgCost=p.costSol/p.quantity;
    realizedPnlSol+=event.solAmount*(sold/event.tokenAmount)-avgCost*sold;
    p.costSol=Math.max(0,p.costSol-avgCost*sold);
    if(p.costUsdKnown){const avgUsd=p.costUsd/(p.quantity||1);p.costUsd=Math.max(0,p.costUsd-avgUsd*sold);}
    p.quantity=Math.max(0,p.quantity-sold);realizedEvents++;
   }
   if(event.tokenAmount>sold+Math.max(1e-8,event.tokenAmount*.001)){p.unmatchedSell=true;unmatchedSells++;}
  }
  positions.set(event.mint,p);
 }
 const openPositions=[...positions.values()].filter(p=>p.quantity>Math.max(1e-9,Math.abs(p.quantity)*1e-9)).map(p=>{
  const token=tokenMap[p.mint]||{},currentPrice=finite(token.priceUsd),avgEntryUsd=p.costUsdKnown&&p.quantity>0?p.costUsd/p.quantity:null;
  const currentValueUsd=currentPrice>0?p.quantity*currentPrice:null;
  return {mint:p.mint,name:token.name||p.name,symbol:token.symbol||p.symbol,quantity:Number(p.quantity.toFixed(6)),costBasisSol:Number(p.costSol.toFixed(6)),averageEntryUsd:avgEntryUsd, currentPriceUsd:currentPrice>0?currentPrice:null,currentValueUsd:currentValueUsd!==null?Number(currentValueUsd.toFixed(2)):null,unrealizedPct:currentPrice>0&&avgEntryUsd>0?Number(((currentPrice/avgEntryUsd-1)*100).toFixed(2)):null,buyCount:p.buyCount,sellCount:p.sellCount,firstBuyAt:p.firstBuyAt,lastTradeAt:p.lastTradeAt,priceAvailable:currentPrice>0};
 }).sort((a,b)=>(b.costBasisSol||0)-(a.costBasisSol||0));
 return {observedTrades:rows.length,buys:rows.filter(x=>x.action==='buy').length,sells:rows.filter(x=>x.action==='sell').length,openPositions:openPositions.slice(0,20),openPositionCount:openPositions.length,observedRealizedPnlSol:realizedEvents?Number(realizedPnlSol.toFixed(6)):null,realizedEvents,unmatchedSells,coverageSince:null,historyComplete:false,method:'Positions reconstruites à partir des transactions KOL reçues depuis l’activation du flux. Coût moyen estimé en SOL; historique partiel, transferts et transactions antérieures manquants. Ce n’est pas le portefeuille on-chain complet ni le PnL réel.'};
}
function buildTokenSignals(state,now=Date.now()){
 const experts=new Map((state.experts||[]).map(x=>[x.wallet,x]));const groups=new Map();
 for(const event of state.expertTrades||[]){const at=Date.parse(event.at||'');if(!Number.isFinite(at)||now-at>6*60*60*1000||now<at)continue;const row=groups.get(event.mint)||{mint:event.mint,buyWallets:new Set(),sellWallets:new Set(),buySol:0,sellSol:0,buys:0,sells:0,firstBuyAt:null,lastTradeAt:null,people:new Map()};
  if(event.action==='buy'){row.buyWallets.add(event.wallet);row.buySol+=Number(event.solAmount||0);row.buys++;row.firstBuyAt=!row.firstBuyAt||at<Date.parse(row.firstBuyAt)?event.at:row.firstBuyAt;}else{row.sellWallets.add(event.wallet);row.sellSol+=Number(event.solAmount||0);row.sells++;}
  if(!row.lastTradeAt||at>Date.parse(row.lastTradeAt))row.lastTradeAt=event.at;
  const expert=experts.get(event.wallet);row.people.set(event.wallet,{name:expert?.name||event.kolName||'KOL',winRatePct:expert?.winRatePct??null,earlyEntryPct:expert?.earlyEntryPct??null});groups.set(event.mint,row);
 }
 return Object.fromEntries([...groups].map(([mint,row])=>{const buyWallets=[...row.buyWallets],sellWallets=[...row.sellWallets],net=Number((row.buySol-row.sellSol).toFixed(4));return [mint,{uniqueBuyers:buyWallets.length,uniqueSellers:sellWallets.length,buys:row.buys,sells:row.sells,buySol:Number(row.buySol.toFixed(4)),sellSol:Number(row.sellSol.toFixed(4)),netSol:net,firstBuyAt:row.firstBuyAt,lastTradeAt:row.lastTradeAt,experts:[...row.people.values()].slice(0,12),signal:buyWallets.length>=3&&net>0?'multi_kol_accumulation':buyWallets.length>=2&&net>0?'multi_kol_interest':net<0?'net_distribution':'single_or_mixed',windowMinutes:360,warning:'Échantillon des KOL indexés par le fournisseur sur les six dernières heures; ne prouve ni coordination ni rentabilité future.'}];}));
}
function buildExpertSnapshot(state,tokenMap={},now=new Date().toISOString()){
 const trades=Array.isArray(state.expertTrades)?state.expertTrades:[];
 const coverageSince=state.expertCoverageSince||null;
 const experts=(state.experts||[]).map(expert=>{
  const portfolio=portfolioFor(expert,trades,tokenMap);portfolio.coverageSince=coverageSince;
  return {...expert,portfolio,recentTrades:trades.filter(x=>x.wallet===expert.wallet).slice(-8).reverse()};
 }).sort((a,b)=>a.combinedRank-b.combinedRank);
 return {configured:Boolean(state.sources?.madeOnSol?.configured),source:state.sources?.madeOnSol||{configured:false,connected:false,error:null},updatedAt:state.expertTradesUpdatedAt||state.sources?.madeOnSol?.at||null,coverageSince,expertCount:experts.length,tradeCount:trades.length,experts,recentTrades:trades.slice(-30).reverse(),tokenSignals:buildTokenSignals(state,Date.parse(now)||Date.now()),method:'Classement et transactions KOL fournis par MadeOnSol. Les adresses sont des attributions de fournisseur, pas une preuve d’identité civile. Le flux est échantillonné et les portefeuilles reconstruits localement sont incomplets.'};
}
class MadeOnSolRadar{
 constructor({state,apiKey=process.env.MADEONSOL_API_KEY,fetchImpl=globalThis.fetch,now=Date.now}={}){
  this.state=state||{};this.apiKey=String(apiKey||'').trim();this.fetchImpl=fetchImpl;this.now=now;this.base='https://madeonsol.com/api/v1';this.busy=false;
  this.state.experts=Array.isArray(this.state.experts)?this.state.experts:[];
  this.state.expertTrades=Array.isArray(this.state.expertTrades)?this.state.expertTrades:[];
  this.state.expertMeta=this.state.expertMeta||{};
 }
 async request(path){
  if(typeof this.fetchImpl!=='function')throw new Error('fetch indisponible dans ce runtime');
  const response=await this.fetchImpl(this.base+path,{method:'GET',headers:{Authorization:'Bearer '+this.apiKey,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  const body=await response.text();
  let payload;try{payload=JSON.parse(body);}catch{throw new Error('Réponse API non JSON ('+response.status+')');}
  if(!response.ok)throw new Error('MadeOnSol HTTP '+response.status+': '+String(payload.error||payload.message||response.statusText).slice(0,140));
  return payload;
 }
 async refresh(){
  if(this.busy)return {skipped:true,reason:'already_running'};
  if(!this.apiKey){this.state.sources.madeOnSol={configured:false,connected:false,mode:'KOL feed · clé API gratuite facultative',error:null};return {configured:false};}
  this.busy=true;const now=this.now(),isoNow=new Date(now).toISOString(),meta=this.state.expertMeta;
  let successful=0,errors=[],newTrades=[];
  try{
   const leaderboardJobs=[['pnl','lastPnlLeaderboardAt'],['early_entry_pct','lastEarlyLeaderboardAt']];
   for(const [sort,key] of leaderboardJobs){
    if(now-(Number(meta[key])||0)<12*60*60*1000||now-(Number(meta[key+'ErrorAt'])||0)<30*60*1000)continue;
    try{
     const payload=await this.request('/kol/leaderboard?period=7d&limit=50&sort='+encodeURIComponent(sort));
     const merged=mergeLeaderboard(this.state,normalizeLeaderboard(payload,sort,isoNow),sort,isoNow);
     meta[key]=now;delete meta[key+'ErrorAt'];meta[key+'Count']=merged.accepted;successful++;
    }catch(error){meta[key+'ErrorAt']=now;errors.push(sort+': '+error.message);}
   }
   if(now-(Number(meta.lastFeedAt)||0)>=15*60*1000&&now-(Number(meta.lastFeedErrorAt)||0)>=30*60*1000){
    try{
     const payload=await this.request('/kol/feed?limit=100');
     const merged=mergeTrades(this.state,normalizeTrades(payload),isoNow);
     newTrades=merged.added?this.state.expertTrades.slice(-merged.added):[];
     meta.lastFeedAt=now;delete meta.lastFeedErrorAt;meta.lastFeedAdded=merged.added;successful++;
    }catch(error){meta.lastFeedErrorAt=now;errors.push('feed: '+error.message);}
   }
   meta.lastAttemptAt=isoNow;meta.lastError=errors.length?errors.join(' | ').slice(0,300):null;
   this.state.sources.madeOnSol={configured:true,connected:successful>0||Boolean(meta.lastSuccessAt),at:successful?isoNow:(meta.lastSuccessAt||null),lastSuccess:successful?isoNow:(meta.lastSuccessAt||null),error:meta.lastError,mode:'API KOL gratuite · 50 experts · feed toutes les 15 min · quota cible ~100 appels/jour',experts:this.state.experts.length,trades:this.state.expertTrades.length};
   if(successful)meta.lastSuccessAt=isoNow;
   return {configured:true,successful,errors,experts:this.state.experts.length,trades:this.state.expertTrades.length,newTrades};
  }finally{this.busy=false;}
 }
}
module.exports={MAX_EXPERTS,normalizeLeaderboard,normalizeTrades,mergeLeaderboard,mergeTrades,portfolioFor,buildTokenSignals,buildExpertSnapshot,MadeOnSolRadar};
