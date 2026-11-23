'use strict';
const { normalizeTelegramChannels, formatTelegramAlert } = require('./telegram-channels');
const { createTelegramOutboxEntry, claimDueTelegramOutbox, markTelegramOutboxSent, markTelegramOutboxFailed } = require('./telegram-outbox');
const fs = require('node:fs');
const { writeJsonFileSync } = require('./stream-json-write');
const path = require('node:path');
const { analyzeLargestHolders } = require('./holder-intel');
const { readJsonLimited } = require('./http-body');
const { LaunchStream } = require('./launch-stream');
const { analyzeMicrostructure } = require('./market-intel');
const { narrativeSummary } = require('./narratives');
const { fetchNewPools, fetchTrendingPools, parseNewPools, resolveNewPoolPageLimit, resolveNewPoolPageSequence, fetchPoolTrades, analyzePoolTrades, mergeObservedTrades } = require('./gecko-discovery');
const { RedditRadar } = require('./social-radar');
const { BlueskyRadar } = require('./bluesky-radar');
const { NostrRadar } = require('./nostr-radar');
const { TelegramRadar } = require('./telegram-radar');
const { extractCreatorFunder } = require('./creator-funding');
const { qualifyAlertLevel } = require('./alert-quality');
const { evaluateCandidateIntel } = require('./candidate-intel');
const { recordEarlyBuyerCandidates, scoreWalletDiscovery } = require('./wallet-discovery');
const { buildWalletTokenSignals } = require('./wallet-token-signals');
const { ensureLaunchCohort, observeLaunchCohort, resolveNoMarketCohorts } = require('./launch-cohort');
const { freshState, normalizeState, limitForecastHistory } = require('./state-normalizer');
const { TokenArchive } = require('./token-archive');
const { buildSelection, resolveAdaptiveSelectionThreshold } = require('./selection');
const { stepPaperTrading } = require('./paper-trading');
const { fetchJupiterPrices } = require('./jupiter-price');
const { updateSelectionCohorts } = require('./selection-cohort');
const { selectRotatingBatch, selectFreshDiscoveryBatch } = require('./discovery-rotation');
const DEX = 'https://api.dexscreener.com';
function buildRpcEndpoints({heliusApiKey=process.env.HELIUS_API_KEY,customRpcUrl=process.env.SOLANA_RPC_URL}={}) {
  const endpoints=[];
  const key=String(heliusApiKey||'').trim();
  const custom=String(customRpcUrl||'').trim();
  if(key)endpoints.push('https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(key));
  if(custom)endpoints.push(custom);
  endpoints.push('https://api.mainnet.solana.com','https://solana-rpc.publicnode.com');
  return [...new Set(endpoints)];
}
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const clamp = v => Math.max(0, Math.min(100, n(v)));
const iso = () => new Date().toISOString();
const wait = ms => new Promise(r => setTimeout(r, ms));
function topTokens(tokens, predicate, compare, limit) {
  const selected = [];
  for (const mint in tokens) {
    if (!Object.prototype.hasOwnProperty.call(tokens, mint)) continue;
    const token = tokens[mint];
    if (!token || !predicate(token)) continue;
    let low = 0, high = selected.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(token, selected[middle]) < 0) high = middle;
      else low = middle + 1;
    }
    if (low < limit) {
      selected.splice(low, 0, token);
      if (selected.length > limit) selected.pop();
    } else if (selected.length < limit) selected.push(token);
  }
  return selected;
}

function memoryBudget({maxHeapMiB=76,maxExternalMiB=20,maxRssMiB=252}={}) {
  const usage=process.memoryUsage();
  const heapMiB=usage.heapUsed/1048576,externalMiB=usage.external/1048576;
  const rssMiB=Number.isFinite(usage.rss)?usage.rss/1048576:null;
  const rssOk=rssMiB===null||rssMiB<=maxRssMiB;
  return {ok:heapMiB<=maxHeapMiB&&externalMiB<=maxExternalMiB&&rssOk,heapMiB:Number(heapMiB.toFixed(1)),externalMiB:Number(externalMiB.toFixed(1)),rssMiB:rssMiB===null?null:Number(rssMiB.toFixed(1)),maxHeapMiB,maxExternalMiB,maxRssMiB};
}
async function json(url, options = {}, retries = 1, maxBytes = 2 * 1024 * 1024) {
  let error;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
      if ((r.status === 429 || r.status >= 500) && i < retries) { await wait(500 * (i + 1)); continue; }
      let data; try { data = await readJsonLimited(r, maxBytes); } catch (error) { throw new Error('Réponse invalide (' + r.status + '): ' + error.message); }
      if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + String(data.message || data.error || r.statusText).slice(0, 160));
      return data;
    } catch (e) { error = e; if (i < retries && (e.name === 'TimeoutError' || e.name === 'TypeError')) { await wait(300 * (i + 1)); continue; } break; }
  }
  throw error || new Error('Source indisponible');
}
function fresh() { return freshState(); }
class MemeScanner {
  constructor({ dataFile, bot, telegramChatId }) {
    this.file = dataFile || path.join(__dirname, '..', 'data', 'store.json');
    this.archive = new TokenArchive({ file: path.join(path.dirname(this.file), 'tokens.archive.sqlite'), maxTokens: Number(process.env.TOKEN_ARCHIVE_MAX) || 100000 });
    if (!this.archive.available) console.warn('[token archive] SQLite cold archive disabled:', this.archive.lastError || 'unsupported runtime');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const sourceVersion = raw && typeof raw === 'object' ? raw.version : undefined;
      this.state = normalizeState(raw, { mutate: true, maxTokens: this.archive.available ? 1200 : Infinity });
      if (sourceVersion !== undefined && sourceVersion !== 3) this.state.migratedFromVersion = sourceVersion;
    }
    catch (primaryError) {
      const preserveCorruptPrimary = () => {
        if (primaryError.code === 'ENOENT') return;
        try {
          const corrupt = this.file + '.corrupt-' + Date.now();
          fs.renameSync(this.file, corrupt);
          this.state.corruptFile = path.basename(corrupt);
        } catch (renameError) {
          try {
            const corrupt = this.file + '.corrupt-' + Date.now();
            fs.copyFileSync(this.file, corrupt, fs.constants.COPYFILE_EXCL);
            this.state.corruptFile = path.basename(corrupt);
            fs.unlinkSync(this.file);
          } catch (copyError) {
            console.error('[persistence recovery] impossible de préserver le fichier corrompu:', copyError.message || renameError.message);
          }
        }
      };
      try {
        const backup = JSON.parse(fs.readFileSync(this.file + '.bak', 'utf8'));
        const sourceVersion = backup && typeof backup === 'object' ? backup.version : undefined;
        this.state = normalizeState(backup, { mutate: true, maxTokens: this.archive.available ? 1200 : Infinity });
        if (sourceVersion !== undefined && sourceVersion !== 3) this.state.migratedFromVersion = sourceVersion;
        this.state.recoveredFromBackup = true;
        this.state.recoveryWarning = 'Le fichier principal était illisible; la dernière sauvegarde valide a été restaurée.';
        preserveCorruptPrimary();
      } catch (backupError) {
        this.state = fresh();
        if (primaryError.code !== 'ENOENT') {
          this.state.recoveryWarning = 'Les fichiers de données principal et de sauvegarde étaient illisibles; un état vide a été initialisé. Le fichier corrompu est conservé.';
          preserveCorruptPrimary();
        }
      }
    }
    this.bot = bot || null; this.chat = String(telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    this.state.telegramChannels=normalizeTelegramChannels(this.state.telegramChannels);
    if(!this.state.telegramChannelsConfigured&&!this.state.telegramChannels.length&&this.chat){this.state.telegramChannels=normalizeTelegramChannels([],this.chat);this.state.telegramChannelsConfigured=true;}
    this.running = false; this.timer = null; this.walletTimer = null; this.socialTimer = null; this.persistTimer = null; this.startupTimers=[]; this.backgroundTaskRunning=null; this.backgroundRetryTimers=new Map(); this.lastBackgroundSkipLogAt=0; this.lastSecurity = 0; this.lastSavedAt = null; this.lastPersistenceError = null;
    this.rpcEndpoints=buildRpcEndpoints(); this.rpcProviderIndex=0; this.autoWalletCursor=0; this.rpcProviderBackoff=new Map(); this.redditRadar = new RedditRadar(); this.blueskyRadar = new BlueskyRadar(); this.nostrRadar = new NostrRadar(); this.telegramRadar = new TelegramRadar(); this.geckoTradeQueue = Promise.resolve(); this.lastGeckoTradeFetch = 0; this.lastAutoCreatorFundingAt = 0; this.socialCursor=0; this.nostrCursor=0; this.telegramCursor=0; this.creatorCursor=0; this.lastAlertThreshold={threshold:n(process.env.ALERT_MIN_SCORE)||78,source:'configured',validated:false,holdoutTokens:0};
    this.launchStream = new LaunchStream({ onToken: event => this.ingestLaunch(event), onMigration: event => this.ingestMigration(event) });
  }
  save() {
    this.state.updatedAt = iso();
    const sortedTokens = Object.entries(this.state.tokens).sort((a,b) => String(b[1].updatedAt || '').localeCompare(String(a[1].updatedAt || '')));
    const hotTokens = this.archive.available ? sortedTokens.slice(0,1200) : sortedTokens;
    const coldTokens = this.archive.available ? sortedTokens.slice(1200).map(([,token]) => token) : [];
    if (coldTokens.length && this.archive.available) this.archive.putMany(coldTokens);
    this.state.tokens = Object.fromEntries(hotTokens);
    if (this.archive.available && hotTokens.length) this.archive.removeMany(hotTokens.map(([mint]) => mint));
    limitForecastHistory(this.state.tokens);
    this.state.alerts = this.state.alerts.slice(-500); this.state.walletTrades = (this.state.walletTrades||[]).slice(-5000); this.state.walletCursors ||= {}; this.state.watchlist = this.state.watchlist.slice(-300); this.state.wallets = this.state.wallets.slice(-100); this.state.autoWallets = this.state.autoWallets.slice(-50);
    fs.mkdirSync(path.dirname(this.file), { recursive:true, mode:0o700 });
    const tmp = this.file + '.' + process.pid + '.tmp';
    if (fs.existsSync(this.file)) {
      try {
        const backup=this.file+'.bak';
        const backupDue=!fs.existsSync(backup)||Date.now()-fs.statSync(backup).mtimeMs>3600000;
        if(backupDue)fs.copyFileSync(this.file,backup);
      } catch(error) {
        console.warn('[persistence backup]',String(error.message||error).slice(0,160));
      }
    }
    writeJsonFileSync(tmp, this.state); fs.renameSync(tmp, this.file);
    this.lastSavedAt=iso();this.lastPersistenceError=null;
  }
  scheduleSave(){
    if(this.persistTimer)return;
    this.persistTimer=setTimeout(()=>{this.persistTimer=null;try{this.save();}catch(error){this.lastPersistenceError=String(error.message||error).slice(0,180);console.error('[persistence]',this.lastPersistenceError);}},250);
    if(this.persistTimer.unref)this.persistTimer.unref();
  }
  flushScheduledSave(){if(this.persistTimer){clearTimeout(this.persistTimer);this.persistTimer=null;}this.save();}
  status() {
    const src=this.state.sources;
    const trendingPools=this.state.geckoTrendingLastSuccessAt
      ? (Number(this.state.geckoTrendingLastCount)||0)
      : (Number(src.geckoTerminal?.trendingPools)||0);
    return {
      dexscreener:{configured:true,connected:src.dexscreener?.ok===true,lastSuccess:src.dexscreener?.at||null,error:src.dexscreener?.error||null,mode:'API publique gratuite'},
      solanaRpc:{configured:true,connected:src.solanaRpc?.ok===true,lastSuccess:src.solanaRpc?.at||null,error:src.solanaRpc?.error||null,endpoint:src.solanaRpc?.endpoint||null,providerCount:src.solanaRpc?.providerCount||3,providers:Object.entries(src.solanaRpcProviders||{}).map(([provider,state])=>({provider,...state})).slice(0,5),heliusConfigured:Boolean(String(process.env.HELIUS_API_KEY||'').trim()),mode:(String(process.env.HELIUS_API_KEY||'').trim()?'Helius prioritaire + RPC publics de secours':'RPC publics Solana')+' · '+(src.solanaRpc?.endpoint||'bascule automatique')+' · '+(src.solanaRpc?.providerCount||this.rpcEndpoints.length)+' fournisseurs'},
      pumpPortal:{...this.launchStream.status(),lastSavedAt:this.lastSavedAt,lastPersistenceError:this.lastPersistenceError},
      walletMonitoring:{configured:true,trackedManual:this.state.wallets.length,trackedAutomatic:(this.state.autoWallets||[]).length,trackedCreators:new Set(Object.values(this.state.tokens).filter(t=>t.creatorObservedAtLaunch===true&&t.creator).map(t=>t.creator)).size,cursors:Object.keys(this.state.walletLatestCursors||{}).length,pendingSignatures:Object.values(this.state.walletPendingSignatures||{}).reduce((sum,rows)=>sum+(rows||[]).length,0),monitoringGaps:Object.keys(this.state.walletMonitoringGaps||{}).length,latestActivity:Object.values(this.state.walletActivity||{}).reduce((latest,x)=>!latest||Date.parse(x.at||0)>Date.parse(latest)?x.at:latest,null)},
      geckoTerminal:{
        configured:true,connected:src.geckoTerminal?.ok===true,
        lastSuccess:src.geckoTerminal?.at||null,error:src.geckoTerminal?.error||null,
        pools:src.geckoTerminal?.pools||0,uniqueTokens:src.geckoTerminal?.uniqueTokens||0,
        pagesSucceeded:src.geckoTerminal?.pagesSucceeded||0,pagesAttempted:src.geckoTerminal?.pagesAttempted||0,
        pagesConfigured:src.geckoTerminal?.pagesConfigured||0,pageWindow:src.geckoTerminal?.pageWindow||10,pageStart:src.geckoTerminal?.pageStart||null,pageEnd:src.geckoTerminal?.pageEnd||null,nextPage:src.geckoTerminal?.nextPage||null,rateLimited:src.geckoTerminal?.rateLimited===true,
        trendingPools,
        trendingLastAttemptAt:this.state.geckoTrendingLastAttemptAt||null,
        trendingLastSuccessAt:src.geckoTerminal?.trendingLastSuccessAt||this.state.geckoTrendingLastSuccessAt||null,
        trendingLastError:src.geckoTerminal?.trendingLastError||this.state.geckoTrendingLastError||null,
        mode:src.geckoTerminal?.at
          ? 'Nouveaux pools · '+(src.geckoTerminal.uniqueTokens||0)+' tokens distincts / '+(src.geckoTerminal.pools||0)+' pools · '+(src.geckoTerminal.pagesSucceeded||0)+'/'+(src.geckoTerminal.pagesConfigured||0)+' pages · tendance 1h : '+(trendingPools||0)+' pools'+(src.geckoTerminal.rateLimited?' · quota atteint':'')
          : 'Nouveaux pools Solana + pools tendance · API publique gratuite'
      },
      jupiterPrice:{configured:true,connected:src.jupiterPrice?.ok===true,lastSuccess:src.jupiterPrice?.at||null,error:src.jupiterPrice?.error||null,checked:src.jupiterPrice?.checked||0,priced:src.jupiterPrice?.priced||0,mode:src.jupiterPrice?.mode||'Price API v3 · attente du premier scan'},
      redditRss:this.redditRadar.status(),
      bluesky:this.blueskyRadar.status(),
      nostr:this.nostrRadar.status(),
      telegramSocial:this.telegramRadar.status(),
      telegram:{configured:Boolean(this.bot&&this.state.telegramChannels.some(x=>x.enabled)),connected:Boolean(this.bot&&this.state.telegramChannels.some(x=>x.enabled)&&typeof this.bot.isRunning==='function'&&this.bot.isRunning()),channels:this.state.telegramChannels.length,enabledChannels:this.state.telegramChannels.filter(x=>x.enabled).length,mode:'Diffusion Telegram multi-canaux · un seul scan partagé'}
    };
  }
  async start() {
    if (this.running) return; this.running = true;
    await this.scan().catch(e => console.error('[scan]', e.message));
    this.timer = setInterval(() => this.scan().catch(e => console.error('[scan]', e.message)), Math.max(30000,n(process.env.SCAN_INTERVAL_MS)||60000));
    // Do not pile social scraping and wallet RPC pagination onto the first scan.
    // Background jobs are serialized and skipped when the host is already near its RSS ceiling.
    // Offset background work from the 60s scan cadence; retries below handle busy scans and memory pressure.
    this.socialTimer = setInterval(() => this.runBackgroundTask('social',()=>this.refreshSocialRadar(),252).catch(e=>console.warn('[social radar]',e.message)),900000);
    this.walletTimer = setInterval(() => this.runBackgroundTask('wallets',()=>this.refreshWallets(),248).catch(e=>console.error('[wallets]',e.message)),1200000);
    this.startupTimers.push(setTimeout(()=>this.runBackgroundTask('social',()=>this.refreshSocialRadar(),252).catch(e=>console.warn('[social radar]',e.message)),180000));
    this.startupTimers.push(setTimeout(()=>this.runBackgroundTask('wallets',()=>this.refreshWallets(),248).catch(e=>console.error('[wallets]',e.message)),300000));
    this.launchStream.start();
  }
  queueBackgroundRetry(name,task,maxRssMiB=205,delayMs=15000) {
    if(!this.running||this.backgroundRetryTimers.has(name))return;
    const timer=setTimeout(()=>{
      this.backgroundRetryTimers.delete(name);
      this.runBackgroundTask(name,task,maxRssMiB).catch(error=>{
        const label=name==='social'?'[social radar]':'[background '+name+']';
        console.warn(label,error.message);
      });
    },delayMs);
    if(timer&&typeof timer.unref==='function')timer.unref();
    this.backgroundRetryTimers.set(name,timer);
  }
  async runBackgroundTask(name, task, maxRssMiB = 205) {
    if(!this.running)return {skipped:true,reason:'scanner_stopped'};
    if(this.scanning||this.backgroundTaskRunning){
      this.queueBackgroundRetry(name,task,maxRssMiB,15000);
      return {skipped:true,reason:'scanner_or_background_task_busy',retryScheduled:true};
    }
    const budget=memoryBudget({maxHeapMiB:76,maxExternalMiB:20,maxRssMiB});
    if(!budget.ok){
      if(Date.now()-this.lastBackgroundSkipLogAt>60000){this.lastBackgroundSkipLogAt=Date.now();console.warn('[memory guard] background task deferred',{name,...budget});}
      this.queueBackgroundRetry(name,task,maxRssMiB,60000);
      return {skipped:true,reason:'memory_budget',retryScheduled:true,...budget};
    }
    const pending=this.backgroundRetryTimers.get(name);
    if(pending){clearTimeout(pending);this.backgroundRetryTimers.delete(name);}
    this.backgroundTaskRunning=name;
    try{return await task();}
    finally{this.backgroundTaskRunning=null;}
  }
  stop() { this.running=false; clearInterval(this.timer); clearInterval(this.walletTimer); clearInterval(this.socialTimer); for(const timer of this.startupTimers)clearTimeout(timer);this.startupTimers=[];for(const timer of this.backgroundRetryTimers.values())clearTimeout(timer);this.backgroundRetryTimers.clear();this.launchStream.stop(); if(this.persistTimer){try{this.flushScheduledSave();}catch(error){console.error('[persistence shutdown]',error.message);}} }
  restoreArchivedToken(mint) {
    if (this.state.tokens[mint]) return this.state.tokens[mint];
    return this.archive.available ? this.archive.get(mint) : null;
  }
  upsert(item, source) {
    const mint = String(item.tokenAddress || item.mint || ''); if (!mint) return;
    const t = this.state.tokens[mint] || this.restoreArchivedToken(mint) || { mint, sources:[], smartMoney:{hits:0,wallets:[]} };
    if (!t.sources.includes(source)) t.sources.push(source);
    t.firstSeenAt=t.firstSeenAt||iso();
    ensureLaunchCohort(t,Date.parse(t.firstSeenAt)||Date.now());
    if (item.description) t.description = String(item.description).slice(0,1000);
    if (item.icon) t.imageUrl = item.icon;
    if (item.url) t.dexUrl = item.url;
    if (Array.isArray(item.links)) t.links = item.links.slice(0,15);
    if (item.name) t.name = item.name; if (item.symbol) t.symbol = item.symbol;
    if (item.traderPublicKey) t.creator = item.traderPublicKey;
    t.boosted = t.boosted || source.includes('boost'); t.updatedAt=iso();
    for (const w of this.state.wallets) if ((this.state.walletActivity[w.address]?.mints||[]).includes(mint)) {
      if (!t.smartMoney.wallets.includes(w.address)) t.smartMoney.wallets.push(w.address);
      t.smartMoney.hits=t.smartMoney.wallets.length; t.smartMoney.lastSeenAt=this.state.walletActivity[w.address].at;
    }
    this.state.tokens[mint]=t;
  }
  ingestLaunch(event) {
    const mint=String(event.mint||event.tokenAddress||event.address||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return;
    const t=this.state.tokens[mint]||this.restoreArchivedToken(mint)||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    if(!t.sources.includes('pumpportal_new_token'))t.sources.push('pumpportal_new_token');
    t.name=String(event.name||t.name||'Token sans nom').slice(0,100);
    t.symbol=String(event.symbol||t.symbol||'—').slice(0,24);
    t.creator=String(event.traderPublicKey||event.creator||t.creator||'');t.creatorObservedAtLaunch=Boolean(event.traderPublicKey||event.creator||t.creatorObservedAtLaunch);
    t.tokenUri=String(event.uri||event.metadataUri||t.tokenUri||'').slice(0,500);
    t.pumpCreatedAt=t.pumpCreatedAt||new Date(Number(event.timestamp)>1e12?Number(event.timestamp):Number(event.timestamp)>0?Number(event.timestamp)*1000:Date.now()).toISOString();
    t.firstSeenAt=t.firstSeenAt||iso();
    ensureLaunchCohort(t,Date.parse(t.firstSeenAt)||Date.now());
    t.launchSource='Pump.fun';if(t.launchCohort)t.launchCohort.source='Pump.fun';t.launchObservedVia=t.migrated?'creation_and_migration':'creation_event';
    t.launchData={initialBuyTokens:Number(event.initialBuy||0)||null,marketCapSol:Number(event.marketCapSol||0)||null,bondingCurveSol:Number(event.vSolInBondingCurve||0)/1e9||null,bondingCurveTokens:Number(event.vTokensInBondingCurve||0)/1e6||null,bondingCurveKey:String(event.bondingCurveKey||''),signature:String(event.signature||''),observedAt:iso()};
    t.launchAgeHours=Math.max(0,(Date.now()-Date.parse(t.pumpCreatedAt))/3600000);t.ageHours=t.launchAgeHours;
    t.launchCohort ||= ensureLaunchCohort(t);t.updatedAt=iso();this.state.tokens[mint]=t;this.scheduleSave();
  }
  ingestMigration(event) {
    const mint=String(event.mint||event.tokenAddress||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return;
    const t=this.state.tokens[mint]||this.restoreArchivedToken(mint)||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    if(!t.sources.includes('pumpportal_migration'))t.sources.push('pumpportal_migration');
    t.launchSource=t.launchSource||'Pump.fun';if(t.launchCohort)t.launchCohort.source='Pump.fun';t.firstSeenAt=t.firstSeenAt||iso();t.launchObservedVia=t.launchObservedVia==='creation_event'?'creation_and_migration':(t.launchObservedVia||'migration_only');
    t.migratedAt=iso();ensureLaunchCohort(t,Date.parse(t.firstSeenAt||t.migratedAt)||Date.now());t.migrated=true;t.migrationPool=String(event.pool||event.poolAddress||'').slice(0,100);
    t.updatedAt=iso();this.state.tokens[mint]=t;this.scheduleSave();
  }
  ingestGeckoPool(pool) {
    const mint=String(pool?.tokenAddress||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return;
    const t=this.state.tokens[mint]||this.restoreArchivedToken(mint)||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    const discoverySource=String(pool.source||'geckoterminal_new_pool');if(!t.sources.includes(discoverySource))t.sources.push(discoverySource);
    t.name=pool.name||t.name||'Token sans nom';t.symbol=pool.symbol||t.symbol||'—';t.firstSeenAt=t.firstSeenAt||iso();
    t.geckoPoolAddress=pool.poolAddress||t.geckoPoolAddress;t.geckoDexName=pool.dexName||t.geckoDexName;
    t.geckoPoolCreatedAt=pool.poolCreatedAt||t.geckoPoolCreatedAt;
    ensureLaunchCohort(t,Date.parse(t.firstSeenAt||t.geckoPoolCreatedAt||'')||Date.now());
    t.geckoUrl=t.geckoPoolAddress?'https://www.geckoterminal.com/solana/pools/'+encodeURIComponent(t.geckoPoolAddress):t.geckoUrl;
    if(pool.liquidityUsd!==null)t.liquidityUsd=pool.liquidityUsd;
    if(pool.priceUsd!==null)t.priceUsd=pool.priceUsd;
    if(pool.fdv!==null)t.fdv=pool.fdv;
    if(pool.marketCap!==null)t.marketCap=pool.marketCap;
    if(pool.volume)t.volume={...(t.volume||{}),...Object.fromEntries(Object.entries(pool.volume).filter(([,v])=>v!==null))};
    if(pool.txns&&Object.keys(pool.txns).length)t.txns={...(t.txns||{}),...pool.txns};
    if(pool.priceChange)t.priceChange={...(t.priceChange||{}),...pool.priceChange};
    if(pool.poolCreatedAt&&!t.pairCreatedAt){const time=Date.parse(pool.poolCreatedAt);if(Number.isFinite(time))t.pairCreatedAt=time;}
    if(pool.ageHours!==null)t.ageHours=pool.ageHours;
    observeLaunchCohort(t,{at:Date.now(),priceUsd:pool.priceUsd,liquidityUsd:pool.liquidityUsd});
    t.updatedAt=iso();this.state.tokens[mint]=t;
  }
  async inspectCreatorFunding(t,{persist=true}={}) {
    const creator=String(t?.creator||'');
    if(!t?.creatorObservedAtLaunch||!creator)return null;
    const checked=Date.parse(t.creatorFunding?.checkedAt||0);
    const cacheMs=t.creatorFunding?.error?900000:86400000;
    if(t.creatorFunding?.checkedAt&&Date.now()-checked<cacheMs)return t.creatorFunding;
    try {
      const signatures=await this.rpc('getSignaturesForAddress',[creator,{limit:1000,commitment:'confirmed'}]);
      if(!Array.isArray(signatures)||!signatures.length)throw new Error('Aucune transaction récente accessible pour ce créateur.');
      const oldestSamples=signatures.slice(-10);
      let funding=null,fundingSignature=null,fundingBlockTime=null,transactionsChecked=0;
      for(const entry of oldestSamples){
        const transaction=await this.rpc('getTransaction',[entry.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
        transactionsChecked++;
        const found=extractCreatorFunder(transaction,creator);
        if(found){funding=found;fundingSignature=entry.signature;fundingBlockTime=transaction?.blockTime?new Date(transaction.blockTime*1000).toISOString():null;break;}
      }
      t.creatorFunding={
        checkedAt:iso(),status:funding?'found':'not_found',
        funder:funding?.funder||null,lamports:funding?.lamports??null,
        sol:funding?Number((funding.lamports/1e9).toFixed(6)):null,
        instructionType:funding?.instructionType||null,
        signature:fundingSignature,blockTime:fundingBlockTime,
        historySampleSize:signatures.length,oldestTransactionsChecked:transactionsChecked,historyMayBeTruncated:signatures.length>=1000,
        note:signatures.length>=1000?'Jusqu’à 10 transactions les plus anciennes parmi les 1 000 signatures accessibles; le premier financement réel peut être plus ancien.':'Jusqu’à 10 transactions les plus anciennes accessibles ont été examinées.'
      };
    } catch(error) {
      t.creatorFunding={checkedAt:iso(),status:'unavailable',error:String(error.message||error).slice(0,180)};
    }
    if(persist)this.save();
    return t.creatorFunding;
  }
  async inspectTradeIntel(t,{persist=true}={}) {
    if(!t?.geckoPoolAddress)return null;
    if(t.tradeIntel?.checkedAt&&Date.now()-Date.parse(t.tradeIntel.checkedAt)<300000)return t.tradeIntel;
    const run=async()=>{
      const delay=Math.max(0,30000-(Date.now()-this.lastGeckoTradeFetch));
      if(delay)await wait(delay);
      this.lastGeckoTradeFetch=Date.now();
      const payload=await fetchPoolTrades(t.geckoPoolAddress);
      t.tradeIntel=analyzePoolTrades(payload,t.geckoPoolCreatedAt);
      this.state.walletTrades ||= [];
      const mergedTrades=mergeObservedTrades(this.state.walletTrades,t.mint,t.tradeIntel.observedTrades||[],5000);
      this.state.walletTrades=mergedTrades.rows;
      t.tradeIntel.observedWalletTradesAdded=mergedTrades.added;
      t.tradeIntelError=null;
      t.analysis=this.score(t);
      if(Number(t.analysis?.score||0)>=60&&!t.analysis?.hardBlocked&&t.analysis?.risk!=='high'&&t.tradeIntel.earlyWindow?.complete){
        const discovery=recordEarlyBuyerCandidates(this.state.autoWallets||[],t,t.tradeIntel.earlyBuyers||[],iso());
        this.state.autoWallets=discovery.wallets;
      }
      if(persist)this.save();
      return t.tradeIntel;
    };
    const pending=this.geckoTradeQueue.then(run,run);
    this.geckoTradeQueue=pending.catch(()=>null);
    try{return await pending;}catch(error){t.tradeIntelError=String(error.message||error).slice(0,180);return null;}
  }
  async refreshCandidateIntelligence() {
    const budget=memoryBudget({maxHeapMiB:72,maxExternalMiB:18,maxRssMiB:240});
    if(!budget.ok){console.warn('[memory guard] candidate intelligence deferred',budget);return;}
    const now=Date.now();
    const tradeCandidates=Object.values(this.state.tokens)
      .filter(t=>t.geckoPoolAddress&&(!t.tradeIntel?.checkedAt||now-Date.parse(t.tradeIntel.checkedAt)>300000))
      .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd));
    if(tradeCandidates.length){
      const candidate=tradeCandidates[0];
      await this.inspectTradeIntel(candidate,{persist:false});
    }
    if(now-this.lastAutoCreatorFundingAt>=900000){
      const creator=Object.values(this.state.tokens)
        .filter(t=>t.creatorObservedAtLaunch===true&&t.creator&&(!t.creatorFunding?.checkedAt||now-Date.parse(t.creatorFunding.checkedAt)>(t.creatorFunding.error?900000:86400000)))
        .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||Date.parse(b.firstSeenAt||0)-Date.parse(a.firstSeenAt||0))[0];
      if(creator){
        this.lastAutoCreatorFundingAt=now;
        await this.inspectCreatorFunding(creator,{persist:false});
      }
    }
  }
  mergeSocialIntel(token) {
    const reddit=this.redditRadar.match(token);
    const bluesky=token.blueskyIntel;
    const nostr=token.nostrIntel;
    const telegram=token.telegramIntel;
    const sources=[reddit?.available?reddit:null,bluesky?.available?bluesky:null,nostr?.available?nostr:null,telegram?.available?telegram:null].filter(Boolean);
    const posts=sources.flatMap(source=>source.posts||[]).sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)).slice(0,10);
    const mentions1h=sources.reduce((sum,x)=>sum+(Number(x.mentions1h)||0),0);
    const mentions24h=sources.reduce((sum,x)=>sum+(Number(x.mentions24h)||0),0);
    const sentimentRows=sources.filter(x=>x.sentimentScore!==null&&x.sentimentScore!==undefined);
    const sentimentScore=sentimentRows.length?Math.round(sentimentRows.reduce((sum,x)=>sum+Number(x.sentimentScore),0)/sentimentRows.length):null;
    const uniqueChannels24h=sources.reduce((sum,x)=>sum+(Number(x.uniqueChannels24h)||0),0);
    const uniqueSources24h=new Set(sources.filter(x=>Number(x.mentions24h)>0).map(x=>x.provider||x.source||'')).size;
    const normalizedPosts=posts.map(post=>String(post.title||post.text||'').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^a-z0-9$]+/g,' ').trim()).filter(Boolean);
    const duplicateTexts=normalizedPosts.length-new Set(normalizedPosts).size;
    return {available:sources.length>0,mentions1h,mentions24h,uniqueAuthors24h:sources.reduce((sum,x)=>sum+(Number(x.uniqueAuthors24h)||0),0),uniqueChannels24h,uniqueSources24h,socialVelocityPerHour:mentions1h,sentimentScore,duplicateTexts,posts,providers:sources.map(x=>x.provider||x.source||'Reddit'),reddit,bluesky:bluesky||null,nostr:nostr||null,telegram:telegram||null};
  }
  async refreshSocialRadar() {
    // Reddit RSS support was retired in November 2026. Do not issue three
    // parallel 512 KiB requests on a 256 MiB host for a source that no longer works.
    const redditResult={skipped:true,reason:'Reddit RSS retiré; collecte désactivée pour protéger la mémoire.'};
    this.state.sources.redditRss={ok:false,error:'Flux RSS Reddit retirés; collecte désactivée.'};
    const safeBudget=()=>memoryBudget({maxHeapMiB:72,maxExternalMiB:18,maxRssMiB:240});
    let telegramDiscovery=null;
    try {
      telegramDiscovery=await this.telegramRadar.discoverPublicChannels({limit:2});
      for(const token of Object.values(this.state.tokens)) {
        const discovered=this.telegramRadar.matchDiscoveredToken(token);
        if(discovered.available) token.telegramIntel=discovered;
      }
      const telegramStatus=this.telegramRadar.status();
      this.state.sources.telegramSocial={ok:telegramStatus.connected,at:telegramStatus.lastSuccess||iso(),error:telegramStatus.lastError||null,channelsScanned:telegramStatus.discovery?.visitedChannels||0,postsRetained:telegramStatus.discovery?.postsRetained||0};
    } catch(error) {
      this.state.sources.telegramSocial={ok:false,error:String(error.message||error).slice(0,180)};
    }
    let budget=safeBudget();
    if(!budget.ok){console.warn('[memory guard] social discovery stopped',budget);return {partial:true,reason:'memory_budget',reddit:redditResult,telegramDiscovery,...budget};}
    const candidates=Object.values(this.state.tokens)
      .filter(t=>t.mint&&/^[a-z0-9]{3,15}$/i.test(String(t.symbol||''))&&(!t.blueskyIntel?.checkedAt||Date.now()-Date.parse(t.blueskyIntel.checkedAt)>1800000))
      .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd))
      .slice(0,1);
    const ordered=candidates.length?Array.from({length:candidates.length},(_,i)=>candidates[(this.socialCursor+i)%candidates.length]):[];
    const selected=ordered.slice(0,1);
    if(candidates.length)this.socialCursor=(this.socialCursor+selected.length)%candidates.length;
    for(const token of selected) {
      token.blueskyIntel=await this.blueskyRadar.searchToken(token);
      this.state.sources.bluesky={ok:token.blueskyIntel.available,at:token.blueskyIntel.checkedAt,error:token.blueskyIntel.error||null};
      budget=safeBudget();
      if(!budget.ok){console.warn('[memory guard] social search stopped after Bluesky',budget);return {partial:true,reason:'memory_budget',reddit:redditResult,telegramDiscovery,blueskyTokensChecked:selected.length,...budget};}
    }
    const nostrCandidates=Object.values(this.state.tokens)
      .filter(t=>t.mint&&/^[a-z0-9]{3,15}$/i.test(String(t.symbol||''))&&(!t.nostrIntel?.checkedAt||Date.now()-Date.parse(t.nostrIntel.checkedAt)>1800000))
      .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd));
    if(nostrCandidates.length){
      this.nostrCursor=(this.nostrCursor||0)%nostrCandidates.length;
      const candidate=nostrCandidates[this.nostrCursor];
      this.nostrCursor=(this.nostrCursor+1)%nostrCandidates.length;
      candidate.nostrIntel=await this.nostrRadar.searchToken(candidate);
      this.state.sources.nostr={ok:candidate.nostrIntel.available,at:candidate.nostrIntel.checkedAt||iso(),error:candidate.nostrIntel.error||null};
      budget=safeBudget();
      if(!budget.ok){console.warn('[memory guard] social search stopped after Nostr',budget);return {partial:true,reason:'memory_budget',reddit:redditResult,telegramDiscovery,blueskyTokensChecked:selected.length,...budget};}
    }
    const telegramCandidates=Object.values(this.state.tokens)
      .filter(t=>t.mint&&(!t.telegramDirectCheckedAt||Date.now()-Date.parse(t.telegramDirectCheckedAt)>900000))
      .filter(t=>[...(Array.isArray(t.socials)?t.socials:[]),...(Array.isArray(t.links)?t.links:[])].some(x=>{const url=String(x?.url||x?.link||x?.href||'').toLowerCase();return url.includes('t.me/')||url.includes('telegram.me/');})||String(t.description||'').toLowerCase().includes('t.me/')||String(t.description||'').toLowerCase().includes('telegram.me/'))
      .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd));
    const telegramOrdered=telegramCandidates.length?Array.from({length:telegramCandidates.length},(_,i)=>telegramCandidates[(this.telegramCursor+i)%telegramCandidates.length]):[];
    const telegramSelected=telegramOrdered.slice(0,1);
    if(telegramCandidates.length)this.telegramCursor=(this.telegramCursor+telegramSelected.length)%telegramCandidates.length;
    for(const token of telegramSelected){
      token.telegramIntel=await this.telegramRadar.searchToken(token);
      token.telegramDirectCheckedAt=token.telegramIntel.checkedAt||iso();
      this.state.sources.telegramSocial={ok:token.telegramIntel.available,at:token.telegramIntel.checkedAt||iso(),error:token.telegramIntel.errors?.map(x=>x.error).join('; ')||token.telegramIntel.error||null,channelsScanned:token.telegramIntel.channelsScanned||0};
      budget=safeBudget();
      if(!budget.ok){console.warn('[memory guard] social search stopped after Telegram',budget);return {partial:true,reason:'memory_budget',reddit:redditResult,telegramDiscovery,blueskyTokensChecked:selected.length,...budget};}
    }
    if(!telegramCandidates.length) {
      const telegramStatus=this.telegramRadar.status();
      this.state.sources.telegramSocial={ok:telegramStatus.connected,at:telegramStatus.lastSuccess||iso(),error:telegramStatus.lastError||null,channelsScanned:telegramStatus.discovery?.visitedChannels||0,postsRetained:telegramStatus.discovery?.postsRetained||0};
    }
    for(const token of Object.values(this.state.tokens))token.socialIntel=this.mergeSocialIntel(token);
    budget=safeBudget();
    if(!budget.ok){console.warn('[memory guard] social scoring and persistence deferred',budget);return {partial:true,reason:'memory_budget_before_score_save',reddit:redditResult,telegramDiscovery,blueskyTokensChecked:selected.length,...budget};}
    this.scoreAll();this.save();
    return {reddit:redditResult,telegramDiscovery,blueskyTokensChecked:selected.length};
  }
  pair(p) {
    const mint=p?.baseToken?.address; if(!mint||p.chainId!=='solana') return;
    const t=this.state.tokens[mint]||{mint,sources:['dex_pair'],smartMoney:{hits:0,wallets:[]}};
    t.name=p.baseToken.name||t.name||'Unknown';t.symbol=p.baseToken.symbol||t.symbol||'—';t.pairAddress=p.pairAddress||t.pairAddress;t.dexUrl=p.url||t.dexUrl;
    const validNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
    if(validNumber(p.priceUsd)&&Number(p.priceUsd)>0)t.priceUsd=Number(p.priceUsd);
    if(validNumber(p.liquidity?.usd)&&Number(p.liquidity.usd)>=0)t.liquidityUsd=Number(p.liquidity.usd);
    if(validNumber(p.fdv)&&Number(p.fdv)>0)t.fdv=Number(p.fdv);
    if(validNumber(p.marketCap)&&Number(p.marketCap)>0)t.marketCap=Number(p.marketCap);else if(validNumber(p.fdv)&&Number(p.fdv)>0)t.marketCap=Number(p.fdv);
    const mergeNumeric=next=>Object.fromEntries(Object.entries(next||{}).filter(([,v])=>validNumber(v)).map(([k,v])=>[k,Number(v)]));
    t.volume={...(t.volume||{}),...mergeNumeric(p.volume)};
    t.txns={...(t.txns||{}),...Object.fromEntries(Object.entries(p.txns||{}).filter(([,v])=>v&&typeof v==='object').map(([period,v])=>[period,{...(t.txns?.[period]||{}),...mergeNumeric(v)}]))};
    t.priceChange={...(t.priceChange||{}),...mergeNumeric(p.priceChange)};
    t.pairCreatedAt=validNumber(p.pairCreatedAt)&&Number(p.pairCreatedAt)>0?Number(p.pairCreatedAt):t.pairCreatedAt||null;t.firstSeenAt=t.firstSeenAt||iso();ensureLaunchCohort(t,Date.parse(t.firstSeenAt)||Date.now());if(t.pairCreatedAt)t.ageHours=Math.max(0,(Date.now()-t.pairCreatedAt)/3600000);
    t.socials=p.info?.socials||t.socials||[];t.websites=p.info?.websites||t.websites||[];t.imageUrl=p.info?.imageUrl||t.imageUrl;
    t.history=Array.isArray(t.history)?t.history:[];
    if(Number(t.priceUsd)>0&&Number(t.liquidityUsd)>0){
      const currentAnalysis=this.score(t);const snap={at:Date.now(),priceUsd:t.priceUsd,liquidityUsd:t.liquidityUsd,volume1h:validNumber(t.volume?.h1)?Number(t.volume.h1):null,volume24h:validNumber(t.volume?.h24)?Number(t.volume.h24):null,buys1h:validNumber(t.txns?.h1?.buys)?Number(t.txns.h1.buys):null,sells1h:validNumber(t.txns?.h1?.sells)?Number(t.txns.h1.sells):null,fdv:t.fdv??null,score:currentAnalysis.score,coverage:currentAnalysis.coverage,classification:currentAnalysis.classification,risk:currentAnalysis.risk,flags:currentAnalysis.flags||[]};
      const last=t.history[t.history.length-1];if(!last||snap.at-last.at>=45000){t.history.push(snap);t.history=t.history.slice(-100);this.recordForecast(t,snap);}
      observeLaunchCohort(t,snap);
    }
    t.updatedAt=iso();this.state.tokens[mint]=t;
  }
  score(t) {
    const weights={activity:20,momentum:20,market:15,liquidityQuality:15,security:15,earlyBuyerSignal:5,walletReputationSignal:5,timing:5},f={};
    const microstructure=analyzeMicrostructure(t);
    const h=t.txns?.h1,buys=n(h?.buys),sells=n(h?.sells),total=buys+sells,vol1=n(t.volume?.h1),vol24=n(t.volume?.h24),liq=n(t.liquidityUsd),fdv=n(t.fdv||t.marketCap);
    if(h&&total>0){f.activity=clamp(Math.log10(total+1)*34+Math.log10(vol1+1)*17);const ratio=buys/total;const hist=Array.isArray(t.history)?t.history:[];const prior=hist.length>=2?hist[hist.length-2]:null;const priorTotal=prior?n(prior.buys1h)+n(prior.sells1h):0;if(prior&&priorTotal>0){const accel=total/priorTotal-1;f.momentum=clamp(clamp((ratio-.35)/.45*100)*.65+clamp(50+accel*25)*.35);if(microstructure.score!==null)f.momentum=clamp(f.momentum*.75+microstructure.score*.25);}else if(microstructure.score!==null)f.momentum=microstructure.score;f.buyRatio=Number((ratio*100).toFixed(1));f.buySellRatio=Number((buys/Math.max(1,sells)).toFixed(2));}else if(microstructure.score!==null)f.momentum=microstructure.score;
    const hasVolume24=t.volume?.h24!==null&&t.volume?.h24!==undefined&&Number.isFinite(Number(t.volume.h24));if(t.liquidityUsd!==null&&t.liquidityUsd!==undefined&&Number.isFinite(Number(t.liquidityUsd))&&hasVolume24)f.market=clamp(Math.sqrt(Math.max(0,liq))*.055+Math.log10(vol24+1)*17);
    if(liq>0){const hasVol1=t.volume?.h1!==undefined&&t.volume?.h1!==null&&Number.isFinite(Number(t.volume.h1)),ratio=fdv>0?fdv/liq:null,turnover=hasVol1?vol1/liq:null,hist=Array.isArray(t.history)?t.history:[],prior=hist.length>=2?hist[hist.length-2]:null,change=prior&&prior.liquidityUsd>0?(liq/prior.liquidityUsd-1)*100:null;const components=[];if(turnover!==null)components.push({weight:.45,value:clamp(100-Math.abs(turnover-.35)*90)});if(change!==null)components.push({weight:.35,value:clamp(50+change*2)});if(ratio!==null)components.push({weight:.2,value:100-clamp((ratio-5)*4)});if(components.length>=2){const totalWeight=components.reduce((sum,x)=>sum+x.weight,0);f.liquidityQuality=clamp(components.reduce((sum,x)=>sum+x.value*x.weight,0)/totalWeight);}t.metrics={volumeToLiquidity:turnover===null?null:Number(turnover.toFixed(3)),fdvToLiquidity:ratio===null?null:Number(ratio.toFixed(2)),liquidityChangePct:change===null?null:Number(change.toFixed(2)),priceChangeSincePrevious:prior&&prior.priceUsd>0?Number(((t.priceUsd/prior.priceUsd-1)*100).toFixed(2)):null};}
    const qualifiedEarlyBuyers=t.tradeIntel?.earlyWindow?.complete&&Array.isArray(t.tradeIntel.earlyBuyers)?t.tradeIntel.earlyBuyers.filter(x=>n(x.buys)>=2&&n(x.buyVolumeUsd)>=150):[];if(qualifiedEarlyBuyers.length)f.earlyBuyerSignal=clamp(40+Math.min(qualifiedEarlyBuyers.length,4)*15);
    const walletSignal=t.walletReputation;
    if(walletSignal?.qualified===true&&Number.isFinite(Number(walletSignal.score)))f.walletReputationSignal=clamp(walletSignal.score);
    if(t.security?.checkedAt){const sec=t.security.data||{},authorityKnown=typeof sec.freezeAuthorityActive==='boolean'&&typeof sec.mintAuthorityActive==='boolean',tokenTypeReviewed=sec.isInitialized===true&&sec.isToken2022!==true,holderKnown=sec.ownerConcentrationAvailable===true&&sec.top10HolderPercent!==null&&Number.isFinite(Number(sec.top10HolderPercent)),freeze=sec.freezeAuthorityActive===true,top=holderKnown?Number(sec.top10HolderPercent):null,flags=[freeze,sec.mintAuthorityActive===true,top!==null&&top>=70].filter(Boolean).length;t.security.hardBlocked=freeze;t.security.risk=!authorityKnown?'unknown':t.security.hardBlocked?'high':!holderKnown||!tokenTypeReviewed?'partial':flags?'medium':'observations_only';t.security.holderEvidenceComplete=holderKnown;if(authorityKnown&&tokenTypeReviewed)f.security=clamp(100-(freeze?35:0)-(sec.mintAuthorityActive===true?15:0)-(top!==null&&top>=70?25:0)-(top!==null&&top>=50&&top<70?10:0));}
    if(t.launchSource&&t.pumpCreatedAt)t.launchAgeHours=Math.max(0,(Date.now()-Date.parse(t.pumpCreatedAt))/3600000);const ageForTiming=t.launchSource&&Number.isFinite(Number(t.launchAgeHours))?Number(t.launchAgeHours):t.ageHours;if(ageForTiming!==null&&ageForTiming!==undefined)f.timing=clamp(100-Math.max(0,ageForTiming-1)*4);
    const available=Object.entries(weights).filter(([k])=>Number.isFinite(f[k])),coverage=available.reduce((sum,[k])=>sum+weights[k],0),score=coverage?Math.round(available.reduce((sum,[k])=>sum+f[k]*weights[k],0)/coverage):null;
    const flags=[...microstructure.flags];if(t.security?.data?.isToken2022===true)flags.push({level:'warning',code:'TOKEN_2022_REVIEW',message:'Token-2022 détecté : les extensions doivent être vérifiées séparément.'});if(t.security?.data?.freezeAuthorityActive===true)flags.push({level:'critical',code:'FREEZE_AUTHORITY',message:'Freeze authority active'});if(t.security?.data?.mintAuthorityActive===true)flags.push({level:'warning',code:'MINT_AUTHORITY',message:'Mint authority active'});if(t.security?.data?.ownerConcentrationAvailable===true&&Number(t.security.data.top10HolderPercent)>=70)flags.push({level:'warning',code:'HOLDER_CONCENTRATION',message:'Top 10 observed wallets concentration: '+t.security.data.top10HolderPercent+'% (sample may include pool or program-controlled accounts).'});if(t.security?.data?.ownerConcentrationAvailable===true&&Number(t.security.data.top1OwnerPercent)>=20)flags.push({level:'warning',code:'TOP1_WALLET_CONCENTRATION',message:'One observed wallet controls '+t.security.data.top1OwnerPercent+'% of supply (verify whether it is a pool or program account).'});if(t.security?.data?.ownerConcentrationAvailable===true&&Number(t.security.data.top5OwnerPercent)>=50)flags.push({level:'warning',code:'TOP5_WALLET_CONCENTRATION',message:'Top 5 observed wallets control '+t.security.data.top5OwnerPercent+'% of supply'});if(t.security?.data?.ownerConcentrationAvailable!==true&&Number(t.security?.data?.top10AccountPercent)>=85)flags.push({level:'warning',code:'TOP10_ACCOUNT_CONCENTRATION_UNVERIFIED',message:'Les 10 plus gros comptes représentent '+t.security.data.top10AccountPercent+'% de la supply, mais les propriétaires ne sont pas tous identifiés : concentration des wallets inconnue.'});if(liq>0&&fdv>0&&fdv/liq>30)flags.push({level:'warning',code:'HIGH_FDV_LIQUIDITY',message:'FDV / liquidity ratio is unusually high'});if(total>=10&&buys/total<.4)flags.push({level:'warning',code:'SELL_PRESSURE',message:'Sell transactions dominate recent activity'});if(t.metrics?.liquidityChangePct!==null&&t.metrics?.liquidityChangePct!==undefined&&t.metrics.liquidityChangePct< -15)flags.push({level:'critical',code:'LIQUIDITY_DROP',message:'Liquidity dropped more than 15% between observations'});if(t.ageHours!==null&&t.ageHours!==undefined&&t.ageHours<1&&liq<3000)flags.push({level:'warning',code:'THIN_NEW_POOL',message:'Very new pool with low liquidity'});const creatorSoldPct=Number(t.creatorSaleSummary?.soldPctSupply24h??t.creatorSaleSummary?.soldPctSupplyLast);if(Number.isFinite(creatorSoldPct)&&creatorSoldPct>=1)flags.push({level:creatorSoldPct>=5?'critical':'warning',code:'CREATOR_SELL_OBSERVED',message:'Sorties cumulées du créateur dans des swap-like observés sur 24 h : '+creatorSoldPct+'% de la supply (estimation).'});const recentEarlyOutflows=(t.earlyWalletOutflows||[]).filter(x=>x.swapConfirmed&&Date.now()-Date.parse(x.at||0)<=600000);const earlySellerCount=new Set(recentEarlyOutflows.map(x=>x.wallet)).size;if(earlySellerCount>=3)flags.push({level:'warning',code:'EARLY_WALLET_SELL_CLUSTER',message:earlySellerCount+' wallets acheteurs précoces ont eu une sortie swap-like observée dans les 10 dernières minutes.'});
    const hardBlocked=Boolean(t.security?.hardBlocked||flags.some(x=>x.level==='critical'));
    const candidateIntel=evaluateCandidateIntel(t);
    flags.push(...candidateIntel.flags);
    const adjustedScore=score===null?null:clamp(score+candidateIntel.adjustment);
    const factorLabels={activity:'activité',momentum:'momentum',market:'données de marché',liquidityQuality:'qualité de liquidité',security:'sécurité on-chain',earlyBuyerSignal:'acheteurs précoces récurrents',walletReputationSignal:'réputation des wallets',timing:'ancienneté'};
    const missingFactors=Object.keys(weights).filter(key=>!Number.isFinite(f[key]));
    const marketLinked=Boolean(t.pairAddress||t.geckoPoolAddress);
    const securityEvidence=Number.isFinite(f.security);
    const securityComprehensive=securityEvidence&&t.security?.holderEvidenceComplete===true;
    const readiness=!marketLinked?'awaiting_market':coverage>=70&&securityComprehensive?'complete':coverage>=45?'partial':'insufficient_data';
    const readinessLabel=readiness==='awaiting_market'?'Pré-marché · pool absent':readiness==='complete'?'Analyse complète':readiness==='partial'?'Analyse partielle':'Données insuffisantes';
    const missingReasons={
      activity:!t.txns?.h1?'transactions 1h absentes':(n(t.txns.h1.buys)+n(t.txns.h1.sells))<=0?'aucun achat/vente exploitable sur 1h':null,
      momentum:!Array.isArray(t.history)||t.history.length<2?'deux snapshots comparables requis':null,
      market:!marketLinked?'aucun pool DEX relié':!(Number(t.liquidityUsd)>0)?'liquidité USD absente':!(t.volume?.h24!==null&&t.volume?.h24!==undefined&&Number.isFinite(Number(t.volume.h24)))?'volume 24h absent':null,
      liquidityQuality:'au moins deux mesures parmi volume/liquidité, évolution de liquidité et FDV/liquidité sont nécessaires',
      security:!t.security?.checkedAt?'contrôle RPC pas encore effectué':t.security?.data?.isToken2022===true?'Token-2022 : extensions non vérifiées':!securityEvidence?'autorités du mint ou type de programme non confirmés':null,
      earlyBuyerSignal:'fenêtre des cinq premières minutes non entièrement couverte ou acheteurs insuffisamment observés',
      walletReputationSignal:'pas encore assez de positions clôturées et vérifiées pour noter les wallets',
      timing:'horodatage fiable de création du token ou du pool absent'
    };
    const missingFactorReasons=missingFactors.map(key=>({key,label:factorLabels[key]||key,reason:missingReasons[key]||'preuves insuffisantes'}));
    const evidenceGaps=[];
    if(securityEvidence&&!securityComprehensive)evidenceGaps.push({key:'holders',reason:'Autorités vérifiées, mais concentration des détenteurs non calculable : propriétaires RPC incomplets.'});
    const readinessReason=!marketLinked?'Token détecté avant marché exploitable : aucun pool DEX n’est encore relié. Le 5 % éventuel correspond uniquement au timing; aucun score de marché ne peut être calculé avant la découverte du pool.':missingFactorReasons.length?'Facteurs manquants : '+missingFactorReasons.map(x=>x.label+' ('+x.reason+')').join('; ')+'.':evidenceGaps.length?'Facteurs principaux disponibles, mais preuves complémentaires incomplètes.':'Les principaux facteurs du scanner sont disponibles.';
    return {score:adjustedScore===null?null:Math.round(adjustedScore),baseScore:score,coverage,readiness,readinessLabel,readinessReason,marketLinked,missingFactors,missingFactorReasons,evidenceGaps,securityComprehensive,factors:{...f,...(candidateIntel.tradeQuality===null?{}:{tradeQuality:candidateIntel.tradeQuality}),...(candidateIntel.socialQuality===null?{}:{social:candidateIntel.socialQuality})},walletReputation:walletSignal||null,candidateIntel,marketSignals:microstructure.metrics,hardBlocked,risk:hardBlocked||flags.some(x=>x.level==='critical')?'high':flags.some(x=>x.level==='warning')?'medium':t.security?.risk||'unknown',confidence:readiness==='complete'?'high':coverage>=45?'medium':'low',flags,classification:score===null?'insufficient_data':coverage<45?'low_confidence':hardBlocked?'blocked':readiness==='complete'&&adjustedScore>=80?'strong_candidate':adjustedScore>=65?'watch':'weak'};
  }
  scoreAll(){const signals=buildWalletTokenSignals(this.state);for(const t of Object.values(this.state.tokens)){t.walletReputation=signals[t.mint]||null;t.analysis=this.score(t);}}
  async refreshJupiterPrices(candidates=[]){
    const mints=[...new Set((candidates||[]).map(token=>token?.mint).filter(Boolean))].slice(0,5);
    if(!mints.length){this.state.sources.jupiterPrice={ok:false,skipped:true,at:iso(),error:'Aucun candidat prioritaire à vérifier'};return;}
    try{
      const prices=await fetchJupiterPrices(mints);
      const at=iso();let priced=0;
      for(const mint of mints){
        const price=prices[mint];if(!price)continue;
        const token=this.state.tokens[mint];if(!token)continue;
        const dexPrice=n(token.priceUsd);
        const divergencePct=dexPrice>0?Number(((price.priceUsd/dexPrice-1)*100).toFixed(2)):null;
        token.jupiterPrice={...price,checkedAt:at,divergencePct};
        priced++;
      }
      this.state.sources.jupiterPrice={ok:true,at,checked:mints.length,priced,mode:String(process.env.JUPITER_API_KEY||'').trim()?'Price API v3 · clé API':'Price API v3 · accès keyless limité'};
    }catch(error){
      this.state.sources.jupiterPrice={ok:false,at:iso(),error:String(error.message||error).slice(0,160),mode:'Price API v3'};
      console.warn('[Jupiter price]',this.state.sources.jupiterPrice.error);
    }
  }
  async scan(){
    if(this.scanning||this.backgroundTaskRunning)return {skipped:true};this.scanning=true;const start=Date.now();
    try{
      // Fetch and consume one upstream payload at a time. Keeping five large
      // API responses alive in Promise.all caused avoidable RSS spikes on FadeHost.
      // Discovery needs only mint identity. Retaining full DexScreener payloads
      // in a Map duplicated data already stored by upsert() and inflated heap.
      const discoveredMints=new Set();
      const add=(arr,source)=>{if(!Array.isArray(arr))return;for(const x of arr){if(String(x.chainId).toLowerCase()!=='solana'||!x.tokenAddress)continue;discoveredMints.add(x.tokenAddress);this.upsert(x,source);}};
      const dexSources=[['profile',DEX+'/token-profiles/latest/v1'],['boost',DEX+'/token-boosts/latest/v1'],['top_boost',DEX+'/token-boosts/top/v1']];
      const dexErrors=[];let dexOk=false;
      for(const [source,url] of dexSources){
        try{const payload=await json(url,{},1,1024*1024);add(payload,source);dexOk=true;}
        catch(error){dexErrors.push(source+': '+String(error.message||error).slice(0,120));}
      }
      this.state.sources.dexscreener=dexOk?{ok:true,at:iso(),error:null}:{ok:false,error:dexErrors.join('; ').slice(0,200)};
      let geckoCount=0,geckoSuccesses=0;const geckoErrors=[];
      const geckoPageLimit=resolveNewPoolPageLimit(process.env.GECKO_NEW_POOL_PAGES);
      const geckoPageWindow=Math.max(1,Math.min(10,Math.floor(Number(process.env.GECKO_NEW_POOL_PAGE_WINDOW)||10)));
      const geckoPageSequence=resolveNewPoolPageSequence(this.state.geckoDiscoveryCursor||1,geckoPageLimit,geckoPageWindow);
      const geckoPoolsSeen=new Set(),geckoMintsSeen=new Set();
      let geckoPagesAttempted=0,geckoRateLimited=false;
      for(const page of geckoPageSequence.pages){
        geckoPagesAttempted++;
        try{
          const payload=await fetchNewPools({page,maxBytes:1024*1024});
          geckoSuccesses++;
          for(const pool of parseNewPools(payload)){
            const poolKey=String(pool.poolAddress||pool.tokenAddress);
            if(geckoPoolsSeen.has(poolKey))continue;
            geckoPoolsSeen.add(poolKey);
            this.ingestGeckoPool(pool);
            discoveredMints.add(pool.tokenAddress);
            geckoMintsSeen.add(pool.tokenAddress);
            geckoCount++;
          }
        }catch(error){
          const message=String(error.message||error).slice(0,120);
          geckoErrors.push('page '+page+': '+message);
          if(/HTTP 429|Too Many Requests/i.test(message)){geckoRateLimited=true;break;}
        }
      }
      let geckoTrendingCount=0,geckoTrendingError=null;
      const geckoTrendingLastAttempt=Date.parse(this.state.geckoTrendingLastAttemptAt||'')||0;
      if(!geckoRateLimited&&Date.now()-geckoTrendingLastAttempt>=300000){
        this.state.geckoTrendingLastAttemptAt=iso();
        try{
          const trendingPayload=await fetchTrendingPools({duration:'1h',page:1,maxBytes:1024*1024});
          const trendingPools=parseNewPools(trendingPayload,'geckoterminal_trending_pool');
          const trendingSeen=new Set();
          for(const pool of trendingPools){
            const key=String(pool.poolAddress||pool.tokenAddress);
            if(trendingSeen.has(key))continue;
            trendingSeen.add(key);
            this.ingestGeckoPool(pool);
            discoveredMints.add(pool.tokenAddress);
            geckoTrendingCount++;
          }
          this.state.geckoTrendingLastSuccessAt=iso();
          this.state.geckoTrendingLastCount=geckoTrendingCount;
          this.state.geckoTrendingLastError=null;
        }catch(error){
          geckoTrendingError=String(error.message||error).slice(0,140);
          this.state.geckoTrendingLastError=geckoTrendingError;
        }
      }
      const geckoLastAttemptedPage=geckoPageSequence.pages[Math.max(0,geckoPagesAttempted-1)];
      const geckoNextPage=geckoPagesAttempted?((geckoLastAttemptedPage%geckoPageSequence.pageWindow)+1):geckoPageSequence.nextCursor;
      this.state.geckoDiscoveryCursor=geckoNextPage;
      const geckoPageStatus={pageWindow:geckoPageSequence.pageWindow,pageStart:geckoPageSequence.pages[0],pageEnd:geckoLastAttemptedPage||null,nextPage:geckoNextPage};
      this.state.sources.geckoTerminal=geckoSuccesses?{
        ok:true,at:iso(),
        error:geckoErrors.length?'Flux partiels : '+geckoErrors.join('; ').slice(0,140):null,
        pools:geckoCount,uniqueTokens:geckoMintsSeen.size,
        pagesSucceeded:geckoSuccesses,pagesAttempted:geckoPagesAttempted,
        pagesConfigured:geckoPageLimit,rateLimited:geckoRateLimited,trendingPools:geckoTrendingCount,trendingLastSuccessAt:this.state.geckoTrendingLastSuccessAt||null,trendingLastError:geckoTrendingError||this.state.geckoTrendingLastError||null,...geckoPageStatus
      }:{
        ok:false,error:geckoErrors.join('; ').slice(0,180)||'API GeckoTerminal indisponible',
        pagesSucceeded:0,pagesAttempted:geckoPagesAttempted,pagesConfigured:geckoPageLimit,rateLimited:geckoRateLimited,...geckoPageStatus
      };
      const archivedBatch=this.archive.selectForScan(Number(process.env.TOKEN_ARCHIVE_SCAN_BATCH)||20,900000);
      for(const token of archivedBatch){if(!this.state.tokens[token.mint]){this.state.tokens[token.mint]=token;discoveredMints.add(token.mint);}}
      const archivedAddresses=archivedBatch.map(token=>token.mint);
      const archivedMintSet=new Set(archivedAddresses);
      const tracked=topTokens(this.state.tokens,t=>Boolean(t.pairAddress||t.geckoPoolAddress),(a,b)=>n(b.liquidityUsd)-n(a.liquidityUsd),60);
      for(const t of tracked)discoveredMints.add(t.mint);
      const recentLaunches=topTokens(
        this.state.tokens,
        t=>Boolean(t.launchSource||t.geckoPoolAddress||(t.sources||[]).includes('kol_expert_trade'))&&Date.now()-Date.parse(t.firstSeenAt||t.pumpCreatedAt||t.geckoPoolCreatedAt||0)<86400000,
        (a,b)=>Date.parse(b.firstSeenAt||b.pumpCreatedAt||b.geckoPoolCreatedAt||0)-Date.parse(a.firstSeenAt||a.pumpCreatedAt||a.geckoPoolCreatedAt||0),
        20
      );
      for(const t of recentLaunches)discoveredMints.add(t.mint);
      const watchlistAddresses=this.state.watchlist.filter(mint=>this.state.tokens[mint]?.mint).slice(-20);
      const priorityAddresses=[...watchlistAddresses,...archivedAddresses,...tracked.map(t=>t.mint),...recentLaunches.map(t=>t.mint)];
      const freshBatch=selectFreshDiscoveryBatch([...discoveredMints],priorityAddresses,this.state.freshDiscoveryCursor||0,100);
      const freshAddresses=freshBatch.items;
      this.state.freshDiscoveryCursor=freshBatch.nextCursor;
      const addresses=[...new Set([...watchlistAddresses,...archivedAddresses,...tracked.map(t=>t.mint),...freshAddresses,...recentLaunches.map(t=>t.mint)])].slice(0,200);
      let archivedFetchSucceeded=true;
      for(let i=0;i<addresses.length;i+=30){
        const chunk=addresses.slice(i,i+30);
        const includesArchive=chunk.some(mint=>archivedMintSet.has(mint));
        try{
          const pairs=await json(DEX+'/tokens/v1/solana/'+chunk.join(','));
          if(!Array.isArray(pairs)){if(includesArchive)archivedFetchSucceeded=false;continue;}
          const bestByMint=new Map();
          for(const pair of pairs){
            const mint=pair?.baseToken?.address;
            if(!mint||pair.chainId!=='solana')continue;
            const liquidity=Number(pair.liquidity?.usd)||0;
            const previous=bestByMint.get(mint);
            if(!previous||liquidity>(Number(previous.liquidity?.usd)||0))bestByMint.set(mint,pair);
          }
          for(const pair of bestByMint.values())this.pair(pair);
        }catch(error){
          if(includesArchive)archivedFetchSucceeded=false;
          console.warn('[dex pairs]',error.message);
        }
      }
      if(archivedAddresses.length&&archivedFetchSucceeded){
        try{this.archive.markScanned(archivedAddresses);}
        catch(error){console.warn('[token archive] scan cursor update failed:',String(error.message||error).slice(0,160));}
      }
      // DexScreener indexing can lag behind Pump.fun migration events. Retry a few migrated,
      // still-unlinked mints directly without adding an unbounded request fan-out.
      const retryNow=Date.now();
      const retryCandidates=topTokens(
        this.state.tokens,
        t=>t.migrated&&!t.pairAddress&&!t.geckoPoolAddress&&(!t.pairLookupAt||retryNow-Date.parse(t.pairLookupAt)>300000),
        (a,b)=>Date.parse(b.migratedAt||0)-Date.parse(a.migratedAt||0),
        3
      );
      for(const token of retryCandidates){
        token.pairLookupAt=iso();
        try{const candidates=await json(DEX+'/token-pairs/v1/solana/'+encodeURIComponent(token.mint),{},0,512*1024);if(Array.isArray(candidates)&&candidates.length){candidates.sort((a,b)=>(Number(b.liquidity?.usd)||0)-(Number(a.liquidity?.usd)||0));this.pair(candidates[0]);token.pairLookupError=null;}else token.pairLookupError='Aucune paire indexée pour le moment';}
        catch(error){token.pairLookupError=String(error.message||error).slice(0,160);}
      }
      resolveNoMarketCohorts(Object.values(this.state.tokens).filter(t=>t.launchCohort));
      this.state.lastScanAt=iso();this.state.lastScanDurationMs=Date.now()-start;
      this.scoreAll();
      let budget=memoryBudget({maxHeapMiB:72,maxExternalMiB:18,maxRssMiB:240});
      if(budget.ok)await this.securityLeaders();else console.warn('[memory guard] startup security stage deferred',budget);
      budget=memoryBudget({maxHeapMiB:72,maxExternalMiB:18,maxRssMiB:240});
      if(budget.ok)await this.refreshCandidateIntelligence();else console.warn('[memory guard] startup candidate intelligence deferred',budget);
      this.scoreAll();const currentSelection=this.selection();await this.refreshJupiterPrices(currentSelection.best);updateSelectionCohorts(this.state,currentSelection);stepPaperTrading(this.state,currentSelection,Date.now());await this.alerts();this.save();
      return {discovered:discoveredMints.size,total:Object.keys(this.state.tokens).length,durationMs:this.state.lastScanDurationMs};
    }finally{this.scanning=false;}
  }
  async rpc(method,params=[]) {
    const endpoints=this.rpcEndpoints?.length?this.rpcEndpoints:[RPC];
    const now=Date.now();
    const ranked=[...endpoints.slice(this.rpcProviderIndex||0),...endpoints.slice(0,this.rpcProviderIndex||0)]
      .sort((a,b)=>(this.rpcProviderBackoff?.get(a)||0)-(this.rpcProviderBackoff?.get(b)||0));
    const available=ranked.filter(endpoint=>(this.rpcProviderBackoff?.get(endpoint)||0)<=now);
    // Do not keep hitting endpoints during their cooldown. If every provider
    // is cooling down, probe only the one whose retry time is earliest.
    const ordered=available.length?available:ranked.slice(0,1);
    const errors=[];
    for(const endpoint of ordered){
      const started=Date.now();
      try{
        const data=await json(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})},0);
        if(data.error){
          const error=new Error(data.error.message||'Erreur RPC Solana');
          error.rpcApplicationError=true;
          throw error;
        }
        this.rpcProviderIndex=endpoints.indexOf(endpoint);
        this.rpcProviderBackoff?.delete(endpoint);
        const host=new URL(endpoint).host;
        this.state.sources.solanaRpcProviders ||= {};
        this.state.sources.solanaRpcProviders[host]={ok:true,at:iso(),latencyMs:Date.now()-started,error:null};
        this.state.sources.solanaRpc={ok:true,at:iso(),endpoint:host,providerCount:endpoints.length,error:null};
        return data.result;
      }catch(error){
        if(error.rpcApplicationError)throw error;
        const message=String(error.message||error).slice(0,150);
        const rateLimited=/HTTP 429/i.test(message);
        const cooldown=rateLimited?60000:20000;
        this.rpcProviderBackoff?.set(endpoint,Date.now()+cooldown);
        let host=endpoint;
        try{host=new URL(endpoint).host;}catch{}
        this.state.sources.solanaRpcProviders ||= {};
        this.state.sources.solanaRpcProviders[host]={ok:false,at:iso(),error:message,retryAfter:new Date(Date.now()+cooldown).toISOString()};
        errors.push(host+': '+message);
      }
    }
    const message=errors.join(' · ').slice(0,500)||'Tous les RPC Solana sont indisponibles';
    this.state.sources.solanaRpc={ok:false,at:iso(),error:message,providerCount:endpoints.length};
    throw new Error(message);
  }
  async inspectSecurity(t,{persist=true}={}) {
    if(!t?.mint)throw new Error('Adresse du token absente');
    // Sequential RPC requests reduce simultaneous JSON payloads and native buffers.
    const mint=await this.rpc('getAccountInfo',[t.mint,{encoding:'base64',commitment:'confirmed'}]);
    const largest=await this.rpc('getTokenLargestAccounts',[t.mint,{commitment:'confirmed'}]);
    const supply=await this.rpc('getTokenSupply',[t.mint,{commitment:'confirmed'}]);
    const raw=mint?.value?.data?.[0];
    if(!raw)throw new Error('Compte mint introuvable ou fermé');
    const b=Buffer.from(raw,'base64');
    if(b.length<82)throw new Error('Compte mint SPL invalide');
    const mintAuthority=b.readUInt32LE(0)!==0?b.subarray(4,36).toString('hex'):null;
    const tokenProgram=String(mint?.value?.owner||'unknown');
    const isToken2022=tokenProgram==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    const freezeAuthority=b.readUInt32LE(46)!==0?b.subarray(50,82).toString('hex'):null;
    const rows=(largest?.value||[]).slice(0,20);
    let holderIntel={top10HolderPercent:null,top10AccountPercent:null,top5OwnerPercent:null,top1OwnerPercent:null,top20HolderPercent:null,top20AccountPercent:null,holderGiniTop20:null,holderHhiTop20:null,effectiveOwnersTop20:null,holderSampleAccounts:0,holderSampleOwners:0,holderSampleCoveragePct:null,unknownOwnerAccounts:0,uniqueOwnerCount:0,ownerConcentrationAvailable:false};
    if(rows.length){
      try{
        const infos=await this.rpc('getMultipleAccounts',[rows.map(x=>x.address),{encoding:'jsonParsed',commitment:'confirmed'}]);
        const accounts=infos?.value||[];
        holderIntel=analyzeLargestHolders(rows,accounts,supply?.value?.amount||'0');
      }catch(e){console.warn('[holder intel]',e.message);}
    }
    const totalRaw=BigInt(supply?.value?.amount||0);
    const accountTop10=rows.slice(0,10).reduce((sum,x)=>sum+BigInt(x.amount||0),0n);
    const top10AccountPercent=totalRaw>0n?Number(accountTop10*1000000n/totalRaw)/10000:null;
    const top10HolderPercent=holderIntel.top10HolderPercent;
    t.security={checkedAt:iso(),provider:'Solana RPC public',data:{
      mintAuthorityActive:Boolean(mintAuthority),freezeAuthorityActive:Boolean(freezeAuthority),
      mintAuthority,freezeAuthority,tokenProgram,isToken2022,top10HolderPercent,top10AccountPercent,
      top5OwnerPercent:holderIntel.top5OwnerPercent,top1OwnerPercent:holderIntel.top1OwnerPercent,
      uniqueOwnerCount:holderIntel.uniqueOwnerCount,ownerConcentrationAvailable:holderIntel.ownerConcentrationAvailable,
      top20HolderPercent:holderIntel.top20HolderPercent,top20AccountPercent:holderIntel.top20AccountPercent,
      holderGiniTop20:holderIntel.holderGiniTop20,holderHhiTop20:holderIntel.holderHhiTop20,
      effectiveOwnersTop20:holderIntel.effectiveOwnersTop20,holderSampleAccounts:holderIntel.holderSampleAccounts,
      holderSampleOwners:holderIntel.holderSampleOwners,holderSampleCoveragePct:holderIntel.holderSampleCoveragePct,
      unknownOwnerAccounts:holderIntel.unknownOwnerAccounts,
      decimals:b[44],isInitialized:b[45]===1,supply:supply?.value?.uiAmountString||null
    }};
    t.security.hardBlocked=Boolean(freezeAuthority);
    if(persist){this.scoreAll();this.save();}
    return t.security;
  }
  async securityLeaders() {
    if(Date.now()-this.lastSecurity<600000)return;
    this.lastSecurity=Date.now();
    const budget=memoryBudget({maxHeapMiB:72,maxExternalMiB:18,maxRssMiB:240});
    if(!budget.ok){console.warn('[memory guard] security checks deferred',budget);return;}
    const leaders=Object.values(this.state.tokens).filter(t=>(t.pairAddress||t.geckoPoolAddress)&&(!t.security?.checkedAt||Date.now()-Date.parse(t.security.checkedAt)>3600000))
      .sort((a,b)=>Number(Boolean(b.launchSource))-Number(Boolean(a.launchSource))||Date.parse(a.security?.checkedAt||0)-Date.parse(b.security?.checkedAt||0)||n(b.liquidityUsd)-n(a.liquidityUsd)).slice(0,2);
    for(const t of leaders){
      try{await this.inspectSecurity(t,{persist:false});}catch(e){this.state.sources.solanaRpc={ok:false,error:e.message.slice(0,180)};break;}
      try{await this.inspectExternalSecurity(t);}catch(e){console.warn('[external security]',e.message);}
    }
  }
  async refreshWallets() {
    const manual=this.state.wallets.slice(0,10);
    const automaticPool=(this.state.autoWallets||[]).filter(w=>!manual.some(x=>x.address===w.address)).map(w=>({...w,...scoreWalletDiscovery(w),automatic:true})).sort((a,b)=>b.discoveryScore-a.discoveryScore||Date.parse(b.lastSeenAt||0)-Date.parse(a.lastSeenAt||0));
    const automatic=automaticPool.length?Array.from({length:Math.min(5,automaticPool.length)},(_,i)=>automaticPool[(this.autoWalletCursor+i)%automaticPool.length]):[];
    if(automaticPool.length)this.autoWalletCursor=(this.autoWalletCursor+automatic.length)%automaticPool.length;
    const creatorMap=new Map();
    for(const token of Object.values(this.state.tokens)){
      if(token.creatorObservedAtLaunch!==true||!token.creator)continue;
      const row=creatorMap.get(token.creator)||{address:token.creator,label:'Créateur observé',creator:true,creatorMints:[]};
      if(!row.creatorMints.includes(token.mint))row.creatorMints.push(token.mint);
      creatorMap.set(token.creator,row);
    }
    const creatorRows=[...creatorMap.values()];
    const creators=creatorRows.length?Array.from({length:Math.min(5,creatorRows.length)},(_,i)=>creatorRows[(this.creatorCursor+i)%creatorRows.length]):[];
    if(creatorRows.length)this.creatorCursor=(this.creatorCursor+creators.length)%creatorRows.length;
    const combined=new Map();
    for(const wallet of [...manual,...automatic,...creators]){
      const prior=combined.get(wallet.address)||{};
      combined.set(wallet.address,{...prior,...wallet,creator:Boolean(prior.creator||wallet.creator),creatorMints:[...new Set([...(prior.creatorMints||[]),...(wallet.creatorMints||[])])]});
    }
    const monitored=[...combined.values()];
    if(!monitored.length)return;
    const stableMints=new Set([
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    ]);
    const amount=(rows,mint,owner)=>rows.filter(x=>x.mint===mint&&x.owner===owner).reduce((sum,x)=>sum+Number(x.uiTokenAmount?.amount||0)/Math.pow(10,Number(x.uiTokenAmount?.decimals||0)),0);
    for(const wallet of monitored){
      try{
        const fetchLimit=1000,processLimit=20;
        const signatures=await this.rpc('getSignaturesForAddress',[wallet.address,{limit:fetchLimit,commitment:'confirmed'}]);
        const latestCursor=this.state.walletLatestCursors[wallet.address]||null;
        const rows=Array.isArray(signatures)?signatures:[];
        let newSignatures=[],anchorFound=!latestCursor;
        if(latestCursor){
          for(const row of rows){if(row.signature===latestCursor){anchorFound=true;break;}newSignatures.push(row);}
          if(!anchorFound){
            this.state.walletMonitoringGaps[wallet.address]={at:iso(),reason:'Le dernier curseur est absent des 1 000 signatures les plus récentes; une interruption ou un volume supérieur à la fenêtre peut avoir créé un trou.',lastKnownSignature:latestCursor,oldestAvailableSignature:rows.at(-1)?.signature||null};
          }
        }else{
          newSignatures=rows.slice(0,processLimit);
          if(this.state.walletCursors[wallet.address])this.state.walletMonitoringGaps[wallet.address]={at:iso(),reason:'Migration depuis un ancien curseur de pagination; la couverture antérieure à la reprise n’est pas garantie.',legacyCursor:this.state.walletCursors[wallet.address]};
        }
        if(rows.length)this.state.walletLatestCursors[wallet.address]=rows[0].signature;
        const pending=this.state.walletPendingSignatures[wallet.address] ||= [];
        const queued=new Set(pending.map(row=>row.signature));
        for(const row of newSignatures.reverse()){
          if(!row.signature||queued.has(row.signature))continue;
          pending.push({...row,attempts:0});
          queued.add(row.signature);
        }
        if(pending.length>5000){
          this.state.walletMonitoringGaps[wallet.address]={at:iso(),reason:'La file de transactions en attente a dépassé 5 000 signatures; surveillance partiellement interrompue.',pendingSignatures:pending.length};
          pending.splice(5000);
        }
        const mints=new Set();
        let processedSignatures=0;
        for(const signature of pending.slice(0,processLimit)){
          if(signature.err){pending.shift();processedSignatures++;continue;}
          const tx=await this.rpc('getTransaction',[signature.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
          if(!tx?.meta){
            signature.attempts=(signature.attempts||0)+1;
            if(signature.attempts<3)break;
            this.state.walletMonitoringGaps[wallet.address]={at:iso(),reason:'Une signature est restée sans métadonnées après trois tentatives; elle a été ignorée.',signature:signature.signature};
            pending.shift();processedSignatures++;continue;
          }
          const pre=tx.meta.preTokenBalances||[],post=tx.meta.postTokenBalances||[];
          const changedMints=new Set([...pre,...post].map(x=>x.mint).filter(Boolean));
          const keys=tx.transaction?.message?.accountKeys||tx.message?.accountKeys||[];
          const walletIndex=keys.findIndex(x=>String(typeof x==='string'?x:x.pubkey||x.key)===wallet.address);
          let nativeDeltaSol=0;
          if(walletIndex>=0&&tx.meta.preBalances?.[walletIndex]!==undefined&&tx.meta.postBalances?.[walletIndex]!==undefined){
            const fee=walletIndex===0?Number(tx.meta.fee||0):0;
            nativeDeltaSol=(Number(tx.meta.postBalances[walletIndex])-Number(tx.meta.preBalances[walletIndex])+fee)/1e9;
          }
          let stableDelta=0,stableAsset=null;
          for(const stableMint of stableMints){
            const delta=amount(post,stableMint,wallet.address)-amount(pre,stableMint,wallet.address);
            if(Math.abs(delta)>Math.abs(stableDelta)){stableDelta=delta;stableAsset=stableMint=== 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGkZwyTDt1v'?'USDC':'USDT';}
          }
          const quoteIn=stableDelta>0.5?{asset:stableAsset,amount:Number(stableDelta.toFixed(4))}:nativeDeltaSol>0.0001?{asset:'SOL',amount:Number(nativeDeltaSol.toFixed(6))}:null;
          const quoteOut=stableDelta< -0.5?{asset:stableAsset,amount:Number(Math.abs(stableDelta).toFixed(4))}:nativeDeltaSol< -0.0001?{asset:'SOL',amount:Number(Math.abs(nativeDeltaSol).toFixed(6))}:null;
          for(const mint of changedMints){
            mints.add(mint);
            const delta=amount(post,mint,wallet.address)-amount(pre,mint,wallet.address);
            if(Math.abs(delta)<=0)continue;
            const token=this.state.tokens[mint];
            const isCreatorToken=Boolean(wallet.creator&&token?.creatorObservedAtLaunch===true&&token.creator===wallet.address);
            const direction=delta>0?'buy':'sell';
            const swapConfirmed=direction==='sell'?Boolean(quoteIn):Boolean(quoteOut);
            const event={
              wallet:wallet.address,mint,signature:signature.signature,
              at:tx.blockTime?new Date(tx.blockTime*1000).toISOString():iso(),
              direction,tokenAmount:Math.abs(delta),
              observedPriceUsd:token?.priceUsd||null,
              role:isCreatorToken?'creator':wallet.automatic?'early_buyer':wallet.creator?'creator_wallet':'tracked_wallet',slot:Number.isFinite(Number(tx.slot))?Number(tx.slot):null,
              creatorToken:isCreatorToken,swapConfirmed,
              flowType:swapConfirmed?'swap_like':direction==='sell'?'token_outflow_unconfirmed':'token_inflow_unconfirmed',
              quoteReceived:direction==='sell'&&swapConfirmed?quoteIn:null,
              quoteSpent:direction==='buy'&&swapConfirmed?quoteOut:null
            };
            this.state.walletTrades ||= [];
            const exists=this.state.walletTrades.some(x=>x.signature===event.signature&&x.wallet===event.wallet&&x.mint===event.mint);
            if(!exists){
              this.state.walletTrades.push(event);
              if(token&&isCreatorToken&&direction==='sell'){
                token.creatorOutflows ||= [];
                token.creatorOutflows.push(event);
                token.creatorOutflows=token.creatorOutflows.slice(-50);
                if(swapConfirmed){
                  token.creatorSaleEvents ||= [];
                  token.creatorSaleEvents.push(event);
                  token.creatorSaleEvents=token.creatorSaleEvents.slice(-50);
                  const supply=Number(token.security?.data?.supply);
                  const soldPctSupply=supply>0?Number((Math.abs(delta)/supply*100).toFixed(4)):null;
                  const totalSold=token.creatorSaleEvents.reduce((sum,x)=>sum+x.tokenAmount,0);
                  const sold24h=token.creatorSaleEvents.filter(x=>Date.now()-Date.parse(x.at||0)<=86400000).reduce((sum,x)=>sum+x.tokenAmount,0);
                  token.creatorSaleSummary={lastAt:event.at,confirmedSwapLikeSales:token.creatorSaleEvents.length,totalTokensOutflow:totalSold,lastQuoteReceived:quoteIn,soldPctSupplyLast:soldPctSupply,totalSoldPctSupply:supply>0?Number((totalSold/supply*100).toFixed(4)):null,soldPctSupply24h:supply>0?Number((sold24h/supply*100).toFixed(4)):null,classification:'swap_like_outflow_observed'};
                }
              }
              if(token&&wallet.automatic&&direction==='sell'){
                token.earlyWalletOutflows ||= [];
                token.earlyWalletOutflows.push(event);
                token.earlyWalletOutflows=token.earlyWalletOutflows.slice(-50);
              }
            }
          }
          pending.shift();processedSignatures++;
        }
        this.state.walletActivity[wallet.address]={at:iso(),mints:[...mints].slice(0,50),role:wallet.creator?'creator':wallet.automatic?'early_buyer':'manual',creatorMints:wallet.creatorMints||[],processedSignatures,pendingSignatures:pending.length,monitoringGap:this.state.walletMonitoringGaps[wallet.address]?.reason||null};
        for(const mint of mints){
          const token=this.state.tokens[mint];
          if(token){
            token.smartMoney ||= {hits:0,wallets:[]};
            if(!token.smartMoney.wallets.includes(wallet.address))token.smartMoney.wallets.push(wallet.address);
            token.smartMoney.hits=token.smartMoney.wallets.length;
            token.smartMoney.lastSeenAt=iso();
          }
        }
      }catch(error){
        this.state.walletActivity[wallet.address]={at:iso(),error:String(error.message||error).slice(0,160),role:wallet.creator?'creator':wallet.automatic?'early_buyer':'manual'};
        this.state.sources.solanaRpc={ok:false,error:String(error.message||error).slice(0,180)};
      }
    }
    this.scoreAll();this.save();
  }
  async social(mint) {
    const t=this.state.tokens[mint];if(!t)throw new Error('Token introuvable');
    return {configured:true,source:'Reddit RSS + Bluesky + Nostr + canaux Telegram publics liés aux métadonnées',socials:t.socials||[],websites:t.websites||[],intel:t.socialIntel||this.mergeSocialIntel(t),message:'Mentions publiques Reddit, Bluesky, Nostr et canaux Telegram publics référencés par les métadonnées du token. Pas de recherche globale X/Telegram; les canaux privés ne sont pas accessibles.'};
  }
  async detail(mint) {
    const t=this.state.tokens[mint];if(!t)throw new Error('Token absent du scanner');
    try{const pairs=await json(DEX+'/token-pairs/v1/solana/'+encodeURIComponent(mint),{},0);if(Array.isArray(pairs)&&pairs.length){pairs.sort((a,b)=>n(b.liquidity?.usd)-n(a.liquidity?.usd));this.pair(pairs[0]);}}catch(e){t.detailError=e.message;}
    if(!t.security?.checkedAt||Date.now()-Date.parse(t.security.checkedAt)>300000){try{await this.inspectSecurity(t);}catch(e){t.security={checkedAt:iso(),provider:'Solana RPC public',error:e.message};}}
    await this.inspectExternalSecurity(t);
    await this.inspectTradeIntel(t);
    this.scoreAll();this.save();return t;
  }
  selection(){
    const calibration=resolveAdaptiveSelectionThreshold(this.learningSummary().outOfSample,68);
    const selection=buildSelection(this.state.tokens,Date.now(),{minScore:calibration.threshold});
    selection.adaptiveThreshold=calibration;
    return selection;
  }
  activeAlertThreshold(){
    const configuredThreshold=n(process.env.ALERT_MIN_SCORE)||78;
    const outOfSample=this.learningSummary().outOfSample||{};
    const holdout=outOfSample.holdoutAtSelectedThreshold||{};
    const validated=outOfSample.status==='holdout_available'
      &&Number(outOfSample.validation?.tokens)>=20
      &&Number(holdout.tokens)>=20
      &&Number(holdout.positive15Pct)>=55
      &&Number(holdout.averageReturnPct)>0
      &&Number(holdout.loss20Pct)<=25;
    return {threshold:validated?Number(outOfSample.selectedThreshold):configuredThreshold,source:validated?'out_of_sample_validation':'configured',validated,holdoutTokens:Number(holdout.tokens)||0};
  }
  async drainTelegramOutbox(limit=10){
    if(!this.bot||!Array.isArray(this.state.telegramOutbox)||!this.state.telegramOutbox.length)return {sent:0,failed:0,pending:this.state.telegramOutbox?.length||0};
    const due=claimDueTelegramOutbox(this.state.telegramOutbox,Date.now(),Math.max(1,Math.min(25,Number(limit)||10)));
    if(!due.length)return {sent:0,failed:0,pending:this.state.telegramOutbox.length};
    // Persist the claim before contacting Telegram; interrupted sends are re-queued on restart.
    try{this.save();}catch(error){
      for(const entry of due){entry.status='queued';entry.attempts=Math.max(0,entry.attempts-1);entry.lastAttemptAt=null;}
      this.lastPersistenceError=String(error.message||error).slice(0,180);
      console.error('[telegram outbox persistence]',this.lastPersistenceError);
      return {sent:0,failed:0,pending:this.state.telegramOutbox.length,error:this.lastPersistenceError};
    }
    let sent=0,failed=0;
    for(const entry of due){
      try{
        await this.bot.api.sendMessage(entry.chatId,entry.message,{disable_web_page_preview:true});
        markTelegramOutboxSent(this.state.telegramOutbox,entry.id);
        const channel=this.state.telegramChannels.find(row=>row.chatId===entry.chatId);
        if(channel){channel.lastSentAt=iso();channel.lastError=null;}
        sent++;
      }catch(error){
        markTelegramOutboxFailed(entry,error);
        const channel=this.state.telegramChannels.find(row=>row.chatId===entry.chatId);
        if(channel)channel.lastError=String(error.message||error).slice(0,180);
        console.error('[telegram outbox]',entry.chatId,entry.lastError);
        failed++;
      }
      try{this.save();}catch(saveError){
        this.lastPersistenceError=String(saveError.message||saveError).slice(0,180);
        console.error('[telegram outbox persistence]',this.lastPersistenceError);
        break;
      }
    }
    return {sent,failed,pending:this.state.telegramOutbox.length};
  }
  async alerts(){
    this.lastAlertThreshold=this.activeAlertThreshold();
    const threshold=this.lastAlertThreshold.threshold;
    const minLiq=n(process.env.MIN_LIQUIDITY_USD)||5000;
    const tradesByMint=new Map();
    for(const event of this.state.walletTrades||[]){
      if(event.role!=='early_buyer'||event.swapConfirmed!==true||!event.mint)continue;
      let bucket=tradesByMint.get(event.mint);
      if(!bucket){bucket=[];tradesByMint.set(event.mint,bucket);}
      bucket.push(event);
    }
    const now=Date.now();
    for(const t of Object.values(this.state.tokens)){
      const a=t.analysis||{};
      const exits=this.earlyBuyerExitIntel(t.mint,tradesByMint.get(t.mint)||[],now);
      t.earlyBuyerExitSummary=exits;
      const marketLinked=Boolean(t.pairAddress||t.geckoPoolAddress);
      const watchEligible=Boolean(t.analysis&&a.score!==null&&a.coverage>=45&&marketLinked);
      const opportunityEligible=Boolean(watchEligible&&a.coverage>=70&&Number.isFinite(a.factors?.security));
      const critical=(a.flags||[]).some(flag=>flag.level==='critical')||a.hardBlocked===true;
      const liquidity=n(t.liquidityUsd);
      const proposedLevel=critical?'danger':opportunityEligible&&a.score>=threshold&&liquidity>=minLiq?'opportunity':watchEligible&&a.score>=60&&liquidity>=Math.min(minLiq,1500)?'watch':'none';
      let level=proposedLevel;
      if(exits.alert&&!critical&&level==='none'&&watchEligible)level='watch';
      const qualified=qualifyAlertLevel(t,level,a.score);
      level=qualified.level;
      t.signalLevel=level;
      t.signalFreshness=qualified.freshness;
      const reasons=qualified.reason?[qualified.reason]:critical?(a.flags||[]).filter(flag=>flag.level==='critical').map(flag=>flag.message):level==='opportunity'?['Score élevé, couverture suffisante et liquidité minimale atteinte']:level==='watch'?['Premiers signaux intéressants, confirmation encore nécessaire']:[];
      if(exits.alert)reasons.push('Sorties swap-like observées chez '+exits.wallets+' acheteurs précoces suivis en 30 min ('+exits.soldSharePct+'% des achats swap-like suivis estimés).');
      t.signalReasons=reasons;
      if(level==='none')continue;
      const previous=[...this.state.alerts].reverse().find(x=>x.mint===t.mint&&x.level===level);
      if(previous&&Date.now()-Date.parse(previous.at)<(level==='watch'?3600000:21600000))continue;
      const label=level==='danger'?'DANGER':level==='opportunity'?'OPPORTUNITÉ':'À SURVEILLER';
      const message=label+' MEME RADAR : '+(t.symbol||t.mint)+' — '+(a.score??'—')+'/100, couverture '+(a.coverage??'—')+'%, liquidité '+Math.round(liquidity)+' USD';
      const alert={mint:t.mint,symbol:t.symbol||t.mint.slice(0,6),level,score:a.score??null,coverage:a.coverage??null,classification:a.classification||'unknown',flags:a.flags||[],reasons:t.signalReasons,at:iso(),message};
      this.state.alerts.push(alert);
      if(this.bot&&level!=='watch'){
        const channels=normalizeTelegramChannels(this.state.telegramChannels);
        this.state.telegramChannels=channels;
        const publication=formatTelegramAlert(t,level);
        const alertId=alert.at+':'+t.mint+':'+level;
        this.state.telegramOutbox ||= [];
        for(const channel of channels){
          if(!channel.enabled)continue;
          const entry=createTelegramOutboxEntry({alertId,chatId:channel.chatId,message:publication,now:alert.at});
          if(!this.state.telegramOutbox.some(row=>row.id===entry.id))this.state.telegramOutbox.push(entry);
        }
        this.scheduleSave();
      }
    }
    // Drain on every scan, including scans that did not create a new alert.
    if(this.bot)await this.drainTelegramOutbox();
  }
  tokens({sort='score',limit=100,search='',includeBlocked=true}={}){let a=Object.values(this.state.tokens).filter(t=>(includeBlocked||!t.analysis?.hardBlocked)&&(!search||((t.name||'')+' '+(t.symbol||'')+' '+t.mint).toLowerCase().includes(search.toLowerCase())));const sorters={score:(x,y)=>n(y.analysis?.score)-n(x.analysis?.score),liquidity:(x,y)=>n(y.liquidityUsd)-n(x.liquidityUsd),volume:(x,y)=>n(y.volume?.h24)-n(x.volume?.h24),newest:(x,y)=>(n(y.pairCreatedAt)||Date.parse(y.pumpCreatedAt||y.updatedAt)||0)-(n(x.pairCreatedAt)||Date.parse(x.pumpCreatedAt||x.updatedAt)||0),momentum:(x,y)=>n(y.analysis?.factors?.momentum)-n(x.analysis?.factors?.momentum)};a.sort(sorters[sort]||sorters.score);return a.slice(0,Math.min(250,Math.max(1,n(limit)||100)));}
  healthSummary(){
    const now=Date.now(),status=this.status();
    const age=value=>value?Math.max(0,now-Date.parse(value)):null;
    const checks={
      scanner:{ok:this.running&&Boolean(this.state.lastScanAt),critical:true,detail:!this.running?'Scanner arrêté':this.state.lastScanAt?'Premier scan terminé':'Premier scan en cours'},
      dexscreener:{ok:age(status.dexscreener.lastSuccess)!==null&&age(status.dexscreener.lastSuccess)<180000,critical:true,ageMs:age(status.dexscreener.lastSuccess),error:status.dexscreener.error},
      geckoTerminal:{ok:age(status.geckoTerminal.lastSuccess)!==null&&age(status.geckoTerminal.lastSuccess)<180000,critical:false,ageMs:age(status.geckoTerminal.lastSuccess),error:status.geckoTerminal.error},
      solanaRpc:{ok:age(status.solanaRpc.lastSuccess)!==null&&age(status.solanaRpc.lastSuccess)<900000,critical:false,ageMs:age(status.solanaRpc.lastSuccess),error:status.solanaRpc.error},
      pumpPortal:{ok:status.pumpPortal.connected===true,critical:false,lastMessageAt:status.pumpPortal.lastMessageAt,error:status.pumpPortal.lastError},
      reddit:{ok:status.redditRss.connected===true,critical:false,lastSuccess:status.redditRss.lastSuccess,error:status.redditRss.error},
      bluesky:{ok:status.bluesky.connected===true,critical:false,lastSuccess:status.bluesky.lastSuccess,error:status.bluesky.lastError},
      nostr:{ok:status.nostr?.connected===true,critical:false,lastSuccess:status.nostr?.lastSuccess||null,error:status.nostr?.lastError||null},
      telegramSocial:{ok:status.telegramSocial?.connected===true,critical:false,lastSuccess:status.telegramSocial?.lastSuccess||null,error:status.telegramSocial?.lastError||null}
    };
    return {state:Object.values(checks).filter(x=>x.critical).every(x=>x.ok)?'healthy':'degraded',checks,checkedAt:iso(),note:'La disponibilité des sources externes est mesurée séparément; une source publique peut être temporairement indisponible.'};
  }
  overview(){const a=Object.values(this.state.tokens),archive=this.archive.summary();return {ok:true,narratives:narrativeSummary(a),social:{redditPosts:this.redditRadar.items.length,matchedTokens:a.filter(t=>(t.socialIntel?.mentions24h||0)>0).length},stats:{tracked:a.length,archived:archive.tokens,totalStored:a.length+archive.tokens,archiveAvailable:archive.available,autoWallets:(this.state.autoWallets||[]).length,activePairs:a.filter(t=>t.pairAddress||t.geckoPoolAddress).length,recentLaunches:a.filter(t=>(t.launchSource||t.geckoPoolAddress)&&Date.now()-Date.parse(t.firstSeenAt||t.pumpCreatedAt||t.geckoPoolCreatedAt||0)<86400000).length,migrations:a.filter(t=>t.migrated).length,highSignals:a.filter(t=>t.analysis?.score>=75&&t.analysis?.coverage>=45&&!t.analysis?.hardBlocked).length,blocked:a.filter(t=>t.analysis?.hardBlocked).length,alerts:this.state.alerts.length},archive,lastScanAt:this.state.lastScanAt,lastScanDurationMs:this.state.lastScanDurationMs||null,sources:this.status(),thresholds:{minLiquidityUsd:n(process.env.MIN_LIQUIDITY_USD)||5000,alertMinScore:this.lastAlertThreshold.threshold,alertThresholdSource:this.lastAlertThreshold.source},scannerRunning:this.running};}
  addWatch(mint){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint||'')))throw new Error('Adresse Solana invalide');if(!this.state.watchlist.includes(mint))this.state.watchlist.push(mint);this.save();return this.state.watchlist;}
  removeWatch(mint){this.state.watchlist=this.state.watchlist.filter(x=>x!==mint);this.save();return this.state.watchlist;}
  addWallet(address,label=''){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address||'')))throw new Error('Adresse wallet Solana invalide');if(!this.state.wallets.some(x=>x.address===address)){if(this.state.wallets.length>=10)throw new Error('Limite de 10 wallets suivis pour maîtriser les quotas RPC publics');this.state.wallets.push({address,label:String(label).slice(0,60),addedAt:iso()});}this.save();return this.state.wallets;}
  removeWallet(address){this.state.wallets=this.state.wallets.filter(x=>x.address!==address);this.save();return this.state.wallets;}
}
Object.assign(MemeScanner.prototype,require('./intelligence'),require('./historical-benchmark'),require('./learning'),require('./external-security'),require('./wallet-graph'),require('./data-quality'),require('./wallet-signal-backtest'));
module.exports={MemeScanner,buildRpcEndpoints,memoryBudget};
