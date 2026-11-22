'use strict';
const API='https://api.geckoterminal.com/api/v2';
const COINS=[
 {symbol:'BONK',name:'Bonk',mint:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',cohort:'cycle_winner'},
 {symbol:'WIF',name:'dogwifhat',mint:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',cohort:'cycle_winner'},
 {symbol:'POPCAT',name:'Popcat',mint:'7GCihgDB8fe6KNjn2MYtkZcRjQy3t9GHdC8uHYmW2hr',cohort:'cycle_winner'},
 {symbol:'BOME',name:'BOOK OF MEME',mint:'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',cohort:'cycle_winner'},
 {symbol:'MEW',name:'cat in a dogs world',mint:'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',cohort:'cycle_winner'},
 {symbol:'TRUMP',name:'Official Trump',mint:'6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',cohort:'cycle_winner'},
 {symbol:'PENGU',name:'Pudgy Penguins',mint:'2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',cohort:'cycle_winner'}
,
 {symbol:'FARTCOIN',name:'Fartcoin',mint:null,cohort:'cycle_winner'},
 {symbol:'PNUT',name:'Peanut the Squirrel',mint:null,cohort:'cycle_winner'},
 {symbol:'MOODENG',name:'Moo Deng',mint:null,cohort:'cycle_winner'},
 {symbol:'GOAT',name:'Goatseus Maximus',mint:null,cohort:'cycle_winner'},
 {symbol:'GIGA',name:'Gigachad',mint:null,cohort:'cycle_winner'},
 {symbol:'PONKE',name:'Ponke',mint:null,cohort:'cycle_survivor'},
 {symbol:'CHILLGUY',name:'Just a chill guy',mint:null,cohort:'boom_bust'},
 {symbol:'WEN',name:'Wen',mint:null,cohort:'long_tail'},
 {symbol:'MYRO',name:'Myro',mint:null,cohort:'long_tail'},
 {symbol:'SAMO',name:'Samoyedcoin',mint:null,cohort:'long_tail'},
 {symbol:'SLERF',name:'Slerf',mint:null,cohort:'boom_bust'},
 {symbol:'VINE',name:'Vine',mint:null,cohort:'boom_bust'},
 {symbol:'MELANIA',name:'Melania Meme',mint:null,cohort:'boom_bust'},
 {symbol:'USELESS',name:'Useless Coin',mint:null,cohort:'cycle_winner'},
 {symbol:'ZEREBRO',name:'Zerebro',mint:null,cohort:'boom_bust'},
 {symbol:'LIBRA',name:'LIBRA',mint:null,cohort:'sharp_drawdown_watch'},
 {symbol:'HAWK',name:'Hawk Tuah',mint:null,cohort:'launch_volatility'},
 {symbol:'CAR',name:'Central African Republic Meme',mint:null,cohort:'launch_volatility'},
 {symbol:'JELLYJELLY',name:'Jelly-My-Jelly',mint:null,cohort:'launch_volatility'},
 {symbol:'ACT',name:'Act I The AI Prophecy',mint:null,cohort:'boom_bust'},
 {symbol:'BERT',name:'Bertram The Pomeranian',mint:null,cohort:'long_tail'},
 {symbol:'MANEKI',name:'MANEKI',mint:null,cohort:'long_tail'},
 {symbol:'MOTHER',name:'MOTHER',mint:null,cohort:'boom_bust'},
 {symbol:'UFD',name:'Unicorn Fart Dust',mint:null,cohort:'launch_volatility'},
 {symbol:'BELIEVE',name:'Believe',mint:null,cohort:'sharp_drawdown_watch'}
];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let nextRequestAt=0;
async function get(url){
 for(let attempt=0;attempt<4;attempt++){
  const delay=Math.max(0,nextRequestAt-Date.now());if(delay)await wait(delay);
  nextRequestAt=Date.now()+2500;
  let response;
  try{response=await fetch(url,{headers:{accept:'application/json;version=20230302'},signal:AbortSignal.timeout(15000)});}
  catch(e){if(attempt===3)throw new Error('GeckoTerminal inaccessible après 4 tentatives : '+(e.name==='TimeoutError'?'délai dépassé':e.message));await wait(1500*(attempt+1));continue;}
  if(response.ok)return response.json();
  const status=response.status;
  if((status===429||status>=500)&&attempt<3){const retry=Number(response.headers.get('retry-after'));await wait(Math.max(retry>0?retry*1000:0,2000*(attempt+1)));continue;}
  throw new Error('GeckoTerminal HTTP '+status+(status===429?' : limite temporaire de requêtes. Réessaie dans une minute.':''));
 }
 throw new Error('GeckoTerminal indisponible après plusieurs tentatives.');
}
function replay(coin,candles){
 const bars=candles.map(x=>({at:Number(x[0])*1000,open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5])})).filter(x=>x.at&&x.close>0&&Number.isFinite(x.volume)).sort((a,b)=>a.at-b.at);
 const signals=[];
 for(let i=7;i<bars.length;i++){
  const b=bars[i],prior=bars.slice(i-7,i),avgVol=prior.reduce((s,x)=>s+x.volume,0)/prior.length,volRatio=avgVol>0?b.volume/avgVol:0;
  const r3=i>=3?(b.close/bars[i-3].close-1)*100:0,r7=b.close/bars[i-7].close-1;
  const activity=Math.max(0,Math.min(100,Math.log10(1+volRatio)*55));
  const momentum=Math.max(0,Math.min(100,50+r3*3.2+r7*1.6));
  const score=Math.round(activity*.5+momentum*.5);
  const future=bars.slice(i+1),peak=future.reduce((m,x)=>Math.max(m,x.high),b.high),peakIndex=future.findIndex(x=>x.high===peak);
  const forward7=future.slice(0,7);
  const horizonReturn=days=>bars[i+days]&&bars[i+days].close>0?Number(((bars[i+days].close/b.close-1)*100).toFixed(2)):null;
  const max7=forward7.length?Math.max(...forward7.map(x=>x.high)):null;
  const min7=forward7.length?Math.min(...forward7.map(x=>x.low)):null;
  signals.push({at:new Date(b.at).toISOString(),price:b.close,volumeUsd:b.volume,volumeVsPrevious7d:Number(volRatio.toFixed(2)),return3dPct:Number(r3.toFixed(2)),return7dPct:Number((r7*100).toFixed(2)),activityScore:Math.round(activity),momentumScore:Math.round(momentum),proxyScore:score,alert:score>=65,return1dForwardPct:horizonReturn(1),return3dForwardPct:horizonReturn(3),return7dForwardPct:horizonReturn(7),maxFavorable7dPct:max7===null?null:Number(((max7/b.close-1)*100).toFixed(2)),maxAdverse7dPct:min7===null?null:Number(((min7/b.close-1)*100).toFixed(2)),forwardMaxUpsidePct:Number(((peak/b.close-1)*100).toFixed(1)),daysToForwardPeak:peakIndex<0?null:Math.round((future[peakIndex].at-b.at)/86400000)});
 }
 const alerts=signals.filter(x=>x.alert),first=alerts[0]||null,best=signals.reduce((a,b)=>!a||b.proxyScore>a.proxyScore?b:a,null);
 const performance=(rows,key)=>{
  const sample=rows.filter(x=>x[key]!==null&&Number.isFinite(x[key]));
  const values=sample.map(x=>x[key]).sort((a,b)=>a-b);
  const median=values.length?(values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2):null;
  return {signals:sample.length,positive15Pct:sample.length?Number((sample.filter(x=>x[key]>=15).length/sample.length*100).toFixed(1)):null,averageReturnPct:sample.length?Number((values.reduce((a,b)=>a+b,0)/sample.length).toFixed(2)):null,medianReturnPct:median===null?null:Number(median.toFixed(2)),loss20Pct:sample.length?Number((sample.filter(x=>x[key]<=-20).length/sample.length*100).toFixed(1)):null};
 };
 const historicalSignalPerformance=Object.fromEntries([['1d','return1dForwardPct'],['3d','return3dForwardPct'],['7d','return7dForwardPct']].map(([h,key])=>[h,{alerts:performance(alerts,key),allSignals:performance(signals,key),alertVsAllAveragePct:performance(alerts,key).averageReturnPct!==null&&performance(signals,key).averageReturnPct!==null?Number((performance(alerts,key).averageReturnPct-performance(signals,key).averageReturnPct).toFixed(2)):null}]));
 const pathSample=alerts.filter(x=>x.maxAdverse7dPct!==null);
 const historicalSignalRisk={alertsWith7dPath:pathSample.length,averageMaxAdverse7dPct:pathSample.length?Number((pathSample.reduce((sum,x)=>sum+x.maxAdverse7dPct,0)/pathSample.length).toFixed(2)):null,drawdown20Pct:pathSample.length?Number((pathSample.filter(x=>x.maxAdverse7dPct<=-20).length/pathSample.length*100).toFixed(1)):null};
 const period=bars.length?{from:new Date(bars[0].at).toISOString(),to:new Date(bars[bars.length-1].at).toISOString(),candles:bars.length}:null;
 const firstClose=bars[0]?.close||null,lastClose=bars.at(-1)?.close||null;
 let peak=0,maxDrawdownPct=0;
 for(const bar of bars){peak=Math.max(peak,bar.high);if(peak>0)maxDrawdownPct=Math.min(maxDrawdownPct,(bar.low/peak-1)*100);}
 const maxObservedPrice=bars.length?Math.max(...bars.map(x=>x.high)):null;
 const maxUpsidePct=firstClose>0?Number(((maxObservedPrice/firstClose-1)*100).toFixed(1)):null;
 const terminalReturnPct=firstClose>0&&lastClose>0?Number(((lastClose/firstClose-1)*100).toFixed(1)):null;
 const terminalDrawdownFromPeakPct=peak>0&&lastClose>0?Number(((lastClose/peak-1)*100).toFixed(1)):null;
 return {symbol:coin.symbol,name:coin.name,mint:coin.mint,poolAddress:null,period,signalCount:signals.length,alertCount:alerts.length,firstAlert:first,bestSignal:best,historicalSignalPerformance,historicalSignalRisk,signals:signals.slice(-180),maxObservedPrice,firstPrice:firstClose,lastPrice:lastClose,maxUpsidePct,terminalReturnPct,maxDrawdownPct:Number(maxDrawdownPct.toFixed(1)),terminalDrawdownFromPeakPct};
}
function resolveSearchMint(payload, coin) {
 const included=new Map((payload?.included||[]).map(item=>[item.id,item]));
 const candidates=[];
 for(const pool of payload?.data||[]){
  const attrs=pool.attributes||{},rel=pool.relationships||{};
  for(const side of ['base_token','quote_token']){
   const id=rel[side]?.data?.id;
   const token=included.get(id)?.attributes||{};
   const symbol=String(token.symbol||'').trim().toUpperCase();
   const name=String(token.name||'').trim().toLowerCase();
   const expectedSymbol=String(coin?.symbol||'').trim().toUpperCase();
   const expectedName=String(coin?.name||'').trim().toLowerCase();
   if(!id||!(symbol&&symbol===expectedSymbol)&&!(expectedName&&name===expectedName))continue;
   const address=String(token.address||id).replace(/^solana_/,'');
   if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))continue;
   candidates.push({mint:address,liquidityUsd:Number(attrs.reserve_in_usd)||0,poolAddress:attrs.address||null,tokenSymbol:symbol,tokenName:name});
  }
 }
 candidates.sort((a,b)=>b.liquidityUsd-a.liquidityUsd);
 return candidates[0]||null;
}
async function runOne(scanner){
 scanner.state.historicalBenchmarks ||= {};
 const existing=Object.keys(scanner.state.historicalBenchmarks);
 const coin=COINS.find(x=>{const old=scanner.state.historicalBenchmarks[x.symbol];if(!old)return true;if(old.completed)return old.schemaVersion!==3||!Number.isFinite(Number(old.terminalReturnPct))||!Number.isFinite(Number(old.maxDrawdownPct))||Date.now()-Date.parse(old.fetchedAt||0)>7*86400000;return Date.now()-Date.parse(old.fetchedAt||0)>2*60000;});
 if(!coin)return {done:true,benchmark:null,progress:existing.length,total:COINS.length};
 const old=scanner.state.historicalBenchmarks[coin.symbol];
 if(old?.completed&&old.schemaVersion===3&&Number.isFinite(Number(old.terminalReturnPct))&&Number.isFinite(Number(old.maxDrawdownPct))&&Date.now()-Date.parse(old.fetchedAt)<7*86400000)return {done:true,benchmark:old,progress:existing.length,total:COINS.length};
 try{
  let mint=coin.mint;
  if(!mint){const found=await get(API+'/search/pools?query='+encodeURIComponent(coin.symbol)+'&include=base_token,quote_token');const resolved=resolveSearchMint(found,coin);mint=resolved?.mint||null;if(!mint)throw new Error('Token non résolu sans ambiguïté : aucun symbole ou nom exact dans les métadonnées GeckoTerminal pour '+coin.symbol+'. Aucune adresse approximative ne sera utilisée.');}
  const pools=await get(API+'/networks/solana/tokens/'+mint+'/pools?page=1');
  const list=Array.isArray(pools.data)?pools.data:[];
  if(!list.length)throw new Error('Aucun pool indexé par GeckoTerminal pour ce token');
  list.sort((a,b)=>Number(b.attributes?.reserve_in_usd||0)-Number(a.attributes?.reserve_in_usd||0));
  const pool=list[0],poolAddress=pool.attributes?.address;
  if(!poolAddress)throw new Error('Adresse de pool absente');
  const raw=await get(API+'/networks/solana/pools/'+poolAddress+'/ohlcv/day?aggregate=1&limit=180&currency=usd&token='+encodeURIComponent(mint));
  const candles=raw.data?.attributes?.ohlcv_list||[];
  if(candles.length<10)throw new Error('Historique OHLCV insuffisant ('+candles.length+' bougies)');
  const result=replay(coin,candles);result.mint=mint;result.cohort=coin.cohort||'unclassified';result.schemaVersion=3;result.poolAddress=poolAddress;result.poolName=pool.attributes?.name||null;result.fetchedAt=new Date().toISOString();result.completed=true;result.source='GeckoTerminal public OHLCV';result.method='Replay journalier proxy : volume relatif sur 7 jours + momentum de prix sur 3/7 jours. Pas de transactions acheteurs/vendeurs, holders, sécurité, wallets ni liquidité historique.';
  scanner.state.historicalBenchmarks[coin.symbol]=result;scanner.save();
  return {done:false,benchmark:result,progress:Object.keys(scanner.state.historicalBenchmarks).length,total:COINS.length};
 }catch(e){scanner.state.historicalBenchmarks[coin.symbol]={symbol:coin.symbol,name:coin.name,mint:coin.mint||null,cohort:coin.cohort||'original_winner',completed:false,error:e.message,fetchedAt:new Date().toISOString()};scanner.save();return {done:false,error:e.message,symbol:coin.symbol,progress:Object.keys(scanner.state.historicalBenchmarks).length,total:COINS.length};}
}
function getHistorical(scanner){
 const data=COINS.map(c=>scanner.state.historicalBenchmarks?.[c.symbol]||{symbol:c.symbol,name:c.name,mint:c.mint||null,cohort:c.cohort||'unclassified',completed:false});
 const completed=data.filter(x=>x.completed);
 const cohortSummary=Object.fromEntries([...new Set(data.map(x=>x.cohort||'unclassified'))].map(cohort=>{
  const rows=completed.filter(x=>x.cohort===cohort);
  const returns=rows.map(x=>x.terminalReturnPct).filter(Number.isFinite).sort((a,b)=>a-b);
  const drawdowns=rows.map(x=>x.maxDrawdownPct).filter(Number.isFinite);
  const median=returns.length?returns[Math.floor((returns.length-1)/2)]:null;
  return [cohort,{tokens:rows.length,medianTerminalReturnPct:median,averageTerminalReturnPct:returns.length?Number((returns.reduce((a,b)=>a+b,0)/returns.length).toFixed(1)):null,averageMaxDrawdownPct:drawdowns.length?Number((drawdowns.reduce((a,b)=>a+b,0)/drawdowns.length).toFixed(1)):null,signals:rows.reduce((sum,x)=>sum+(x.signalCount||0),0),alerts:rows.reduce((sum,x)=>sum+(x.alertCount||0),0)}];
 }));
 return {coins:data,completed:completed.length,total:COINS.length,cohortSummary,source:'GeckoTerminal Public API',limitations:'Échantillon de tokens connus classés en cohortes gagnants, survivants, boom-bust et forte volatilité. Les bougies quotidiennes disponibles sont généralement limitées à une fenêtre récente (environ six mois) et 180 bougies demandées. Le test mesure le rendement et le drawdown sur cette fenêtre, pas le cycle complet depuis le lancement. Les cohortes sélectionnées restent exposées au biais de survivance et ne remplacent pas un univers exhaustif de tous les lancements.'};
}
module.exports={runHistoricalBenchmark:function(){return runOne(this);},getHistoricalBenchmark:function(){return getHistorical(this);},replayHistoricalCandles:replay,resolveSearchMint};
