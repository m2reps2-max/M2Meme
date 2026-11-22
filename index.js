'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const express=require('express');
const helmet=require('helmet');
const cookieParser=require('cookie-parser');
const {Bot,InlineKeyboard}=require('grammy');
const {MemeScanner}=require('./lib/scanner');
const PORT=Number(process.env.PORT||3000),CODE=String(process.env.DASHBOARD_ACCESS_CODE||''),SECRET=String(process.env.DASHBOARD_SESSION_SECRET||''),URL=String(process.env.DASHBOARD_URL||'').replace(/\/$/,'');
const PROD=process.env.NODE_ENV==='production',COOKIE='meme_radar_session',TEN_YEARS=10*365*24*60*60*1000;
if(!CODE.trim()||SECRET.length<32){console.error('DASHBOARD_ACCESS_CODE (non vide) et DASHBOARD_SESSION_SECRET (32+) sont requis.');process.exit(1);}
if(PROD&&!URL.startsWith('https://')){console.error('DASHBOARD_URL doit être en HTTPS en production.');process.exit(1);}
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use(express.json({limit:'24kb'}));app.use(cookieParser());
const fails=new Map();
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function sign(s){return crypto.createHmac('sha256',SECRET).update(s).digest('base64url');}
function fingerprint(){return crypto.createHash('sha256').update(CODE).digest('hex');}
function session(){const p=Buffer.from(JSON.stringify({v:1,code:fingerprint(),iat:Date.now(),nonce:crypto.randomBytes(12).toString('hex')})).toString('base64url');return p+'.'+sign(p);}
function valid(t){if(typeof t!=='string'||t.length>2048)return false;const i=t.lastIndexOf('.');if(i<1||!equal(sign(t.slice(0,i)),t.slice(i+1)))return false;try{const p=JSON.parse(Buffer.from(t.slice(0,i),'base64url').toString());return p.v===1&&p.code===fingerprint()&&p.iat<=Date.now()+60000;}catch{return false;}}
function auth(req,res,next){if(!valid(req.cookies[COOKIE]))return res.status(401).json({error:'Authentification requise'});next();}
function origin(req,res,next){const o=req.get('origin');if(o){try{if(new URL(o).host!==req.get('host'))return res.status(403).json({error:'Origine refusée'});}catch{return res.status(403).json({error:'Origine invalide'});}}if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Requête cross-site refusée'});next();}
function loginLimit(req,res,next){const key=String(req.ip||'unknown'),now=Date.now();let x=fails.get(key)||{n:0,until:now+900000};if(x.until<now)x={n:0,until:now+900000};if(x.n>=8)return res.status(429).json({error:'Trop de tentatives. Réessaie plus tard.'});req.bad=()=>{x.n++;fails.set(key,x);};req.good=()=>fails.delete(key);next();}
let bot=null;if(process.env.BOT_TOKEN){bot=new Bot(process.env.BOT_TOKEN);const kb=()=>new InlineKeyboard().url('Ouvrir MEME RADAR',URL||'https://example.com');bot.command('start',ctx=>ctx.reply('Bienvenue sur MEME RADAR.',{reply_markup:kb()}));bot.command('dashboard',ctx=>ctx.reply('Ouvre ton dashboard privé :',{reply_markup:kb()}));bot.command('help',ctx=>ctx.reply('Commandes : /start /dashboard /scan /opportunities /help. Recherche uniquement, aucun achat automatique.'));}
const scanner=new MemeScanner({dataFile:path.join(__dirname,'data','store.json'),bot,telegramChatId:process.env.TELEGRAM_CHAT_ID});let lastManual=0;
app.get('/health',(_q,r)=>{const health=scanner.healthSummary();r.json({ok:true,service:'meme-radar',scannerRunning:scanner.running,health,at:new Date().toISOString()});});
app.get('/health/ready',(_q,r)=>{const health=scanner.healthSummary();const ready=health.checks.scanner.ok&&health.checks.dexscreener.ok;r.status(ready?200:503).json({ok:ready,health,at:new Date().toISOString()});});
app.post('/api/login',loginLimit,(q,r)=>{if(!equal(q.body?.code||'',CODE)){q.bad();return r.status(401).json({error:'Code incorrect'});}q.good();r.cookie(COOKIE,session(),{httpOnly:true,secure:PROD,sameSite:'strict',path:'/',maxAge:TEN_YEARS});r.json({ok:true});});
app.post('/api/logout',(_q,r)=>{r.clearCookie(COOKIE,{httpOnly:true,secure:PROD,sameSite:'strict',path:'/'});r.json({ok:true});});
app.get('/api/me',auth,(_q,r)=>r.json({ok:true,authenticated:true}));app.use('/api',auth,origin);
app.get('/api/status',(_q,r)=>r.json(scanner.overview()));app.get('/api/overview',(_q,r)=>r.json(scanner.overview()));
app.get('/api/launches',(_q,r)=>{const tokens=Object.values(scanner.state.tokens).filter(t=>t.launchSource||t.geckoPoolAddress).sort((a,b)=>Date.parse(b.pumpCreatedAt||b.geckoPoolCreatedAt||b.firstSeenAt||0)-Date.parse(a.pumpCreatedAt||a.geckoPoolCreatedAt||a.firstSeenAt||0)).slice(0,150);r.json({ok:true,tokens,sources:{pumpPortal:scanner.status().pumpPortal,geckoTerminal:scanner.status().geckoTerminal}});});
app.get('/api/tokens',(q,r)=>{const tokens=scanner.tokens({sort:String(q.query.sort||'score'),limit:Math.min(250,Number(q.query.limit)||100),search:String(q.query.search||'').slice(0,80),includeBlocked:q.query.includeBlocked!=='false'});r.json({ok:true,tokens,count:tokens.length,lastScanAt:scanner.state.lastScanAt});});
app.get('/api/token/:mint',async(q,r)=>{try{const token=await scanner.detail(q.params.mint);let social=null;if(q.query.social==='true')social=await scanner.social(q.params.mint).catch(e=>({configured:true,error:e.message}));r.json({ok:true,token,social});}catch(e){r.status(404).json({error:e.message});}});
app.post('/api/scan',async(_q,r)=>{if(Date.now()-lastManual<20000)return r.status(429).json({error:'Attends 20 secondes avant un nouveau scan.'});lastManual=Date.now();try{r.json({ok:true,result:await scanner.scan(),overview:scanner.overview()});}catch(e){r.status(503).json({error:e.message});}});
app.get('/api/alerts',(_q,r)=>r.json({ok:true,alerts:scanner.state.alerts.slice(-150).reverse()}));
app.get('/api/watchlist',(_q,r)=>r.json({ok:true,watchlist:scanner.state.watchlist}));
app.post('/api/watchlist',(q,r)=>{try{r.json({ok:true,watchlist:scanner.addWatch(String(q.body?.mint||''))});}catch(e){r.status(400).json({error:e.message});}});
app.delete('/api/watchlist/:mint',(q,r)=>r.json({ok:true,watchlist:scanner.removeWatch(q.params.mint)}));
app.get('/api/wallets',(_q,r)=>r.json({ok:true,wallets:scanner.state.wallets.map(w=>({...w,activity:scanner.state.walletActivity[w.address]||null})),autoWallets:(scanner.state.autoWallets||[]).map(w=>({...w,activity:scanner.state.walletActivity[w.address]||null}))}));
app.get('/api/intelligence/creators',(_q,r)=>r.json({ok:true,creators:scanner.creatorIntel(),fundingClusters:scanner.creatorFundingClusters()}));
app.get('/api/intelligence/wallets',(_q,r)=>{const data=scanner.walletIntel();r.json({ok:true,wallets:data.wallets,clusters:data.clusters});});\napp.get('/api/intelligence/wallet-graph',(_q,r)=>r.json({ok:true,...scanner.walletGraphIntel()}));\napp.get('/api/data-quality',(_q,r)=>r.json({ok:true,...scanner.dataQualitySummary()}));
app.get('/api/backtest',(_q,r)=>r.json({ok:true,...scanner.backtest()}));
app.get('/api/learning',(_q,r)=>r.json({ok:true,...scanner.learningSummary()}));
app.get('/api/backtest/historical',(_q,r)=>r.json({ok:true,...scanner.getHistoricalBenchmark()}));
let lastHistoricalRun=0,historicalRunning=false,historicalTimer=null;
async function runHistoricalAutomatically(){if(historicalRunning||Date.now()-lastHistoricalRun<20000)return;historicalRunning=true;lastHistoricalRun=Date.now();try{const result=await scanner.runHistoricalBenchmark();if(result.error)console.warn('[historical benchmark]',result.symbol,result.error);else if(result.benchmark)console.log('[historical benchmark]',result.benchmark.symbol,'completed');}catch(e){console.error('[historical benchmark]',e.message);}finally{historicalRunning=false;}}
app.get('/api/backtest/historical/status',(_q,r)=>r.json({ok:true,running:historicalRunning,automatic:true,lastRunAt:lastHistoricalRun?new Date(lastHistoricalRun).toISOString():null,...scanner.getHistoricalBenchmark()}));
app.post('/api/backtest/historical/run',async(_q,r)=>r.status(410).json({error:'Le benchmark historique est maintenant exécuté automatiquement.'}));
app.post('/api/wallets',(q,r)=>{try{r.json({ok:true,wallets:scanner.addWallet(String(q.body?.address||''),String(q.body?.label||''))});}catch(e){r.status(400).json({error:e.message});}});
app.delete('/api/wallets/:address',(q,r)=>r.json({ok:true,wallets:scanner.removeWallet(q.params.address)}));
app.post('/api/telegram/test',async(_q,r)=>{if(!bot||!scanner.chat)return r.status(400).json({error:'Configure BOT_TOKEN et TELEGRAM_CHAT_ID dans FadeHost'});try{await bot.api.sendMessage(scanner.chat,'MEME RADAR : test de notification réussi.');r.json({ok:true});}catch(e){r.status(502).json({error:e.message});}});
app.use('/assets',express.static(path.join(__dirname,'public'),{index:false,maxAge:PROD?'1h':0}));app.get('/login',(_q,r)=>r.sendFile(path.join(__dirname,'public','login.html')));app.get('/',(q,r)=>valid(q.cookies[COOKIE])?r.sendFile(path.join(__dirname,'public','dashboard.html')):r.redirect('/login'));
app.use((e,_q,r,_n)=>{console.error('[http]',e.message);r.status(500).json({error:'Erreur interne'});});
if(bot){bot.command('scan',async ctx=>{await ctx.reply('Scan lancé…');try{const x=await scanner.scan();await ctx.reply('Scan terminé : '+x.discovered+' candidats, '+x.total+' tokens suivis.');}catch(e){await ctx.reply('Erreur : '+e.message);}});bot.command('opportunities',async ctx=>{const a=scanner.tokens({limit:8}).filter(t=>t.analysis?.score!==null&&!t.analysis?.hardBlocked);if(!a.length)return ctx.reply('Aucun signal qualifié pour le moment.');await ctx.reply('Signaux MEME RADAR (recherche uniquement)\n\n'+a.map((t,i)=>(i+1)+'. '+(t.symbol||'—')+' '+t.analysis.score+'/100 · '+t.analysis.coverage+'%\n'+(t.dexUrl||'https://dexscreener.com/solana/'+t.mint)).join('\n\n'));});bot.catch(e=>console.error('[telegram]',e.message));bot.start().catch(e=>console.error('[telegram polling]',e.message));}
const server=app.listen(PORT,'0.0.0.0',()=>{console.log('MEME RADAR listening on '+PORT);scanner.start().catch(e=>console.error('[scanner]',e.message));setTimeout(()=>{runHistoricalAutomatically();historicalTimer=setInterval(runHistoricalAutomatically,30000);},12000);});server.requestTimeout=20000;server.headersTimeout=25000;server.keepAliveTimeout=5000;
async function shutdown(){scanner.stop();clearInterval(historicalTimer);if(bot)await bot.stop();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();}process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
