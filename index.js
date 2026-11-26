'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const express=require('express');
const helmet=require('helmet');
const cookieParser=require('cookie-parser');
const {Bot,InlineKeyboard}=require('grammy');
const {MemeScanner}=require('./lib/scanner');
const {renderTelegramPerformancePng,findTelegramPreviewEntry}=require('./lib/telegram-preview-image');
const {buildTelegramPublicationAudit}=require('./lib/telegram-audit');
const {getPaperTradingSummary,setPaperTradingEnabled,stepPaperTrading}=require('./lib/paper-trading');
const {buildHeliusWalletSnapshot}=require('./lib/helius-wallet-intel');
const {resolveTelegramToken}=require('./lib/telegram-config');
const {addTelegramChannel,upsertTelegramChannel,updateTelegramChannel,removeTelegramChannel,validChatId}=require('./lib/telegram-channels');
const {scoreWalletDiscovery}=require('./lib/wallet-discovery');
const {buildWalletReputation}=require('./lib/wallet-reputation');
const {COINS:HISTORICAL_COINS}=require('./lib/historical-benchmark');
const {constantTimeEqual,validateHistoricalPayload,validateArchiveLearningPayload,mergeHistoricalBenchmarks}=require('./lib/actions-ingest');
const {resolveDashboardConfig}=require('./lib/dashboard-config');
const {isTrustedDashboardRequest}=require('./lib/origin-guard');
const {applyScannerSettingsPatch}=require('./lib/scanner-settings');
const CONFIG=resolveDashboardConfig({env:process.env,dataDir:path.join(__dirname,'data')});
const {port:PORT,accessCode:CODE,sessionSecret:SECRET,dashboardUrl:URL,production:PROD}=CONFIG;
const COOKIE='meme_radar_session',SESSION_TTL=7*24*60*60*1000;
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use('/internal/actions/historical-benchmark',express.raw({type:'application/json',limit:'5mb'}));app.use('/internal/actions/archive-learning',express.raw({type:'application/json',limit:'128kb'}));app.use(express.json({limit:'24kb'}));app.use(cookieParser());
const fails=new Map();
let lastLoginCleanup=0;
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function sign(s){return crypto.createHmac('sha256',SECRET).update(s).digest('base64url');}
function fingerprint(){return crypto.createHash('sha256').update(CODE).digest('hex');}
function session(){const now=Date.now(),p=Buffer.from(JSON.stringify({v:1,code:fingerprint(),iat:now,exp:now+SESSION_TTL,nonce:crypto.randomBytes(12).toString('hex')})).toString('base64url');return p+'.'+sign(p);}
function valid(t){if(typeof t!=='string'||t.length>2048)return false;const i=t.lastIndexOf('.');if(i<1||!equal(sign(t.slice(0,i)),t.slice(i+1)))return false;try{const p=JSON.parse(Buffer.from(t.slice(0,i),'base64url').toString());return p.v===1&&p.code===fingerprint()&&Number.isFinite(p.iat)&&p.iat<=Date.now()+60000&&Number.isFinite(p.exp)&&p.exp>Date.now()&&p.exp-p.iat<=SESSION_TTL+1000;}catch{return false;}}
function auth(req,res,next){if(!valid(req.cookies[COOKIE]))return res.status(401).json({error:'Authentification requise'});next();}
function origin(req,res,next){
 const trusted=isTrustedDashboardRequest({
  origin:req.get('origin'),
  fetchSite:req.get('sec-fetch-site'),
  dashboardUrl:CONFIG.dashboardUrl,
  forwardedHost:req.get('x-forwarded-host'),
  forwardedProto:req.get('x-forwarded-proto'),
  host:req.get('host'),
  protocol:req.protocol
 });
 if(!trusted)return res.status(403).json({error:'Origine refusée. Recharge le Dashboard depuis son adresse habituelle puis réessaie.'});
 next();
}
function loginLimit(req,res,next){const key=String(req.ip||'unknown'),now=Date.now();if(now-lastLoginCleanup>60000||fails.size>2000){for(const [ip,row] of fails)if(row.until<=now)fails.delete(ip);lastLoginCleanup=now;}if(fails.size>=5000&&!fails.has(key))return res.status(429).json({error:'Trop de tentatives. Réessaie plus tard.'});let x=fails.get(key)||{n:0,until:now+900000};if(x.until<now)x={n:0,until:now+900000};if(x.n>=8)return res.status(429).json({error:'Trop de tentatives. Réessaie plus tard.'});req.bad=()=>{x.n++;fails.set(key,x);};req.good=()=>fails.delete(key);next();}
const TELEGRAM_TOKEN=resolveTelegramToken(process.env);
let bot=null;if(TELEGRAM_TOKEN){bot=new Bot(TELEGRAM_TOKEN);const kb=()=>URL?new InlineKeyboard().url('Ouvrir MEME RADAR',URL):null;bot.command('start',ctx=>ctx.reply('Bienvenue sur MEME RADAR.',kb()?{reply_markup:kb()}:undefined));bot.command('dashboard',ctx=>ctx.reply(URL?'Ouvre ton dashboard privé : '+URL:'Configure DASHBOARD_URL pour recevoir le lien du dashboard.'));bot.command('help',ctx=>ctx.reply('Commandes : /start /dashboard /scan /opportunities /help. Recherche uniquement, aucun achat automatique.'));bot.on('my_chat_member',ctx=>{const update=ctx.update.my_chat_member;const result=upsertTelegramChannel(scanner.state.telegramChannels,update.chat,update.new_chat_member);if(!result.ok){console.warn('[telegram channel discovery]',result.error);return;}if(result.ignored)return;scanner.state.telegramChannels=result.channels;scanner.state.telegramChannelsConfigured=true;try{scanner.save();console.log('[telegram] channel membership updated',{chatId:String(update.chat.id),title:update.chat.title,status:update.new_chat_member?.status,canPostMessages:result.channel?.canPostMessages});}catch(error){console.error('[telegram channel discovery] save failed:',error.message);}});}
const scanner=new MemeScanner({dataFile:path.join(__dirname,'data','store.json'),bot,telegramChatId:process.env.TELEGRAM_CHAT_ID,telegramPreviewBaseUrl:URL||'https://m2meme.fadehost.app'});
let lastManual=0;
app.post('/internal/actions/historical-benchmark',(req,res)=>{
 const expected=String(process.env.MEME_RADAR_ACTIONS_TOKEN||'');
 if(expected.length<32)return res.status(503).json({error:'Import GitHub Actions non configuré.'});
 const authorization=String(req.get('authorization')||'');
 const supplied=authorization.startsWith('Bearer ')?authorization.slice(7):'';
 if(!constantTimeEqual(expected,supplied))return res.status(401).json({error:'Authentification refusée.'});
 if(!Buffer.isBuffer(req.body))return res.status(400).json({error:'Corps JSON requis.'});
 let payload;try{payload=JSON.parse(req.body.toString('utf8'));}catch{return res.status(400).json({error:'JSON invalide.'});}
 const validation=validateHistoricalPayload(payload,new Set(HISTORICAL_COINS.map(x=>x.symbol)));
 if(!validation.ok)return res.status(400).json({error:validation.error});
 scanner.state.historicalBenchmarks=mergeHistoricalBenchmarks(scanner.state.historicalBenchmarks,payload.historicalBenchmarks);
 scanner.state.historicalBenchmarkActionsAt=String(payload.generatedAt||new Date().toISOString()).slice(0,40);
 try{scanner.save();}catch(error){console.error('[actions benchmark import]',error.message);return res.status(500).json({error:'Échec de sauvegarde du benchmark.'});}
 const completed=Object.values(scanner.state.historicalBenchmarks).filter(x=>x.completed).length;
 res.json({ok:true,received:Object.keys(payload.historicalBenchmarks).length,completed,total:HISTORICAL_COINS.length,importedAt:scanner.state.historicalBenchmarkActionsAt});
});
app.get('/internal/actions/archive-learning',(req,res)=>{
 const expected=String(process.env.MEME_RADAR_ACTIONS_TOKEN||'');
 const authorization=String(req.get('authorization')||'');
 const supplied=authorization.startsWith('Bearer ')?authorization.slice(7):'';
 if(expected.length<32)return res.status(503).json({error:'Export GitHub Actions non configuré.'});
 if(!constantTimeEqual(expected,supplied))return res.status(401).json({error:'Authentification refusée.'});
 if(!scanner.archive?.available)return res.status(503).json({error:'Archive SQLite indisponible.'});
 const cursor=String(req.query.cursor||'').slice(0,64);
 const requested=Number(req.query.limit)||200;
 const page=scanner.archive.forecastPage(cursor,Math.min(200,Math.max(1,requested)));
 if(page.error)return res.status(503).json({error:page.error});
 res.json(page);
});
app.post('/internal/actions/archive-learning',(req,res)=>{
 const expected=String(process.env.MEME_RADAR_ACTIONS_TOKEN||'');
 const authorization=String(req.get('authorization')||'');
 const supplied=authorization.startsWith('Bearer ')?authorization.slice(7):'';
 if(expected.length<32)return res.status(503).json({error:'Import GitHub Actions non configuré.'});
 if(!constantTimeEqual(expected,supplied))return res.status(401).json({error:'Authentification refusée.'});
 if(!Buffer.isBuffer(req.body))return res.status(400).json({error:'Corps JSON requis.'});
 let payload;try{payload=JSON.parse(req.body.toString('utf8'));}catch{return res.status(400).json({error:'JSON invalide.'});}
 const validation=validateArchiveLearningPayload(payload);
 if(!validation.ok)return res.status(400).json({error:validation.error});
 scanner.state.archiveLearning=payload.summary;
 scanner.state.archiveLearningGeneratedAt=String(payload.generatedAt).slice(0,40);
 scanner._learningSummaryCache=null;
 try{scanner.save();}catch(error){console.error('[archive learning import]',error.message);return res.status(500).json({error:'Échec de sauvegarde des statistiques archive.'});}
 res.json({ok:true,archiveTokensScanned:payload.summary.archiveTokensScanned,tokensWithForecasts:payload.summary.tokensWithForecasts,importedAt:scanner.state.archiveLearningGeneratedAt});
});
app.get('/health',(_q,r)=>r.json({ok:true,service:'meme-radar',at:new Date().toISOString()}));
app.get('/health/ready',(_q,r)=>{const health=scanner.healthSummary();const ready=health.checks.scanner.ok;r.status(ready?200:503).json({ok:ready,scannerRunning:scanner.running,at:new Date().toISOString()});});
app.get('/api/system/health',(_q,r)=>r.json({ok:true,...scanner.healthSummary()}));

function publicationDiagnosticsSnapshot(selection=scanner.selection()){
 const channels=Array.isArray(scanner.state.telegramChannels)?scanner.state.telegramChannels:[];
 const outbox=Array.isArray(scanner.state.telegramOutbox)?scanner.state.telegramOutbox:[];
 const source=scanner.state.sources?.jupiterSellability||null;
 const priceSource=scanner.state.sources?.jupiterPrice||null;
 const now=Date.now();
 const ageMinutes=value=>{const at=Date.parse(value||'');return Number.isFinite(at)&&at<=now?Number(((now-at)/60000).toFixed(1)):null;};
 const topScoredTokens=Object.values(scanner.state.tokens).filter(token=>token?.analysis?.score!==null&&token?.analysis?.score!==undefined&&Number.isFinite(Number(token.analysis.score))).sort((a,b)=>Number(b.analysis.score)-Number(a.analysis.score)).slice(0,5).map(token=>{
  const trade=token.tradeIntel||{};
  const security=token.security?.data||{};
  const history=Array.isArray(token.history)?token.history.at(-1):null;
  const factors=token.analysis?.factors||{};
  return {
   mint:token.mint,symbol:token.symbol||null,score:token.analysis?.score??null,risk:token.analysis?.risk||null,hardBlocked:token.analysis?.hardBlocked===true,
   securityPublicationReady:token.analysis?.securityPublicationReady===true,securityComprehensive:token.analysis?.securityComprehensive===true,
   factors:{momentum:factors.momentum??null,security:factors.security??null,demandQuality:factors.demandQuality??null,executionQuality:factors.executionQuality??null},
   market:{ageMinutes:ageMinutes(history?.at),liquidityUsd:token.liquidityUsd??null,volume1hUsd:token.volume?.h1??null,buys1h:token.txns?.h1?.buys??null,sells1h:token.txns?.h1?.sells??null},
   securityEvidence:{ageMinutes:ageMinutes(token.security?.holderCheckedAt||token.security?.checkedAt),holderSampleAccounts:security.holderSampleAccounts??null,holderSampleCoveragePct:security.holderSampleCoveragePct??null,unknownOwnerAccounts:security.unknownOwnerAccounts??null,decimals:security.decimals??null},
   trade:{ageMinutes:ageMinutes(trade.checkedAt),lastTradeAgeMinutes:ageMinutes(trade.lastTradeAt),tradeCount:trade.tradeCount??null,uniqueBuyers:trade.uniqueBuyers??null,buyVolumeUsd:trade.buyVolumeUsd??null,sellVolumeUsd:trade.sellVolumeUsd??null},
   sellability:{status:token.sellability?.status||null,ageMinutes:ageMinutes(token.sellability?.checkedAt),routeAvailable:token.sellability?.routeAvailable??null,inputAmountUsd:token.sellability?.inputAmountUsd??null,reason:token.sellability?.reason||null},
   priceUsd:token.jupiterPrice?.priceUsd??token.priceUsd??null,priceSource:token.jupiterPrice?.priceUsd>0?'Jupiter':token.priceUsd>0?'DexScreener':null
  };
 });
 const candidates=[...(selection.best||[]),...(selection.observe||[])].slice(0,5).map(row=>{
  const token=scanner.state.tokens[row.mint]||{};
  const trade=token.tradeIntel||{};
  const security=token.security?.data||{};
  const factors=row.analysis?.factors||{};
  return {
   mint:row.mint,score:row.analysis?.score??null,coverage:row.analysis?.coverage??null,risk:row.analysis?.risk||null,
   securityPublicationReady:row.analysis?.securityPublicationReady===true,securityComprehensive:row.analysis?.securityComprehensive===true,
   factors:{momentum:factors.momentum??null,security:factors.security??null,demandQuality:factors.demandQuality??null,executionQuality:factors.executionQuality??null},
   freshness:row.freshness||null,
   trade:{ageMinutes:ageMinutes(trade.checkedAt),lastTradeAgeMinutes:ageMinutes(trade.lastTradeAt),tradeCount:trade.tradeCount??null,uniqueBuyers:trade.uniqueBuyers??null,buyVolumeUsd:trade.buyVolumeUsd??null,sellVolumeUsd:trade.sellVolumeUsd??null},
   sellability:{status:token.sellability?.status||null,ageMinutes:ageMinutes(token.sellability?.checkedAt),routeAvailable:token.sellability?.routeAvailable??null,requestedUsd:token.sellability?.requestedUsd??null,inputAmountUsd:token.sellability?.inputAmountUsd??null,reason:token.sellability?.reason||null},
   priceUsd:token.jupiterPrice?.priceUsd??token.priceUsd??null,priceSource:token.jupiterPrice?.priceUsd>0?'Jupiter':token.priceUsd>0?'DexScreener':null,
   tokenDecimals:security.decimals??null,holderSample:{accounts:security.holderSampleAccounts??null,coveragePct:security.holderSampleCoveragePct??null,unknownOwnerAccounts:security.unknownOwnerAccounts??null}
  };
 });
 return {
  at:new Date(now).toISOString(),
  scanner:{running:scanner.scanning===true,lastScanAt:scanner.state.lastScanAt||null,lastScanAttemptAt:scanner.lastScanAttemptAt||null,lastScanCompletedAt:scanner.state.lastScanCompletedAt||null,lastScanFailed:Boolean(scanner.state.lastScanError),lastScanSkipReason:scanner.lastScanSkipReason||null},
  selection:{considered:selection.considered||0,linked:selection.eligible||0,best:selection.best?.length||0,observe:selection.observe?.length||0,early:selection.early?.length||0},
  candidates,topScoredTokens,diagnostics:selection.diagnostics||{},qualityGate:selection.qualityGate||{},
  telegram:{botConfigured:Boolean(bot),channelsConfigured:scanner.state.telegramChannelsConfigured===true,channelCount:channels.length,enabledChannels:channels.filter(row=>row.enabled!==false).length,outboxQueued:outbox.filter(row=>row.status==='queued').length,outboxFailed:outbox.filter(row=>row.status==='failed').length},
  jupiterSellability:source?{ok:source.ok===true,at:source.at||null,checked:Number(source.checked)||0,status:source.status||null,reason:source.reason||null,priceUsd:source.priceUsd??null,decimals:source.decimals??null,error:source.error||null,mode:source.mode||null}:null,
  jupiterPrice:priceSource?{ok:priceSource.ok===true,at:priceSource.at||null,checked:Number(priceSource.checked)||0,priced:Number(priceSource.priced)||0,error:priceSource.error||null,mode:priceSource.mode||null}:null
 };
}
app.get('/health/selection',(_q,r)=>r.json({ok:true,...publicationDiagnosticsSnapshot()}));

app.post('/api/login',loginLimit,(q,r)=>{if(!equal(q.body?.code||'',CODE)){q.bad();return r.status(401).json({error:'Code incorrect'});}q.good();r.cookie(COOKIE,session(),{httpOnly:true,secure:PROD,sameSite:'strict',path:'/',maxAge:SESSION_TTL});r.json({ok:true});});
function escapePreviewMeta(value){
 return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
function previewReturn(entry,now=Date.now()){
 const price=Number(entry.lastCurrentPriceUsd),base=Number(entry.basePriceUsd),observedAt=Number(entry.lastCurrentObservedAt);
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(base)||base<=0||!Number.isFinite(observedAt)||observedAt<=0||observedAt>now+30000||now-observedAt>5*60*1000)return '—';
 const value=(price/base-1)*100,rounded=Number(value.toFixed(1));
 return (rounded>0?'+':'')+rounded.toFixed(1).replace('.',',')+' %';
}
function findTelegramPreview(req){
 const id=String(req.params.id||'');
 if(!/^[A-Za-z0-9_-]{20,40}$/.test(id))return null;
 return findTelegramPreviewEntry(scanner.state.telegramPerformance,scanner.telegramPreviewSeeds,id,Date.now());
}
app.get('/telegram-preview/:id/image.png',(req,res)=>{
 const entry=findTelegramPreview(req);
 if(!entry)return res.status(404).type('text').send('Preview indisponible');
 try{
  const png=renderTelegramPerformancePng(entry,Date.now());
  res.status(200).set('Content-Type','image/png').set('Cache-Control','no-store, max-age=0').set('X-Content-Type-Options','nosniff').send(png);
 }catch(error){
  console.error('[telegram preview image]',String(error.message||error).slice(0,160));
  res.status(500).type('text').send('Preview indisponible');
 }
});
app.get('/telegram-preview/:id',(req,res)=>{
 const entry=findTelegramPreview(req);
 if(!entry)return res.status(404).type('text').send('Preview indisponible');
 const base=URL||'https://m2meme.fadehost.app';
 const version=String(req.query.v||entry.lastCurrentObservedAt||entry.publishedAt).slice(0,100);
 const pageUrl=base+'/telegram-preview/'+entry.previewId+'?v='+encodeURIComponent(version);
 const imageUrl=base+'/telegram-preview/'+entry.previewId+'/image.png?v='+encodeURIComponent(version);
 const identity=[entry.tokenName,entry.tokenSymbol?String.fromCharCode(36)+entry.tokenSymbol:''].filter(Boolean).join(' · ')||'Memecoin';
 const title=identity+' — Performance M2Meme';
 const description='Depuis publication : '+previewReturn(entry)+'. Suivi aux échéances 1 h, 2 h, 3 h, 6 h, 10 h et 24 h.';
 const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  +'<meta name="robots" content="noindex,nofollow"><meta property="og:type" content="website">'
  +'<meta property="og:site_name" content="M2Meme"><meta property="og:title" content="'+escapePreviewMeta(title)+'">'
  +'<meta property="og:description" content="'+escapePreviewMeta(description)+'">'
  +'<meta property="og:url" content="'+escapePreviewMeta(pageUrl)+'"><meta property="og:image" content="'+escapePreviewMeta(imageUrl)+'">'
  +'<meta property="og:image:secure_url" content="'+escapePreviewMeta(imageUrl)+'"><meta property="og:image:type" content="image/png">'
  +'<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
  +'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="'+escapePreviewMeta(title)+'">'
  +'<meta name="twitter:description" content="'+escapePreviewMeta(description)+'"><meta name="twitter:image" content="'+escapePreviewMeta(imageUrl)+'">'
  +'<title>'+escapePreviewMeta(title)+'</title></head><body><p>'+escapePreviewMeta(description)+'</p><img src="'+escapePreviewMeta(imageUrl)+'" width="1200" height="630" alt="Performance M2Meme"></body></html>';
 res.status(200).set('Cache-Control','no-store, max-age=0').type('html').send(html);
});
app.use('/api',auth,origin);
app.post('/api/logout',(_q,r)=>{r.clearCookie(COOKIE,{httpOnly:true,secure:PROD,sameSite:'strict',path:'/'});r.json({ok:true});});
app.get('/api/me',(_q,r)=>r.json({ok:true,authenticated:true}));
app.get('/api/scanner-settings',(_q,r)=>r.json({ok:true,settings:scanner.state.scannerSettings}));
app.patch('/api/scanner-settings',(q,r)=>{
 const previous=scanner.state.scannerSettings;
 let next;
 try{next=applyScannerSettingsPatch(previous,q.body||{});}
 catch(error){return r.status(400).json({error:error.message||'Réglages invalides.'});}
 scanner.state.scannerSettings=next;
 try{scanner.save();}
 catch(error){scanner.state.scannerSettings=previous;return r.status(500).json({error:'Impossible de sauvegarder les réglages.'});}
 r.json({ok:true,settings:scanner.state.scannerSettings});
});

app.get('/api/status',(_q,r)=>r.json(scanner.overview()));app.get('/api/overview',(_q,r)=>r.json(scanner.overview()));
app.get('/api/selection',(_q,r)=>{const selection=scanner.selection();r.json({ok:true,...selection,publicationDiagnostics:publicationDiagnosticsSnapshot(selection)});});
app.get('/api/publication-diagnostics',(_q,r)=>r.json({ok:true,...publicationDiagnosticsSnapshot()}));
app.get('/api/launches',(_q,r)=>{const tokens=Object.values(scanner.state.tokens).filter(t=>t.launchSource||t.geckoPoolAddress).sort((a,b)=>Date.parse(b.launchCreatedAt||b.pumpCreatedAt||b.geckoPoolCreatedAt||b.firstSeenAt||0)-Date.parse(a.launchCreatedAt||a.pumpCreatedAt||a.geckoPoolCreatedAt||a.firstSeenAt||0)).slice(0,150);r.json({ok:true,tokens,sources:{pumpPortal:scanner.status().pumpPortal,launchpadDiscovery:scanner.status().launchpadDiscovery,geckoTerminal:scanner.status().geckoTerminal}});});
app.get('/api/tokens',(q,r)=>{const tokens=scanner.tokens({sort:String(q.query.sort||'score'),limit:Math.min(250,Number(q.query.limit)||100),search:String(q.query.search||'').slice(0,80),includeBlocked:q.query.includeBlocked!=='false'});r.json({ok:true,tokens,count:tokens.length,lastScanAt:scanner.state.lastScanAt});});
app.get('/api/token/:mint',async(q,r)=>{try{const token=await scanner.detail(q.params.mint);let social=null;if(q.query.social==='true')social=await scanner.social(q.params.mint).catch(e=>({configured:true,error:e.message}));r.json({ok:true,token,social});}catch(e){r.status(404).json({error:e.message});}});
app.post('/api/scan',async(_q,r)=>{if(Date.now()-lastManual<20000)return r.status(429).json({error:'Attends 20 secondes avant un nouveau scan.'});lastManual=Date.now();try{r.json({ok:true,result:await scanner.scan(),overview:scanner.overview()});}catch(e){r.status(503).json({error:e.message});}});
app.get('/api/alerts',(_q,r)=>r.json({ok:true,alerts:scanner.state.alerts.slice(-150).reverse()}));
app.get('/api/telegram/publication-audit',(q,r)=>{
 const limit=Math.min(100,Math.max(1,Number(q.query.limit)||50));
 const publications=buildTelegramPublicationAudit({performance:scanner.state.telegramPerformance,alerts:scanner.state.alerts,tokens:scanner.state.tokens,limit,now:Date.now()});
 r.json({ok:true,generatedAt:new Date().toISOString(),count:publications.length,publications});
});
app.get('/api/watchlist',(_q,r)=>r.json({ok:true,watchlist:scanner.state.watchlist}));
app.post('/api/watchlist',(q,r)=>{try{r.json({ok:true,watchlist:scanner.addWatch(String(q.body?.mint||''))});}catch(e){r.status(400).json({error:e.message});}});
app.delete('/api/watchlist/:mint',(q,r)=>r.json({ok:true,watchlist:scanner.removeWatch(q.params.mint)}));
app.get('/api/wallets',(_q,r)=>r.json({ok:true,wallets:scanner.state.wallets.map(w=>({...w,activity:scanner.state.walletActivity[w.address]||null})),autoWallets:(scanner.state.autoWallets||[]).map(w=>({...w,...scoreWalletDiscovery(w),activity:scanner.state.walletActivity[w.address]||null}))}));
app.get('/api/intelligence/creators',(_q,r)=>r.json({ok:true,creators:scanner.creatorIntel(),fundingClusters:scanner.creatorFundingClusters()}));
app.get('/api/intelligence/wallets',(_q,r)=>{const data=scanner.walletIntel();r.json({ok:true,wallets:data.wallets,clusters:data.clusters});});
app.get('/api/intelligence/wallet-graph',(_q,r)=>r.json({ok:true,...scanner.walletGraphIntel()}));
app.get('/api/intelligence/wallet-reputation',(_q,r)=>r.json({ok:true,...buildWalletReputation(scanner.state)}));
app.get('/api/intelligence/wallet-signal-backtest',(_q,r)=>r.json({ok:true,...scanner.walletSignalBacktest()}));
app.get('/api/intelligence/experts',(_q,r)=>r.json({ok:true,...buildHeliusWalletSnapshot(scanner.state,scanner.status().solanaRpc)}));
app.get('/api/data-quality',(_q,r)=>r.json({ok:true,...scanner.dataQualitySummary()}));
app.get('/api/backtest',(_q,r)=>r.json({ok:true,...scanner.backtest()}));
app.get('/api/paper-trading',(_q,r)=>r.json({ok:true,...getPaperTradingSummary(scanner.state,Date.now())}));
app.post('/api/paper-trading/config',(q,r)=>{if(typeof q.body?.enabled!=='boolean')return r.status(400).json({error:'Le champ enabled doit être booléen.'});setPaperTradingEnabled(scanner.state,q.body.enabled);try{const summary=stepPaperTrading(scanner.state,scanner.selection(),Date.now());scanner.save();r.json({ok:true,...summary});}catch(error){r.status(500).json({error:'Impossible de sauvegarder la configuration paper trading.'});}});
app.get('/api/learning',(_q,r)=>r.json({ok:true,...scanner.learningSummary(),archive:scanner.state.archiveLearning||null,archiveUpdatedAt:scanner.state.archiveLearningGeneratedAt||null}));
app.get('/api/selection-performance',(_q,r)=>r.json({ok:true,...require('./lib/selection-cohort').buildSelectionPerformance(scanner.state)}));
app.get('/api/backtest/historical',(_q,r)=>r.json({ok:true,...scanner.getHistoricalBenchmark()}));
app.get('/api/backtest/historical/status',(_q,r)=>r.json({ok:true,running:false,automatic:false,executor:'GitHub Actions',configured:String(process.env.MEME_RADAR_ACTIONS_TOKEN||'').length>=32,lastRunAt:scanner.state.historicalBenchmarkActionsAt||null,...scanner.getHistoricalBenchmark()}));
app.post('/api/backtest/historical/run',async(_q,r)=>r.status(410).json({error:'Le benchmark historique est maintenant exécuté automatiquement.'}));
app.post('/api/wallets',(q,r)=>{try{r.json({ok:true,wallets:scanner.addWallet(String(q.body?.address||''),String(q.body?.label||''))});}catch(e){r.status(400).json({error:e.message});}});
app.delete('/api/wallets/:address',(q,r)=>r.json({ok:true,wallets:scanner.removeWallet(q.params.address)}));
app.get('/api/telegram/connect',async(_q,r)=>{if(!bot)return r.json({ok:true,botConfigured:false,connectUrl:null});try{const me=await bot.api.getMe();if(!me.username)return r.status(503).json({error:'Le bot Telegram ne possède pas de nom d’utilisateur public.'});r.json({ok:true,botConfigured:true,botUsername:me.username,connectUrl:'https://t.me/'+me.username+'?startchannel&admin=post_messages'});}catch(error){r.status(502).json({error:'Impossible de contacter Telegram : '+String(error.message||error).slice(0,140)});}});
app.get('/api/telegram/channels',(_q,r)=>r.json({ok:true,botConfigured:Boolean(bot),channels:scanner.state.telegramChannels||[]}));
app.post('/api/telegram/channels',(q,r)=>{
 const result=addTelegramChannel(scanner.state.telegramChannels,{chatId:String(q.body?.chatId||''),label:String(q.body?.label||'')});
 if(!result.ok)return r.status(400).json({error:result.error});
 scanner.state.telegramChannels=result.channels;scanner.state.telegramChannelsConfigured=true;
 try{scanner.save();r.status(201).json({ok:true,channels:scanner.state.telegramChannels});}
 catch(error){r.status(500).json({error:'Impossible de sauvegarder les canaux.'});}
});
app.patch('/api/telegram/channels/:chatId',(q,r)=>{
 const result=updateTelegramChannel(scanner.state.telegramChannels,q.params.chatId,{enabled:q.body?.enabled,label:q.body?.label});
 if(!result.ok)return r.status(404).json({error:result.error});
 scanner.state.telegramChannels=result.channels;scanner.state.telegramChannelsConfigured=true;
 try{scanner.save();r.json({ok:true,channels:scanner.state.telegramChannels});}
 catch(error){r.status(500).json({error:'Impossible de sauvegarder les canaux.'});}
});
app.delete('/api/telegram/channels/:chatId',(q,r)=>{
 const result=removeTelegramChannel(scanner.state.telegramChannels,q.params.chatId);
 if(!result.ok)return r.status(404).json({error:result.error});
 scanner.state.telegramChannels=result.channels;scanner.state.telegramChannelsConfigured=true;
 try{scanner.save();r.json({ok:true,channels:scanner.state.telegramChannels});}
 catch(error){r.status(500).json({error:'Impossible de sauvegarder les canaux.'});}
});
app.post('/api/telegram/channels/test',async(q,r)=>{
 const chatId=String(q.body?.chatId||'').trim();
 if(!bot)return r.status(400).json({error:'Configure TELEGRAM_BOT_TOKEN dans FadeHost.'});
 if(!validChatId(chatId))return r.status(400).json({error:'Identifiant Telegram invalide.'});
 try{await bot.api.sendMessage(chatId,'✅ MEME RADAR : connexion du canal réussie. Les trouvailles sélectionnées pourront être publiées ici.',{disable_web_page_preview:true});r.json({ok:true});}
 catch(error){r.status(502).json({error:'Envoi impossible. Vérifie que le bot est administrateur du canal. '+String(error.message||error).slice(0,140)});}
});
app.post('/api/telegram/test',async(_q,r)=>{if(!bot||!scanner.chat)return r.status(400).json({error:'Configure BOT_TOKEN et TELEGRAM_CHAT_ID dans FadeHost'});try{await bot.api.sendMessage(scanner.chat,'MEME RADAR : test de notification réussi.');r.json({ok:true});}catch(e){r.status(502).json({error:e.message});}});
app.use('/assets',express.static(path.join(__dirname,'public'),{index:false,maxAge:PROD?'1h':0}));app.get('/login',(_q,r)=>r.sendFile(path.join(__dirname,'public','login.html')));app.get('/',(q,r)=>valid(q.cookies[COOKIE])?r.sendFile(path.join(__dirname,'public','dashboard.html')):r.redirect('/login'));
app.use((e,_q,r,_n)=>{console.error('[http]',e.message);r.status(500).json({error:'Erreur interne'});});
if(bot){bot.command('scan',async ctx=>{await ctx.reply('Scan lancé…');try{const x=await scanner.scan();await ctx.reply('Scan terminé : '+x.discovered+' candidats, '+x.total+' tokens suivis.');}catch(e){await ctx.reply('Erreur : '+e.message);}});bot.command('opportunities',async ctx=>{const a=scanner.tokens({limit:8}).filter(t=>t.analysis?.score!==null&&!t.analysis?.hardBlocked);if(!a.length)return ctx.reply('Aucun signal qualifié pour le moment.');await ctx.reply('Signaux MEME RADAR (recherche uniquement)\n\n'+a.map((t,i)=>(i+1)+'. '+(t.symbol||'—')+' '+t.analysis.score+'/100 · '+t.analysis.coverage+'%\n'+(t.dexUrl||'https://dexscreener.com/solana/'+t.mint)).join('\n\n'));});bot.catch(e=>console.error('[telegram update]',e.message));}
// Process lifecycle diagnostics: SIGKILL/OOM cannot be caught in Node, but the last RSS sample helps identify memory pressure.
const processStartedAt=Date.now();
let memoryLogTimer=null;
process.on('uncaughtExceptionMonitor',(error,origin)=>console.error('[process] uncaught exception', {origin,message:error?.message,stack:error?.stack}));
process.on('exit',(code)=>console.error('[process] exiting', {code,uptimeSeconds:Math.round(process.uptime()),rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed,startedAt:new Date(processStartedAt).toISOString()}));
process.once('SIGTERM',()=>console.warn('[process] received SIGTERM'));
process.once('SIGINT',()=>console.warn('[process] received SIGINT'));
let lastMemoryWarningAt=0;
memoryLogTimer=setInterval(()=>{
 const m=process.memoryUsage(),rssMiB=Math.round(m.rss/1048576),heapUsedMiB=Math.round(m.heapUsed/1048576);
 console.log('[process] memory',{rssMiB,heapUsedMiB,heapTotalMiB:Math.round(m.heapTotal/1048576),externalMiB:Math.round(m.external/1048576),uptimeSeconds:Math.round(process.uptime())});
 if(rssMiB>=220&&Date.now()-lastMemoryWarningAt>=30000){lastMemoryWarningAt=Date.now();console.warn('[process] memory pressure warning: RSS reached',rssMiB,'MiB (hosting limit may be 256 MiB)');}
},10000);
memoryLogTimer.unref();
const server=app.listen(PORT,'0.0.0.0',()=>{console.log('MEME RADAR listening on '+PORT);scanner.start().catch(e=>console.error('[scanner]',e.message));if(bot){console.log('[telegram] Starting grammY long polling…');bot.start({allowed_updates:['message','my_chat_member']}).then(()=>console.log('[telegram] Polling stopped cleanly')).catch(e=>console.error('[telegram polling] Startup/runtime failure:',e.message));}else{console.warn('[telegram] Bot disabled: set TELEGRAM_BOT_TOKEN (or legacy BOT_TOKEN) in the hosting environment.');}});server.requestTimeout=20000;server.headersTimeout=25000;server.keepAliveTimeout=5000;
async function shutdown(){scanner.stop();if(bot)await bot.stop();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();}process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
