'use strict';
const crypto = require('node:crypto');
const { normalizeTelegramChannels, formatTelegramAlert, buildTelegramAlertKeyboard } = require('./telegram-channels');
const { createTelegramOutboxEntry, claimDueTelegramOutbox, markTelegramOutboxSent, markTelegramOutboxFailed } = require('./telegram-outbox');
const { queueAlertForChannels, markAlertDelivered } = require('./telegram-alert-delivery');
const fs = require('node:fs');
const { writeJsonFileSync } = require('./stream-json-write');
const path = require('node:path');
const { analyzeLargestHolders } = require('./holder-intel');
const { TOKEN_2022_MINT_PROGRAM, inspectToken2022MintExtensions } = require('./token-2022-intel');
const SPL_TOKEN_MINT_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const { readJsonLimited } = require('./http-body');
const { LaunchStream } = require('./launch-stream');
const { analyzeMicrostructure } = require('./market-intel');
const { narrativeSummary } = require('./narratives');
const { fetchNewPools, fetchTrendingPools, parseNewPools, resolveNewPoolPageLimit, resolveNewPoolPageSequence, fetchPoolTrades, analyzePoolTrades, mergeObservedTrades } = require('./gecko-discovery');
const { RedditRadar } = require('./social-radar');
const { BlueskyRadar } = require('./bluesky-radar');
const { NostrRadar } = require('./nostr-radar');
const { TelegramRadar } = require('./telegram-radar');
const { XSocialRadar, extractSolanaMints } = require('./x-radar');
const { extractCreatorFunder } = require('./creator-funding');
const { qualifyAlertLevel, qualifyOpportunity, assessOpportunityEvidence } = require('./alert-quality');
const { evaluateCandidateIntel } = require('./candidate-intel');
const { analyzeSocialEvidence, classifyTokenMention } = require('./social-evidence');
const { buildEliteIntelligenceIndex, evaluateEliteIntelligence, buildEliteIntelligenceIndexSummary } = require('./elite-intelligence');
const { recordEarlyBuyerCandidates, scoreWalletDiscovery } = require('./wallet-discovery');
const { buildWalletTokenSignals } = require('./wallet-token-signals');
const { ensureLaunchCohort, observeLaunchCohort, resolveNoMarketCohorts } = require('./launch-cohort');
const { freshState, normalizeState, limitForecastHistory } = require('./state-normalizer');
const { TokenArchive } = require('./token-archive');
const { resolveHotTokenLimit, resolveArchiveScanBatch, resolveArchiveMaxTokens, DEGRADED_HOT_TOKEN_LIMIT } = require('./discovery-capacity');
const { resolveLiveTokenCandidates } = require('./live-token-candidates');
const { buildSelection, resolveAdaptiveSelectionThreshold } = require('./selection');
const { evaluateMomentumRisk } = require('./momentum-risk');
const { marketFieldFresh, freshMarketView } = require('./market-freshness');
const { stepPaperTrading } = require('./paper-trading');
const { hasVerifiedSwapInstruction } = require('./wallet-transaction-evidence');
const { extractPoolSwapEvents, summarizePoolSwapEvents, preserveRpcTradeEvidence } = require('./solana-pool-trades');
const { fetchJupiterPrices } = require('./jupiter-price');
const { amountForUsd, fetchJupiterSellQuote, DEFAULT_TEST_USD, MAX_SUPPLY_SHARE_BPS } = require('./jupiter-sellability');
const { updateSelectionCohorts } = require('./selection-cohort');
const { createTelegramPerformanceEntry, resolveTelegramPublicationBaseline, selectTelegramPerformanceMints, collectTelegramPerformanceUpdates, formatTelegramPerformanceMessage, markTelegramPerformanceRendered, extractMintFromAlertId, buildTelegramPreviewUrl, buildTelegramPreviewAnchor, telegramPerformancePreviewVersion, MAX_TRACKED: MAX_TELEGRAM_PERFORMANCE_TRACKED } = require('./telegram-performance');
const { selectFreshDiscoveryBatch, selectScoreFocusCandidates } = require('./discovery-rotation');
const { rankSecurityCandidates } = require('./security-priority');
const { assessExternalSecurity } = require('./external-security');
const { enqueueLaunchpadSignature, processPendingLaunchpadTransactions } = require('./launchpad-discovery');
const { LaunchpadLogStream } = require('./launchpad-log-stream');
const DEX = 'https://api.dexscreener.com';
// Eight sequential security inspections per scan keep RPC and memory use bounded.
// With the normal 60s scan cadence this is 480 first-pass checks per hour.
const SECURITY_REFRESH_INTERVAL_MS = 60_000;
const SECURITY_REFRESH_BATCH_SIZE = 8;
const TRADE_INTELLIGENCE_PRIORITY_WINDOW = 12;
const POOL_RPC_REFRESH_BATCH_SIZE = 10;
const POOL_RPC_MAX_TRANSACTIONS_PER_POOL = 16;
const SOCIAL_BACKGROUND_BUDGET_MS = 55_000;
const SOCIAL_REQUEST_RESERVE_MS = 8_000;
const WALLET_REFRESH_PER_WALLET_LIMIT = 8;
const WALLET_REFRESH_MAX_TRANSACTIONS_PER_CYCLE = 160;
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
const validMarketNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const clamp = v => Math.max(0, Math.min(100, n(v)));
const iso = () => new Date().toISOString();
function inspectionTimestamp(token, checkedAt) {
  const checked = Date.parse(checkedAt || '');
  if (Number.isFinite(checked)) return checked;
  const firstSeen = Date.parse(token?.firstSeenAt || token?.pumpCreatedAt || token?.geckoPoolCreatedAt || token?.launchCreatedAt || '');
  return Number.isFinite(firstSeen) ? firstSeen : 0;
}
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

const MEMORY_BUDGET = Object.freeze({ maxHeapMiB: 460, maxExternalMiB: 120, maxRssMiB: 800 });
function memoryBudget({maxHeapMiB=MEMORY_BUDGET.maxHeapMiB,maxExternalMiB=MEMORY_BUDGET.maxExternalMiB,maxRssMiB=MEMORY_BUDGET.maxRssMiB}={}) {
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
  constructor({ dataFile, bot, telegramChatId, telegramPreviewBaseUrl = '' }) {
    this.file = dataFile || path.join(__dirname, '..', 'data', 'store.json');
    this.hotTokenLimit = resolveHotTokenLimit(process.env.HOT_TOKEN_LIMIT);
    this.archiveScanBatch = resolveArchiveScanBatch(process.env.TOKEN_ARCHIVE_SCAN_BATCH);
    this.archiveWakeups = { total: 0, lastAt: null, bySource: {} };
    this.archive = new TokenArchive({ file: path.join(path.dirname(this.file), 'tokens.archive.sqlite'), maxTokens: resolveArchiveMaxTokens(process.env.TOKEN_ARCHIVE_MAX) });
    if (!this.archive.available) console.warn('[token archive] SQLite cold archive disabled:', this.archive.lastError || 'unsupported runtime');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const sourceVersion = raw && typeof raw === 'object' ? raw.version : undefined;
      this.state = normalizeState(raw, { mutate: true, maxTokens: this.archive.available ? this.hotTokenLimit : Infinity });
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
        this.state = normalizeState(backup, { mutate: true, maxTokens: this.archive.available ? this.hotTokenLimit : Infinity });
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
    this.telegramPreviewBaseUrl = String(telegramPreviewBaseUrl || '').replace(/\/+$/, '');
    // Telegram may fetch the Open Graph image before sendMessage resolves. Keep
    // the prepared preview available during that request/response race.
    this.telegramPreviewSeeds = new Map();
    this.state.telegramChannels=normalizeTelegramChannels(this.state.telegramChannels);
    if(!this.state.telegramChannelsConfigured&&!this.state.telegramChannels.length&&this.chat){this.state.telegramChannels=normalizeTelegramChannels([],this.chat);this.state.telegramChannelsConfigured=true;}
    this.running = false; this.scanning=false; this.timer = null; this.walletTimer = null; this.socialTimer = null; this.persistTimer = null; this.startupTimers=[]; this.scanRetryTimer=null; this.lastScanAttemptAt=null; this.lastScanSkipReason=null; this.backgroundTaskRunning=null; this.backgroundRetryTimers=new Map(); this.lastBackgroundSkipLogAt=0; this.lastSecurity = 0; this.lastSavedAt = null; this.lastPersistenceError = null;
    this.scoreContext=null; this.jupiterTaskTurn='price'; this.rpcEndpoints=buildRpcEndpoints(); this.rpcProviderIndex=0; this.autoWalletCursor=0; this.rpcProviderBackoff=new Map(); this.redditRadar = new RedditRadar(); this.blueskyRadar = new BlueskyRadar(); this.nostrRadar = new NostrRadar(); this.telegramRadar = new TelegramRadar(); this.xRadar = new XSocialRadar(); this.geckoTradeQueue = Promise.resolve(); this.lastGeckoTradeFetch = 0; this.poolTradeRpcQueue=Promise.resolve(); this.lastAutoCreatorFundingAt = 0; this.socialCursor=0; this.nostrCursor=0; this.telegramCursor=0; this.creatorCursor=0; this.lastAlertThreshold={threshold:n(process.env.ALERT_MIN_SCORE)||80,source:'configured',validated:false,holdoutTokens:0};
    this.launchStream = new LaunchStream({ onToken: event => this.ingestLaunch(event), onMigration: event => this.ingestMigration(event) });
    this.launchpadLogStream = new LaunchpadLogStream({ endpoints:this.rpcEndpoints, onSignature:event=>{const result=enqueueLaunchpadSignature(this.state,event);if(result.queued)this.scheduleSave();} });
  }
  save() {
    this.state.updatedAt = iso();
    const sortedTokens = Object.entries(this.state.tokens).sort((a,b) => String(b[1].updatedAt || '').localeCompare(String(a[1].updatedAt || '')));
    const hotTokens = this.archive.available ? sortedTokens.slice(0,this.hotTokenLimit) : sortedTokens;
    const coldTokens = this.archive.available ? sortedTokens.slice(this.hotTokenLimit).map(([,token]) => token) : [];
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
      launchpadDiscovery:{configured:true,...(src.launchpadDiscovery||{}),pending:Object.values(this.state.launchpadDiscovery?.pending||{}).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0),programsMonitored:2,mode:src.launchpadDiscovery?.mode||'Solana RPC logsSubscribe · LaunchLab + Meteora DBC'},
      poolTradeRpc:{configured:true,connected:src.poolTradeRpc?.ok===true,lastSuccess:src.poolTradeRpc?.ok?src.poolTradeRpc?.at||null:null,lastAttemptAt:src.poolTradeRpc?.at||null,error:src.poolTradeRpc?.error||null,lastPoolMint:src.poolTradeRpc?.pool||null,signaturesFetched:src.poolTradeRpc?.signaturesFetched||0,processed:src.poolTradeRpc?.processed||0,failed:src.poolTradeRpc?.failed||0,pending:src.poolTradeRpc?.pending||0,confirmedSwaps:src.poolTradeRpc?.confirmedSwaps||0,uniqueBuyers:src.poolTradeRpc?.uniqueBuyers||0,gapDetected:src.poolTradeRpc?.gapDetected===true,mode:'Helius-first RPC · 8 pools par scan · 12 transactions maximum par pool'},
      walletMonitoring:{configured:true,trackedManual:this.state.wallets.length,trackedAutomatic:(this.state.autoWallets||[]).length,trackedCreators:new Set(Object.values(this.state.tokens).filter(t=>t.creatorObservedAtLaunch===true&&t.creator).map(t=>t.creator)).size,cursors:Object.keys(this.state.walletLatestCursors||{}).length,pendingSignatures:Object.values(this.state.walletPendingSignatures||{}).reduce((sum,rows)=>sum+(rows||[]).length,0),monitoringGaps:Object.keys(this.state.walletMonitoringGaps||{}).length,latestActivity:Object.values(this.state.walletActivity||{}).reduce((latest,x)=>!latest||Date.parse(x.at||0)>Date.parse(latest)?x.at:latest,null),lastRefreshAt:src.walletMonitoring?.at||null,lastRefreshProcessed:src.walletMonitoring?.processed??null,lastRefreshPausedByMemory:src.walletMonitoring?.pausedByMemory===true},
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
      jupiterSellability:{configured:true,connected:src.jupiterSellability?.ok===true&&Number(src.jupiterSellability?.checked)>0,lastSuccess:Number(src.jupiterSellability?.checked)>0?src.jupiterSellability?.at||null:null,error:src.jupiterSellability?.error||null,status:src.jupiterSellability?.status||null,checked:src.jupiterSellability?.checked||0,routeAvailable:src.jupiterSellability?.routeAvailable??null,mode:src.jupiterSellability?.mode||'Swap API V2 /order · vérification de route en lecture seule'},
      redditRss:{configured:false,connected:false,retired:true,lastSuccess:null,error:null,mode:'Source RSS retirée par Reddit en novembre 2026; aucune requête n’est effectuée.'},
      bluesky:this.blueskyRadar.status(),
      nostr:this.nostrRadar.status(),
      telegramSocial:this.telegramRadar.status(),
      xSocial:this.xRadar.status(),
      scannerRuntime:{running:this.running,scanning:this.scanning===true,backgroundTask:this.backgroundTaskRunning||null,lastScanAttemptAt:this.lastScanAttemptAt,lastScanAt:this.state.lastScanAt||null,lastScanDurationMs:this.state.lastScanDurationMs||null,lastScanCompletedAt:this.state.lastScanCompletedAt||null,lastScanCompletedDurationMs:this.state.lastScanCompletedDurationMs||null,lastScanError:this.state.lastScanError||null,lastScanSkipReason:this.lastScanSkipReason||null,retryScheduled:Boolean(this.scanRetryTimer)},
      dexMarket:{...(src.dexMarket||{ok:false,attemptedBatches:0,succeededBatches:0,pairs:0,snapshots:0,error:'Aucun rafraîchissement marché enregistré'})},
      runtimeMemory:{current:memoryBudget(),scannerGuard:src.scannerMemory||null,archiveAvailable:this.archive.available,archiveError:this.archive.lastError||null,trackedTokens:Object.keys(this.state.tokens).length,newTokenDiscoveryPaused:!this.archive.available&&Object.keys(this.state.tokens).length>=DEGRADED_HOT_TOKEN_LIMIT,hotTokenLimit:this.hotTokenLimit,archiveScanBatch:this.archiveScanBatch,archiveWakeups:{...this.archiveWakeups,bySource:{...this.archiveWakeups.bySource}}},
      runtimeStorage:(()=>{const files={state:this.file,backup:this.file+'.bak',archive:this.archive.file,archiveWal:this.archive.file+'-wal',archiveShm:this.archive.file+'-shm'};const sizes={};let totalBytes=0;for(const [key,file] of Object.entries(files)){let bytes=0;try{bytes=fs.statSync(file).size;}catch{}sizes[key]=bytes;totalBytes+=bytes;}return {files:sizes,totalBytes,archiveAvailable:this.archive.available,trackedTokens:Object.keys(this.state.tokens).length};})(),
      telegram:{configured:Boolean(this.bot),connected:Boolean(this.bot&&typeof this.bot.isRunning==='function'&&this.bot.isRunning()),channels:this.state.telegramChannels.length,enabledChannels:this.state.telegramChannels.filter(x=>x.enabled).length,mode:'Diffusion Telegram multi-canaux · un seul scan partagé'}
    };
  }
  async start() {
    if (this.running) return; this.running = true;
    await this.scan().catch(e => console.error('[scan]', e.message));
    this.timer = setInterval(() => this.scan().catch(e => console.error('[scan]', e.message)), Math.max(30000,n(process.env.SCAN_INTERVAL_MS)||60000));
    // Do not pile social scraping and wallet RPC pagination onto the first scan.
    // Background jobs are serialized and skipped when the host is already near its configured RSS guard.
    // Offset background work from the 60s scan cadence; retries below handle busy scans and memory pressure.
    this.socialTimer = setInterval(() => this.runBackgroundTask('social',({deadlineAt}={})=>this.refreshSocialRadar({deadlineAt}),680).catch(e=>console.warn('[social radar]',e.message)),600000);
    this.walletTimer = setInterval(() => this.runBackgroundTask('wallets',()=>this.refreshWallets(),650).catch(e=>console.error('[wallets]',e.message)),1200000);
    this.startupTimers.push(setTimeout(()=>this.runBackgroundTask('social',({deadlineAt}={})=>this.refreshSocialRadar({deadlineAt}),740).catch(e=>console.warn('[social radar]',e.message)),180000));
    this.startupTimers.push(setTimeout(()=>this.runBackgroundTask('wallets',()=>this.refreshWallets(),700).catch(e=>console.error('[wallets]',e.message)),300000));
    this.launchStream.start();
    this.launchpadLogStream.start();
  }
  queueScanRetry(delayMs=5000,reason='scanner_busy') {
    if(!this.running||this.scanRetryTimer)return false;
    this.lastScanSkipReason=reason;
    this.scanRetryTimer=setTimeout(()=>{
      this.scanRetryTimer=null;
      this.scan().catch(error=>console.error('[scan retry]',String(error.message||error).slice(0,180)));
    },Math.max(1000,Math.min(60000,Number(delayMs)||5000)));
    if(this.scanRetryTimer&&typeof this.scanRetryTimer.unref==='function')this.scanRetryTimer.unref();
    return true;
  }
  queueBackgroundRetry(name,task,maxRssMiB=740,delayMs=15000) {
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
  async runBackgroundTask(name, task, maxRssMiB = 740) {
    if(!this.running)return {skipped:true,reason:'scanner_stopped'};
    if(this.scanning||this.backgroundTaskRunning){
      this.queueBackgroundRetry(name,task,maxRssMiB,15000);
      return {skipped:true,reason:'scanner_or_background_task_busy',retryScheduled:true};
    }
    const budget=memoryBudget({maxHeapMiB:460,maxExternalMiB:120,maxRssMiB});
    if(!budget.ok){
      if(Date.now()-this.lastBackgroundSkipLogAt>60000){this.lastBackgroundSkipLogAt=Date.now();console.warn('[memory guard] background task deferred',{name,...budget});}
      this.queueBackgroundRetry(name,task,maxRssMiB,60000);
      return {skipped:true,reason:'memory_budget',retryScheduled:true,...budget};
    }
    const pending=this.backgroundRetryTimers.get(name);
    if(pending){clearTimeout(pending);this.backgroundRetryTimers.delete(name);}
    this.backgroundTaskRunning=name;
    try{return await task({deadlineAt:name==='social'?Date.now()+SOCIAL_BACKGROUND_BUDGET_MS:null});}
    finally{
      this.backgroundTaskRunning=null;
      if(this.running)this.queueScanRetry(1500,'background_task_released');
    }
  }
  stop() { this.running=false; clearInterval(this.timer); clearInterval(this.walletTimer); clearInterval(this.socialTimer); if(this.scanRetryTimer){clearTimeout(this.scanRetryTimer);this.scanRetryTimer=null;} for(const timer of this.startupTimers)clearTimeout(timer);this.startupTimers=[];for(const timer of this.backgroundRetryTimers.values())clearTimeout(timer);this.backgroundRetryTimers.clear();this.launchStream.stop();this.launchpadLogStream.stop(); if(this.persistTimer){try{this.flushScheduledSave();}catch(error){console.error('[persistence shutdown]',error.message);}} }
  canTrackMint(mint) {
    if (!mint || this.state.tokens[mint]) return true;
    if (this.archive.available) return true;
    return Object.keys(this.state.tokens).length < DEGRADED_HOT_TOKEN_LIMIT;
  }
  restoreArchivedToken(mint, source = 'unknown') {
    if (this.state.tokens[mint]) return this.state.tokens[mint];
    const token = this.archive.available ? this.archive.get(mint) : null;
    if (!token) return null;
    const at = iso();
    const key = String(source || 'unknown').slice(0, 48);
    this.archiveWakeups.total++;
    this.archiveWakeups.lastAt = at;
    this.archiveWakeups.bySource[key] = (Number(this.archiveWakeups.bySource[key]) || 0) + 1;
    token.archiveWake = { at, source: key };
    return token;
  }
  upsert(item, source) {
    const mint = String(item.tokenAddress || item.mint || ''); if (!mint || !this.canTrackMint(mint)) return;
    const t = this.state.tokens[mint] || this.restoreArchivedToken(mint, source) || { mint, sources:[], smartMoney:{hits:0,wallets:[]} };
    if (!t.sources.includes(source)) t.sources.push(source);
    t.firstSeenAt=t.firstSeenAt||iso();
    ensureLaunchCohort(t,Date.parse(t.firstSeenAt)||Date.now());
    if (item.description) t.description = String(item.description).slice(0,1000);
    if (item.icon) t.imageUrl = item.icon;
    if (item.url) t.dexUrl = item.url;
    if (Array.isArray(item.links)) t.links = item.links.slice(0,15);
    if (item.name) t.name = item.name; if (item.symbol) t.symbol = item.symbol;
    if (item.traderPublicKey) t.creator = item.traderPublicKey;
    if(source==='community_takeover')t.communityTakeover={claimDate:item.claimDate||null,discoveredAt:iso(),url:item.url||null};
    t.boosted = t.boosted || source.includes('boost'); t.updatedAt=iso();
    for (const w of this.state.wallets) if ((this.state.walletActivity[w.address]?.mints||[]).includes(mint)) {
      if (!t.smartMoney.wallets.includes(w.address)) t.smartMoney.wallets.push(w.address);
      t.smartMoney.hits=t.smartMoney.wallets.length; t.smartMoney.lastSeenAt=this.state.walletActivity[w.address].at;
    }
    this.state.tokens[mint]=t;
  }
  ingestLaunch(event) {
    const mint=String(event.mint||event.tokenAddress||event.address||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!this.canTrackMint(mint))return;
    const t=this.state.tokens[mint]||this.restoreArchivedToken(mint,'pumpportal_new_token')||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
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
  ingestLaunchpad(event) {
    const mint=String(event?.mint||'');
    const creator=String(event?.creator||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(creator)||!this.canTrackMint(mint))return null;
    const t=this.state.tokens[mint]||this.restoreArchivedToken(mint,'launchpad_'+String(event.launchpadId||'unknown').slice(0,40))||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    if(!Array.isArray(t.sources))t.sources=[];
    const source='launchpad_'+String(event.launchpadId||'unknown').replace(/[^a-z0-9_-]/gi,'_').slice(0,48);
    if(!t.sources.includes(source))t.sources.push(source);
    t.name=String(event.name||t.name||'Token sans nom') .slice(0,120);
    t.symbol=String(event.symbol||t.symbol||'—').slice(0,24);
    t.creator=creator;
    t.creatorObservedAtLaunch=true;
    t.launchSource=String(event.launchpadName||'Launchpad Solana').slice(0,80);
    t.launchpadId=String(event.launchpadId||'unknown').slice(0,60);
    t.launchObservedAtLaunch=true;
    t.launchSignature=String(event.signature||'').slice(0,100);
    t.launchSlot=Number.isFinite(Number(event.slot))?Number(event.slot):null;
    t.launchObservedAt=iso();
    t.launchCreatedAt=event.blockTime||t.launchCreatedAt||null;
    t.firstSeenAt=t.firstSeenAt||t.launchCreatedAt||iso();
    const created=Date.parse(t.launchCreatedAt||'');
    if(Number.isFinite(created)){t.launchAgeHours=Math.max(0,(Date.now()-created)/3600000);t.ageHours=t.launchAgeHours;}
    t.launchObservedVia='launchpad_program';
    ensureLaunchCohort(t,Date.parse(t.firstSeenAt)||Date.now());
    if(t.launchCohort)t.launchCohort.source=t.launchSource;
    t.launchData={...(t.launchData||{}),launchpadId:t.launchpadId,launchpadName:t.launchSource,programId:event.programId||null,config:event.config||null,signature:t.launchSignature,slot:t.launchSlot,observedAt:t.launchObservedAt};
    t.updatedAt=iso();
    this.state.tokens[mint]=t;
    this.scheduleSave();
    return t;
  }
  ingestMigration(event) {
    const mint=String(event.mint||event.tokenAddress||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!this.canTrackMint(mint))return;
    const t=this.state.tokens[mint]||this.restoreArchivedToken(mint)||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    if(!t.sources.includes('pumpportal_migration'))t.sources.push('pumpportal_migration');
    t.launchSource=t.launchSource||'Pump.fun';if(t.launchCohort)t.launchCohort.source='Pump.fun';t.firstSeenAt=t.firstSeenAt||iso();t.launchObservedVia=t.launchObservedVia==='creation_event'?'creation_and_migration':(t.launchObservedVia||'migration_only');
    t.migratedAt=iso();ensureLaunchCohort(t,Date.parse(t.firstSeenAt||t.migratedAt)||Date.now());t.migrated=true;t.migrationPool=String(event.pool||event.poolAddress||'').slice(0,100);
    t.updatedAt=iso();this.state.tokens[mint]=t;this.scheduleSave();
  }
  ingestGeckoPool(pool) {
    const mint=String(pool?.tokenAddress||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!this.canTrackMint(mint))return;
    const t=this.state.tokens[mint]||this.restoreArchivedToken(mint)||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    const discoverySource=String(pool.source||'geckoterminal_new_pool');if(!t.sources.includes(discoverySource))t.sources.push(discoverySource);
    t.name=pool.name||t.name||'Token sans nom';t.symbol=pool.symbol||t.symbol||'—';t.firstSeenAt=t.firstSeenAt||iso();
    t.geckoPoolAddress=pool.poolAddress||t.geckoPoolAddress;t.geckoDexName=pool.dexName||t.geckoDexName;
    t.geckoPoolCreatedAt=pool.poolCreatedAt||t.geckoPoolCreatedAt;
    ensureLaunchCohort(t,Date.parse(t.firstSeenAt||t.geckoPoolCreatedAt||'')||Date.now());
    t.geckoUrl=t.geckoPoolAddress?'https://www.geckoterminal.com/solana/pools/'+encodeURIComponent(t.geckoPoolAddress):t.geckoUrl;
    const validMarketNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
    if(validMarketNumber(pool.liquidityUsd)&&Number(pool.liquidityUsd)>=0)t.liquidityUsd=Number(pool.liquidityUsd);
    if(validMarketNumber(pool.priceUsd)&&Number(pool.priceUsd)>0)t.priceUsd=Number(pool.priceUsd);
    // GeckoTerminal may return partial market payloads on alternating refreshes.
    // Never let null/undefined/empty values erase previously observed market metrics.
    const mergeMarketNumbers=(previous,next)=>({
      ...(previous&&typeof previous==='object'?previous:{}),
      ...Object.fromEntries(Object.entries(next&&typeof next==='object'?next:{} )
        .filter(([,value])=>validMarketNumber(value))
        .map(([key,value])=>[key,Number(value)]))
    });
    if(validMarketNumber(pool.fdv)&&Number(pool.fdv)>0)t.fdv=Number(pool.fdv);
    if(validMarketNumber(pool.marketCap)&&Number(pool.marketCap)>0)t.marketCap=Number(pool.marketCap);
    t.marketFieldsObservedAt={...(t.marketFieldsObservedAt||{})};
    const geckoFieldAt=new Date().toISOString(),geckoVolumeFresh=mergeMarketNumbers({},pool.volume),geckoTxnsFresh={},geckoPriceChangeFresh=mergeMarketNumbers({},pool.priceChange);
    for(const [period,values] of Object.entries(pool.txns||{}))if(values&&typeof values==='object'&&!Array.isArray(values))geckoTxnsFresh[period]=mergeMarketNumbers({},values);
    const geckoHasCompleteTxns=period=>Number.isFinite(geckoTxnsFresh[period]?.buys)&&Number.isFinite(geckoTxnsFresh[period]?.sells);
    if(Object.keys(geckoVolumeFresh).length)t.marketFieldsObservedAt.volume=geckoFieldAt;
    if(Object.prototype.hasOwnProperty.call(geckoVolumeFresh,'m5'))t.marketFieldsObservedAt.volumeM5=geckoFieldAt;
    if(Object.prototype.hasOwnProperty.call(geckoVolumeFresh,'h1'))t.marketFieldsObservedAt.volumeH1=geckoFieldAt;
    if(Object.prototype.hasOwnProperty.call(geckoVolumeFresh,'h24'))t.marketFieldsObservedAt.volumeH24=geckoFieldAt;
    const hasGeckoTxnsFresh=Object.values(geckoTxnsFresh).some(row=>Object.keys(row).length>0);
    if(hasGeckoTxnsFresh)t.marketFieldsObservedAt.txns=geckoFieldAt;
    if(geckoHasCompleteTxns('m5'))t.marketFieldsObservedAt.txnsM5=geckoFieldAt;
    if(geckoHasCompleteTxns('h1'))t.marketFieldsObservedAt.txnsH1=geckoFieldAt;
    if(geckoHasCompleteTxns('h24'))t.marketFieldsObservedAt.txnsH24=geckoFieldAt;
    if(Object.keys(geckoPriceChangeFresh).length)t.marketFieldsObservedAt.priceChange=geckoFieldAt;
    if(Object.prototype.hasOwnProperty.call(geckoPriceChangeFresh,'m5'))t.marketFieldsObservedAt.priceChangeM5=geckoFieldAt;
    if(Object.prototype.hasOwnProperty.call(geckoPriceChangeFresh,'h1'))t.marketFieldsObservedAt.priceChangeH1=geckoFieldAt;
    if(Object.prototype.hasOwnProperty.call(geckoPriceChangeFresh,'h24'))t.marketFieldsObservedAt.priceChangeH24=geckoFieldAt;
    if(validMarketNumber(pool.priceUsd)&&Number(pool.priceUsd)>0)t.marketFieldsObservedAt.priceUsd=geckoFieldAt;
    if(validMarketNumber(pool.liquidityUsd)&&Number(pool.liquidityUsd)>=0)t.marketFieldsObservedAt.liquidityUsd=geckoFieldAt;
    t.volume=mergeMarketNumbers(t.volume,pool.volume);
    if(pool.txns&&typeof pool.txns==='object'){
      const mergedTxns={...(t.txns||{})};
      for(const [period,values] of Object.entries(pool.txns)){
        if(!values||typeof values!=='object'||Array.isArray(values))continue;
        mergedTxns[period]=mergeMarketNumbers(mergedTxns[period],values);
      }
      t.txns=mergedTxns;
    }
    t.priceChange=mergeMarketNumbers(t.priceChange,pool.priceChange);
    if(pool.poolCreatedAt&&!t.pairCreatedAt){const time=Date.parse(pool.poolCreatedAt);if(Number.isFinite(time))t.pairCreatedAt=time;}
    if(validMarketNumber(pool.ageHours)&&Number(pool.ageHours)>=0)t.ageHours=Number(pool.ageHours);
    const observedAt=Date.now();
    const geckoHasFreshMarket=validMarketNumber(pool.priceUsd)&&Number(pool.priceUsd)>0&&validMarketNumber(pool.liquidityUsd)&&Number(pool.liquidityUsd)>=0;
    if(geckoHasFreshMarket){
      t.history=Array.isArray(t.history)?t.history:[];
      const currentAnalysis=this.score(t);
      const snap={at:observedAt,source:'geckoterminal',priceUsd:Number(pool.priceUsd),liquidityUsd:Number(pool.liquidityUsd),volume1h:validMarketNumber(pool.volume?.h1)?Number(pool.volume.h1):null,volume24h:validMarketNumber(pool.volume?.h24)?Number(pool.volume.h24):null,buys1h:validMarketNumber(pool.txns?.h1?.buys)?Number(pool.txns.h1.buys):null,sells1h:validMarketNumber(pool.txns?.h1?.sells)?Number(pool.txns.h1.sells):null,fieldObservedAt:{volume:Object.keys(geckoVolumeFresh).length?geckoFieldAt:null,volumeM5:Object.prototype.hasOwnProperty.call(geckoVolumeFresh,'m5')?geckoFieldAt:null,volumeH1:Object.prototype.hasOwnProperty.call(geckoVolumeFresh,'h1')?geckoFieldAt:null,volumeH24:Object.prototype.hasOwnProperty.call(geckoVolumeFresh,'h24')?geckoFieldAt:null,txns:hasGeckoTxnsFresh?geckoFieldAt:null,txnsM5:geckoHasCompleteTxns('m5')?geckoFieldAt:null,txnsH1:geckoHasCompleteTxns('h1')?geckoFieldAt:null,txnsH24:geckoHasCompleteTxns('h24')?geckoFieldAt:null,priceChangeM5:Object.prototype.hasOwnProperty.call(geckoPriceChangeFresh,'m5')?geckoFieldAt:null,priceChangeH1:Object.prototype.hasOwnProperty.call(geckoPriceChangeFresh,'h1')?geckoFieldAt:null,priceChangeH24:Object.prototype.hasOwnProperty.call(geckoPriceChangeFresh,'h24')?geckoFieldAt:null,priceUsd:geckoFieldAt,liquidityUsd:geckoFieldAt},fdv:validMarketNumber(pool.fdv)?Number(pool.fdv):null,score:currentAnalysis.score,coverage:currentAnalysis.coverage,classification:currentAnalysis.classification,criteriaVersion:currentAnalysis.criteriaVersion,legacyScore:currentAnalysis.legacyScore,launchPhase:currentAnalysis.launchPhase,risk:currentAnalysis.risk,flags:currentAnalysis.flags||[],factors:currentAnalysis.factors||{}};
      const last=t.history[t.history.length-1];
      if(!last||observedAt-(typeof last.at==='number'?last.at:Date.parse(last.at))>=45000){t.history.push(snap);t.history=t.history.slice(-100);this.recordForecast(t,snap);}
      t.marketObservedAt=new Date(observedAt).toISOString();t.marketObservationSource='geckoterminal';
      observeLaunchCohort(t,snap);
    }
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
  async inspectPoolRpcTradeIntel(t,{persist=false,maxTransactions=4}={}) {
    const poolAddressSource=t?.pairAddress?'dexscreener_pair':'geckoterminal_pool';
    const poolAddress=String(t?.pairAddress||t?.geckoPoolAddress||'');
    if(!t?.mint||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(poolAddress))return null;
    const prior=t.poolRpcTradeState&&typeof t.poolRpcTradeState==='object'?t.poolRpcTradeState:{};
    const previousPoolAddress=String(prior.poolAddress||t?.geckoPoolAddress||t?.pairAddress||'');
    const hasPriorEvidence=Boolean(prior.poolAddress||prior.lastAttemptAt||prior.checkedAt||prior.cursorSignature||prior.pending?.length||prior.processedSignatures?.length);
    const poolAddressChanged=hasPriorEvidence&&previousPoolAddress!==poolAddress;
    const workingPrior=poolAddressChanged?{...prior,previousPoolAddress,poolAddress,poolAddressSource,pending:[],processedSignatures:[],cursorSignature:null,catchupBeforeSignature:null,catchupHeadSignature:null,gapDetected:false,poolAddressChangedAt:iso()}: {...prior,poolAddress,poolAddressSource};
    const now=Date.now(),lastAttempt=Date.parse(prior.lastAttemptAt||'');
    if(!poolAddressChanged&&Number.isFinite(lastAttempt)&&now-lastAttempt<45000)return t.poolRpcTradeIntel||prior;
    if(poolAddressChanged){
      t.rpcTradeEvents=[];
      t.poolRpcTradeIntel=null;
      if(t.tradeIntel){const clean={...t.tradeIntel};for(const key of Object.keys(clean))if(key.startsWith('rpcConfirmed'))delete clean[key];t.tradeIntel=clean;}
    }
    const run=async()=>{
      const state={...workingPrior,lastAttemptAt:iso(),pending:Array.isArray(workingPrior.pending)?workingPrior.pending.slice(-300):[],processedSignatures:Array.isArray(workingPrior.processedSignatures)?workingPrior.processedSignatures.slice(-200):[],gapDetected:workingPrior.gapDetected===true,gapCount:Number(workingPrior.gapCount)||0};
      try{
        let rows=[];
        // Finish the current page before fetching another one. Fetching at <40
        // while processing only 12 per visit caused the queue to grow by ~38
        // signatures on every refill and prevented catch-up from completing.
        if(state.pending.length===0){
          const catchingUp=Boolean(state.catchupBeforeSignature);
          const before=catchingUp?state.catchupBeforeSignature:null;
          const signatures=await this.rpc('getSignaturesForAddress',[poolAddress,{limit:50,commitment:'confirmed',...(before?{before}: {})}]);
          rows=Array.isArray(signatures)?signatures.filter(row=>row?.signature):[];
          const cursor=state.cursorSignature||null;
          let unseen=[];
          if(catchingUp){
            const anchor=cursor?rows.findIndex(row=>row.signature===cursor):-1;
            if(anchor>=0){
              unseen=rows.slice(0,anchor);
              state.cursorSignature=state.catchupHeadSignature||state.cursorSignature;
              state.catchupBeforeSignature=null;
              state.catchupHeadSignature=null;
              state.gapDetected=false;
            }else if(rows.length){
              unseen=rows;
              state.catchupBeforeSignature=rows[rows.length-1].signature;
              if(rows.length<50){
                state.cursorSignature=state.catchupHeadSignature||rows[0].signature;
                state.catchupBeforeSignature=null;
                state.catchupHeadSignature=null;
                state.gapDetected=false;
              }
            }else{
              state.cursorSignature=state.catchupHeadSignature||state.cursorSignature;
              state.catchupBeforeSignature=null;
              state.catchupHeadSignature=null;
              state.gapDetected=false;
            }
          }else if(cursor){
            const anchor=rows.findIndex(row=>row.signature===cursor);
            if(anchor>=0){
              unseen=rows.slice(0,anchor);
              if(rows.length)state.cursorSignature=rows[0].signature;
            }else if(rows.length){
              state.gapDetected=true;
              state.gapCount++;
              state.catchupHeadSignature=rows[0].signature;
              state.catchupBeforeSignature=rows[rows.length-1].signature;
              unseen=rows;
            }
          }else{
            unseen=rows.slice(0,10);
            if(rows.length)state.cursorSignature=rows[0].signature;
          }
          const queued=new Set(state.pending.map(row=>row.signature)),done=new Set(state.processedSignatures);
          const additions=unseen.slice().reverse()
            .filter(row=>!queued.has(row.signature)&&!done.has(row.signature))
            .map(row=>({signature:row.signature,slot:row.slot??null,blockTime:row.blockTime??null,err:row.err||null,attempts:0}));
          if(additions.length)state.pending.unshift(...additions);
          if(state.pending.length>300){
            state.gapDetected=true;
            state.pending.splice(300);
          }
        }
        const geckoBySignature=new Map((t.tradeIntel?.observedTrades||[]).filter(row=>row.signature).map(row=>[row.signature,row]));
        const events=Array.isArray(t.rpcTradeEvents)?t.rpcTradeEvents.slice(-200):[];
        let processed=0,failed=0;const limit=Math.max(1,Math.min(16,Number(maxTransactions)||4));
        while(state.pending.length&&processed<limit){
          const item=state.pending[0];
          if(item.err){state.pending.shift();state.processedSignatures.push(item.signature);processed++;continue;}
          let tx;
          try{tx=await this.rpc('getTransaction',[item.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);}
          catch(error){item.attempts=(Number(item.attempts)||0)+1;item.lastError=String(error.message||error).slice(0,120);if(item.attempts>=3){state.pending.shift();state.processedSignatures.push(item.signature);failed++;processed++;}else break;continue;}
          if(!tx?.meta){item.attempts=(Number(item.attempts)||0)+1;if(item.attempts>=3){state.pending.shift();state.processedSignatures.push(item.signature);failed++;processed++;}else break;continue;}
          const gecko=geckoBySignature.get(item.signature);
          const extracted=extractPoolSwapEvents(tx,t.mint,{signature:item.signature,slot:item.slot??tx.slot,blockTime:item.blockTime??tx.blockTime,volumeUsd:gecko?.volumeUsd,volumeSource:gecko?'geckoterminal_trade_sample':null});
          for(const event of extracted){const key=[event.signature,event.wallet,event.mint].join('|');if(!events.some(row=>[row.signature,row.wallet,row.mint].join('|')===key))events.push(event);}
          state.pending.shift();state.processedSignatures.push(item.signature);processed++;
        }
        state.processedSignatures=state.processedSignatures.slice(-200);state.pending=state.pending.slice(-300);
        state.checkedAt=iso();state.processedLastBatch=processed;state.failedLastBatch=failed;state.error=null;
        t.rpcTradeEvents=events.slice(-200);
        t.poolRpcTradeIntel={...summarizePoolSwapEvents(t.rpcTradeEvents,state.checkedAt),poolAddress,poolAddressSource,poolAddressChanged:poolAddressChanged||false,lastAttemptAt:state.lastAttemptAt,cursorSignature:state.cursorSignature,pendingCount:state.pending.length,processedSignatures:state.processedSignatures.length,gapDetected:state.gapDetected,gapCount:state.gapCount,processedLastBatch:processed,failedLastBatch:failed};
        t.tradeIntel={...(t.tradeIntel||{}),rpcConfirmedTradeCount:t.poolRpcTradeIntel.tradeCount,rpcConfirmedBuys:t.poolRpcTradeIntel.buys,rpcConfirmedSells:t.poolRpcTradeIntel.sells,rpcConfirmedUniqueBuyers:t.poolRpcTradeIntel.uniqueBuyers,rpcConfirmedUniqueSellers:t.poolRpcTradeIntel.uniqueSellers,rpcConfirmedBuyVolumeUsd:t.poolRpcTradeIntel.buyVolumeUsd,rpcConfirmedSellVolumeUsd:t.poolRpcTradeIntel.sellVolumeUsd,rpcConfirmedVolumeCoverage:t.poolRpcTradeIntel.volumeCoverage,rpcConfirmedTop5BuyerSharePct:t.poolRpcTradeIntel.top5BuyerSharePct,rpcConfirmedCheckedAt:state.checkedAt,rpcConfirmedLastTradeAt:t.poolRpcTradeIntel.lastTradeAt,rpcConfirmedSource:'Helius/RPC pool signatures'};
        t.analysis=this.score(t);
        this.state.sources.poolTradeRpc={ok:true,at:state.checkedAt,pool:t.mint,poolAddressSource,provider:this.state.sources.solanaRpc?.endpoint||null,signaturesFetched:rows.length,processed,failed,pending:state.pending.length,confirmedSwaps:t.poolRpcTradeIntel.tradeCount,uniqueBuyers:t.poolRpcTradeIntel.uniqueBuyers,gapDetected:state.gapDetected};
        if(persist)this.save();
      }catch(error){
        state.error=String(error.message||error).slice(0,180);state.checkedAt=iso();
        t.poolRpcTradeIntel={...(t.poolRpcTradeIntel||{}),lastAttemptAt:state.lastAttemptAt,checkedAt:state.checkedAt,error:state.error};
        this.state.sources.poolTradeRpc={ok:false,at:state.checkedAt,error:state.error,pool:t.mint};
        if(persist)this.save();
      }
      t.poolRpcTradeState=state;return t.poolRpcTradeIntel;
    };
    const pending=this.poolTradeRpcQueue.then(run,run);this.poolTradeRpcQueue=pending.catch(()=>null);return pending;
  }
  async inspectTradeIntel(t,{persist=true}={}) {
    if(!t?.geckoPoolAddress)return null;
    if(t.tradeIntel?.checkedAt&&Date.now()-Date.parse(t.tradeIntel.checkedAt)<300000)return t.tradeIntel;
    const run=async()=>{
      const delay=Math.max(0,30000-(Date.now()-this.lastGeckoTradeFetch));
      if(delay)await wait(delay);
      this.lastGeckoTradeFetch=Date.now();
      const payload=await fetchPoolTrades(t.geckoPoolAddress);
      t.tradeIntel=preserveRpcTradeEvidence(analyzePoolTrades(payload,t.geckoPoolCreatedAt),t.tradeIntel);
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
    const budget=memoryBudget({maxHeapMiB:440,maxExternalMiB:112,maxRssMiB:760});
    if(!budget.ok){console.warn('[memory guard] candidate intelligence deferred',budget);return;}
    const now=Date.now();
    const tradeCandidates=Object.values(this.state.tokens)
      .filter(t=>t.geckoPoolAddress&&(!t.tradeIntel?.checkedAt||now-Date.parse(t.tradeIntel.checkedAt)>300000))
      .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd)||inspectionTimestamp(a,a.tradeIntel?.checkedAt)-inspectionTimestamp(b,b.tradeIntel?.checkedAt))
      .slice(0,TRADE_INTELLIGENCE_PRIORITY_WINDOW)
      .sort((a,b)=>inspectionTimestamp(a,a.tradeIntel?.checkedAt)-inspectionTimestamp(b,b.tradeIntel?.checkedAt)||Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd));
    if(tradeCandidates.length)await this.inspectTradeIntel(tradeCandidates[0],{persist:false});
    const rpcFloor=Math.max(55,(Number(this.state.scannerSettings?.minScore)||80)-20);
    const poolRpcCandidates=Object.values(this.state.tokens)
      .filter(t=>(t.geckoPoolAddress||t.pairAddress)&&Number(t.analysis?.score)>=rpcFloor&&!t.analysis?.hardBlocked&&t.analysis?.risk!=='high')
      .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd))
      .slice(0,30)
      .sort((a,b)=>((Array.isArray(b.poolRpcTradeState?.pending)?b.poolRpcTradeState.pending.length:0)-(Array.isArray(a.poolRpcTradeState?.pending)?a.poolRpcTradeState.pending.length:0))||inspectionTimestamp(a,a.poolRpcTradeState?.lastAttemptAt)-inspectionTimestamp(b,b.poolRpcTradeState?.lastAttemptAt)||Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd));
    for(const candidate of poolRpcCandidates.slice(0,POOL_RPC_REFRESH_BATCH_SIZE))await this.inspectPoolRpcTradeIntel(candidate,{persist:false,maxTransactions:POOL_RPC_MAX_TRANSACTIONS_PER_POOL});
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
  ingestSocialCandidate(mint, post) {
    mint=String(mint||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!this.canTrackMint(mint))return null;
    const t=this.state.tokens[mint]||this.restoreArchivedToken(mint)||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    if(!Array.isArray(t.sources))t.sources=[];
    if(!t.sources.includes('social_x'))t.sources.push('social_x');
    const publishedAt=post?.publishedAt||iso();
    const discovery=t.socialDiscovery||(t.socialDiscovery={firstSeenAt:publishedAt,lastSeenAt:publishedAt,mentions:0,authors:[],posts:[]});
    if(!Array.isArray(discovery.posts))discovery.posts=[];
    if(!Array.isArray(discovery.authors))discovery.authors=[];
    const postId=String(post?.id||post?.link||'').slice(0,100);
    if(!postId||!discovery.posts.some(row=>row.id===postId)){
      discovery.mentions=(Number(discovery.mentions)||0)+1;
      discovery.posts.push({id:postId||String(discovery.mentions),text:String(post?.text||'').slice(0,700),link:post?.link||null,publishedAt,author:String(post?.author||'').slice(0,64),likes:Number(post?.likes)||0,reposts:Number(post?.reposts)||0});
      discovery.posts=discovery.posts.slice(-12);
    }
    discovery.lastSeenAt=publishedAt;
    if(post?.author&&!discovery.authors.includes(post.author))discovery.authors=[...discovery.authors,String(post.author).slice(0,64)].slice(-30);
    t.firstSeenAt=t.firstSeenAt||publishedAt;t.updatedAt=iso();this.state.tokens[mint]=t;this.scheduleSave();
    return t;
  }
  mergeSocialIntel(token) {
    const bluesky=token.blueskyIntel;
    const nostr=token.nostrIntel;
    const telegram=token.telegramIntel;
    const x=token.xIntel;
    const sources=[bluesky?.available?bluesky:null,nostr?.available?nostr:null,telegram?.available?telegram:null,x?.available?x:null].filter(Boolean);
    const rawPosts=sources.flatMap(source=>source.posts||[]).sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)).slice(0,40);
    const evidence=analyzeSocialEvidence(rawPosts,token);
    const posts=rawPosts.slice(0,10);
    // Only token-matched, sampled and non-promotional posts count as community mentions.
    // Provider aggregates cannot be audited or reliably separated from Telegram calls.
    const mentions1h=evidence.nonPromotionalMentions1h;
    const mentions24h=evidence.nonPromotionalMentions24h;
    const sentimentRows=sources.filter(x=>x!==telegram&&x.sentimentScore!==null&&x.sentimentScore!==undefined);
    const sentimentScore=sentimentRows.length?Math.round(sentimentRows.reduce((sum,x)=>sum+Number(x.sentimentScore),0)/sentimentRows.length):null;
    const uniqueChannels24h=evidence.uniqueChannels24h;
    const uniqueSources24h=evidence.uniqueSources24h;
    const checkedAt=sources.map(source=>source.checkedAt).filter(value=>Number.isFinite(Date.parse(value||''))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
    return {available:sources.length>0,checkedAt,mentions1h,mentions24h,uniqueAuthors24h:evidence.uniqueAuthors24h,uniqueChannels24h,uniqueSources24h,socialVelocityPerHour:mentions1h,sentimentScore,duplicateTexts:evidence.duplicateTexts,evidence,posts,providers:sources.map(x=>x.provider||x.source||'Source publique'),bluesky:bluesky||null,nostr:nostr||null,telegram:telegram||null,x:x||null};
  }
  async refreshSocialRadar({deadlineAt=Date.now()+SOCIAL_BACKGROUND_BUDGET_MS}={}) {
    // Reddit RSS support was retired in November 2026. Do not issue three
    // parallel 512 KiB requests on a 256 MiB host for a source that no longer works.
    const redditResult={skipped:true,reason:'Reddit RSS retiré; collecte désactivée pour protéger la mémoire.'};
    this.state.sources.redditRss={ok:false,error:'Flux RSS Reddit retirés; collecte désactivée.'};
    const safeBudget=()=>memoryBudget({maxHeapMiB:440,maxExternalMiB:112,maxRssMiB:740});
    const socialBatchSize=Math.max(1,Math.min(5,Math.floor(Number(process.env.SOCIAL_TOKEN_BATCH)||4)));
    const telegramBatchSize=Math.max(1,Math.min(3,Math.floor(Number(process.env.TELEGRAM_TOKEN_BATCH)||2)));
    let telegramDiscovery=null;
    let deadlineReached=false;
    const canStartSocialRequest=minimumRemainingMs=>Date.now()+Math.max(SOCIAL_REQUEST_RESERVE_MS,Number(minimumRemainingMs)||0)<deadlineAt;
    let xResult={available:false,configured:false,posts:[],mentions1h:0,mentions24h:0,uniqueAuthors24h:0};
    if(canStartSocialRequest(16000))try {
      xResult=await this.xRadar.search();
      this.state.sources.xSocial={ok:xResult.available===true,at:xResult.checkedAt||iso(),error:xResult.error||null,posts:xResult.posts?.length||0,mentions1h:xResult.mentions1h||0,uniqueAuthors24h:xResult.uniqueAuthors24h||0};
      if(xResult.available){
        for(const post of xResult.posts||[]){
          for(const mint of extractSolanaMints(post.text))this.ingestSocialCandidate(mint,post);
          for(const token of Object.values(this.state.tokens)){
            if(classifyTokenMention(post.text,token)==='none')continue;
            const intel=token.xIntel||(token.xIntel={available:true,provider:xResult.provider,checkedAt:xResult.checkedAt,posts:[],mentions1h:0,mentions24h:0,uniqueAuthors24h:0,sentimentScore:null});
            if(!intel.posts.some(row=>row.id===post.id))intel.posts=[...intel.posts,post].slice(-12);
            intel.checkedAt=xResult.checkedAt;intel.mentions24h=intel.posts.length;intel.mentions1h=intel.posts.filter(row=>Date.now()-Date.parse(row.publishedAt)<=3600000).length;
            intel.uniqueAuthors24h=new Set(intel.posts.map(row=>row.author).filter(Boolean)).size;
          }
        }
      }
    } catch(error) {
      this.state.sources.xSocial={ok:false,at:iso(),error:String(error.message||error).slice(0,160)};
    } else deadlineReached=true;
    let budget=safeBudget();
    if(!budget.ok){console.warn('[memory guard] social discovery stopped',budget);return {partial:true,reason:'memory_budget',reddit:redditResult,telegramDiscovery,...budget};}
    const candidates=Object.values(this.state.tokens)
      .filter(t=>t.mint&&/^[a-z0-9]{3,15}$/i.test(String(t.symbol||''))&&(!t.blueskyIntel?.checkedAt||Date.now()-Date.parse(t.blueskyIntel.checkedAt)>1800000))
      .sort((a,b)=>(Date.parse(a.blueskyIntel?.checkedAt||'')||0)-(Date.parse(b.blueskyIntel?.checkedAt||'')||0)||Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd));
    const selected=candidates.slice(0,socialBatchSize);
    for(const token of selected) {
      if(!canStartSocialRequest(35000)){deadlineReached=true;break;}
      token.blueskyIntel=await this.blueskyRadar.searchToken(token);
      this.state.sources.bluesky={ok:token.blueskyIntel.available,at:token.blueskyIntel.checkedAt,error:token.blueskyIntel.error||null};
      budget=safeBudget();
      if(!budget.ok){console.warn('[memory guard] social search stopped after Bluesky',budget);return {partial:true,reason:'memory_budget',reddit:redditResult,telegramDiscovery,blueskyTokensChecked:selected.length,...budget};}
    }
    const nostrCandidates=Object.values(this.state.tokens)
      .filter(t=>t.mint&&/^[a-z0-9]{3,15}$/i.test(String(t.symbol||''))&&(!t.nostrIntel?.checkedAt||Date.now()-Date.parse(t.nostrIntel.checkedAt)>1800000))
      .sort((a,b)=>(Date.parse(a.nostrIntel?.checkedAt||'')||0)-(Date.parse(b.nostrIntel?.checkedAt||'')||0)||Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd));
    if(nostrCandidates.length){
      const nostrSelected=nostrCandidates.slice(0,socialBatchSize);
      for(const candidate of nostrSelected){
        if(!canStartSocialRequest(8000)){deadlineReached=true;break;}
        candidate.nostrIntel=await this.nostrRadar.searchToken(candidate);
        this.state.sources.nostr={ok:candidate.nostrIntel.available,at:candidate.nostrIntel.checkedAt||iso(),error:candidate.nostrIntel.error||null};
        budget=safeBudget();
        if(!budget.ok){console.warn('[memory guard] social search stopped after Nostr',budget);return {partial:true,reason:'memory_budget',reddit:redditResult,telegramDiscovery,blueskyTokensChecked:selected.length,nostrTokensChecked:nostrSelected.length,...budget};}
      }
    }
    const telegramCandidates=Object.values(this.state.tokens)
      .filter(t=>t.mint&&(!t.telegramDirectCheckedAt||Date.now()-Date.parse(t.telegramDirectCheckedAt)>900000))
      .filter(t=>[...(Array.isArray(t.socials)?t.socials:[]),...(Array.isArray(t.links)?t.links:[])].some(x=>{const url=String(x?.url||x?.link||x?.href||'').toLowerCase();return url.includes('t.me/')||url.includes('telegram.me/');})||String(t.description||'').toLowerCase().includes('t.me/')||String(t.description||'').toLowerCase().includes('telegram.me/'))
      .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||n(b.liquidityUsd)-n(a.liquidityUsd));
    const telegramOrdered=telegramCandidates.length?Array.from({length:telegramCandidates.length},(_,i)=>telegramCandidates[(this.telegramCursor+i)%telegramCandidates.length]):[];
    const telegramSelected=telegramOrdered.slice(0,telegramBatchSize);
    if(telegramCandidates.length)this.telegramCursor=(this.telegramCursor+telegramSelected.length)%telegramCandidates.length;
    for(const token of telegramSelected){
      if(!canStartSocialRequest(31000)){deadlineReached=true;break;}
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
    if(!telegramDiscovery&&canStartSocialRequest(11000)){
      try{
        telegramDiscovery=await this.telegramRadar.discoverPublicChannels({limit:1});
        for(const token of Object.values(this.state.tokens)){
          const discovered=this.telegramRadar.matchDiscoveredToken(token);
          if(discovered.available)token.telegramIntel=discovered;
        }
        const telegramStatus=this.telegramRadar.status();
        this.state.sources.telegramSocial={ok:telegramStatus.connected,at:telegramStatus.lastSuccess||iso(),error:telegramStatus.lastError||null,channelsScanned:telegramStatus.discovery?.visitedChannels||0,postsRetained:telegramStatus.discovery?.postsRetained||0};
      }catch(error){this.state.sources.telegramSocial={ok:false,error:String(error.message||error).slice(0,180)};}
    }else if(!telegramDiscovery)deadlineReached=true;
    for(const token of Object.values(this.state.tokens))token.socialIntel=this.mergeSocialIntel(token);
    budget=safeBudget();
    if(!budget.ok){console.warn('[memory guard] social scoring and persistence deferred',budget);return {partial:true,reason:'memory_budget_before_score_save',reddit:redditResult,telegramDiscovery,blueskyTokensChecked:selected.length,...budget};}
    this.scoreAll();this.save();
    return {partial:deadlineReached,reason:deadlineReached?'scanner_priority_time_budget':null,reddit:redditResult,xPosts:xResult.posts?.length||0,xAvailable:xResult.available===true,telegramDiscovery,blueskyTokensChecked:selected.filter(token=>token.blueskyIntel?.checkedAt).length,nostrBatchSize:socialBatchSize};
  }
  pair(p, targetMint = null) {
    if (!p || p.chainId !== 'solana') return false;
    const baseMint = String(p.baseToken?.address || '');
    const quoteMint = String(p.quoteToken?.address || '');
    const mint = targetMint
      ? (targetMint === baseMint || targetMint === quoteMint ? targetMint : '')
      : baseMint;
    if (!mint || !this.canTrackMint(mint)) return false;
    const isQuoteToken = mint === quoteMint && mint !== baseMint;
    const tokenMeta = isQuoteToken ? p.quoteToken : p.baseToken;
    const t = this.state.tokens[mint] || this.restoreArchivedToken(mint) || { mint, sources: ['dex_pair'], smartMoney: { hits: 0, wallets: [] } };
    t.name = tokenMeta?.name || t.name || 'Unknown';
    t.symbol = tokenMeta?.symbol || t.symbol || '—';
    t.pairAddress = p.pairAddress || t.pairAddress;
    t.dexUrl = p.url || t.dexUrl;
    const validNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const basePriceUsd = validNumber(p.priceUsd) && Number(p.priceUsd) > 0 ? Number(p.priceUsd) : null;
    const nativePrice = validNumber(p.priceNative) && Number(p.priceNative) > 0 ? Number(p.priceNative) : null;
    const observedPriceUsd = isQuoteToken
      ? (basePriceUsd !== null && nativePrice !== null ? basePriceUsd / nativePrice : null)
      : basePriceUsd;
    const observedPrice = observedPriceUsd !== null && Number.isFinite(observedPriceUsd) && observedPriceUsd > 0;
    if (observedPrice) t.priceUsd = observedPriceUsd;
    if (validNumber(p.liquidity?.usd) && Number(p.liquidity.usd) >= 0) t.liquidityUsd = Number(p.liquidity.usd);
    // FDV/market cap belong to the base token in the pair response. Do not
    // assign those values to a quote-side mint: that would misprice its size.
    if (!isQuoteToken) {
      if (validNumber(p.fdv) && Number(p.fdv) > 0) t.fdv = Number(p.fdv);
      if (validNumber(p.marketCap) && Number(p.marketCap) > 0) t.marketCap = Number(p.marketCap);
      else if (validNumber(p.fdv) && Number(p.fdv) > 0) t.marketCap = Number(p.fdv);
    }
    const mergeNumeric = next => Object.fromEntries(Object.entries(next || {}).filter(([, v]) => validNumber(v)).map(([k, v]) => [k, Number(v)]));
    const pairObservedAt=new Date().toISOString(),freshVolume=mergeNumeric(p.volume);
    const freshTxns=Object.fromEntries(Object.entries(p.txns||{}).filter(([,v])=>v&&typeof v==='object').map(([period,v])=>[period,mergeNumeric(v)]));
    const freshPriceChange=mergeNumeric(p.priceChange),hasCompletePairTxns=period=>Number.isFinite(freshTxns[period]?.buys)&&Number.isFinite(freshTxns[period]?.sells);
    t.marketFieldsObservedAt={...(t.marketFieldsObservedAt||{})};
    if(Object.keys(freshVolume).length)t.marketFieldsObservedAt.volume=pairObservedAt;
    if(Object.prototype.hasOwnProperty.call(freshVolume,'m5'))t.marketFieldsObservedAt.volumeM5=pairObservedAt;
    if(Object.prototype.hasOwnProperty.call(freshVolume,'h1'))t.marketFieldsObservedAt.volumeH1=pairObservedAt;
    if(Object.prototype.hasOwnProperty.call(freshVolume,'h24'))t.marketFieldsObservedAt.volumeH24=pairObservedAt;
    const hasPairTxnsFresh=Object.values(freshTxns).some(row=>Object.keys(row).length>0);
    if(hasPairTxnsFresh)t.marketFieldsObservedAt.txns=pairObservedAt;
    if(hasCompletePairTxns('m5'))t.marketFieldsObservedAt.txnsM5=pairObservedAt;
    if(hasCompletePairTxns('h1'))t.marketFieldsObservedAt.txnsH1=pairObservedAt;
    if(hasCompletePairTxns('h24'))t.marketFieldsObservedAt.txnsH24=pairObservedAt;
    if(Object.prototype.hasOwnProperty.call(freshPriceChange,'m5'))t.marketFieldsObservedAt.priceChangeM5=pairObservedAt;
    if(Object.prototype.hasOwnProperty.call(freshPriceChange,'h1'))t.marketFieldsObservedAt.priceChangeH1=pairObservedAt;
    if(Object.prototype.hasOwnProperty.call(freshPriceChange,'h24'))t.marketFieldsObservedAt.priceChangeH24=pairObservedAt;
    if(Object.keys(freshPriceChange).length)t.marketFieldsObservedAt.priceChange=pairObservedAt;
    if(observedPrice)t.marketFieldsObservedAt.priceUsd=pairObservedAt;
    if(validNumber(p.liquidity?.usd)&&Number(p.liquidity.usd)>=0)t.marketFieldsObservedAt.liquidityUsd=pairObservedAt;
    t.volume = { ...(t.volume || {}), ...freshVolume };
    t.txns = { ...(t.txns || {}), ...Object.fromEntries(Object.entries(freshTxns).map(([period,v])=>[period,{...(t.txns?.[period]||{}),...v}])) };
    t.priceChange = { ...(t.priceChange || {}), ...freshPriceChange };
    t.pairCreatedAt = validNumber(p.pairCreatedAt) && Number(p.pairCreatedAt) > 0 ? Number(p.pairCreatedAt) : t.pairCreatedAt || null;
    t.firstSeenAt = t.firstSeenAt || iso();
    ensureLaunchCohort(t, Date.parse(t.firstSeenAt) || Date.now());
    if (t.pairCreatedAt) t.ageHours = Math.max(0, (Date.now() - t.pairCreatedAt) / 3600000);
    // DexScreener's pair-level info belongs to the base token. Never leak
    // the base asset's socials or image into a quote-side token's intelligence.
    const pairInfo = isQuoteToken ? null : p.info;
    t.socials = tokenMeta?.info?.socials || pairInfo?.socials || t.socials || [];
    t.websites = tokenMeta?.info?.websites || pairInfo?.websites || t.websites || [];
    t.imageUrl = tokenMeta?.info?.imageUrl || pairInfo?.imageUrl || t.imageUrl;
    t.history = Array.isArray(t.history) ? t.history : [];
    const observedLiquidity = validNumber(p.liquidity?.usd) && Number(p.liquidity.usd) >= 0;
    let snapshotCreated = false;
    if (observedPrice && observedLiquidity) {
      const currentAnalysis = this.score(t);
      const snap = {
        at: Date.now(), source: 'dexscreener', priceUsd: observedPriceUsd,
        liquidityUsd: Number(p.liquidity.usd),
        volume1h: validNumber(p.volume?.h1) ? Number(p.volume.h1) : null,
        volume24h: validNumber(p.volume?.h24) ? Number(p.volume.h24) : null,
        buys1h: validNumber(p.txns?.h1?.buys) ? Number(p.txns.h1.buys) : null,
        sells1h: validNumber(p.txns?.h1?.sells) ? Number(p.txns.h1.sells) : null,
        fieldObservedAt:{volume:Object.keys(freshVolume).length?pairObservedAt:null,volumeM5:Object.prototype.hasOwnProperty.call(freshVolume,'m5')?pairObservedAt:null,volumeH1:Object.prototype.hasOwnProperty.call(freshVolume,'h1')?pairObservedAt:null,volumeH24:Object.prototype.hasOwnProperty.call(freshVolume,'h24')?pairObservedAt:null,txns:hasPairTxnsFresh?pairObservedAt:null,txnsM5:hasCompletePairTxns('m5')?pairObservedAt:null,txnsH1:hasCompletePairTxns('h1')?pairObservedAt:null,txnsH24:hasCompletePairTxns('h24')?pairObservedAt:null,priceChangeM5:Object.prototype.hasOwnProperty.call(freshPriceChange,'m5')?pairObservedAt:null,priceChangeH1:Object.prototype.hasOwnProperty.call(freshPriceChange,'h1')?pairObservedAt:null,priceChangeH24:Object.prototype.hasOwnProperty.call(freshPriceChange,'h24')?pairObservedAt:null,priceUsd:pairObservedAt,liquidityUsd:pairObservedAt},
        fdv: isQuoteToken ? null : (t.fdv ?? null),
        score: currentAnalysis.score, coverage: currentAnalysis.coverage,
        classification: currentAnalysis.classification, criteriaVersion: currentAnalysis.criteriaVersion,
        legacyScore: currentAnalysis.legacyScore, launchPhase: currentAnalysis.launchPhase, risk: currentAnalysis.risk,
        flags: currentAnalysis.flags || [], factors: currentAnalysis.factors || {}
      };
      const last = t.history[t.history.length - 1];
      if (!last || snap.at - last.at >= 45000) {
        t.history.push(snap);
        t.history = t.history.slice(-100);
        this.recordForecast(t, snap);
        snapshotCreated = true;
      }
      t.marketObservedAt = new Date(snap.at).toISOString();
      t.marketObservationSource = 'dexscreener';
      observeLaunchCohort(t, snap);
    }
    t.updatedAt = iso();
    this.state.tokens[mint] = t;
    return snapshotCreated;
  }
  score(t,eliteIndex=null) {
    if(!eliteIndex){
      if(!this.scoreContext)this.scoreContext={signals:buildWalletTokenSignals(this.state),eliteIndex:buildEliteIntelligenceIndex(this.state)};
      eliteIndex=this.scoreContext.eliteIndex;
    }
    const previousAnalysis=t.analysis||{};
    const legacyScore=previousAnalysis.criteriaVersion===3
      ? (previousAnalysis.legacyScore!==null&&previousAnalysis.legacyScore!==undefined&&Number.isFinite(Number(previousAnalysis.legacyScore))?Number(previousAnalysis.legacyScore):null)
      : (previousAnalysis.score!==null&&previousAnalysis.score!==undefined&&Number.isFinite(Number(previousAnalysis.score))?Number(previousAnalysis.score):null);
    const weights={activity:12,momentum:12,market:10,liquidityQuality:12,executionQuality:10,security:20,demandQuality:14,earlyBuyerSignal:3,walletReputationSignal:7},scoreWeights={activity:10,momentum:15,market:10,liquidityQuality:15,executionQuality:10,security:15,demandQuality:15,walletReputationSignal:5,social:5},f={};
    const marketNow=Date.now(),fieldFresh=key=>marketFieldFresh(t,key,marketNow),marketView=freshMarketView(t,marketNow);
    const freshVolume=marketView.volume,freshTxns=marketView.txns;
    const microstructure=analyzeMicrostructure(marketView);
    const candidateIntel=evaluateCandidateIntel(t);
    const socialEvidence=t.socialIntel?.evidence||{};
    const socialSample=Number(socialEvidence.nonPromotionalPosts24h??socialEvidence.sampledPosts24h)||0;
    const socialAuthors=Number(socialEvidence.uniqueAuthors24h)||0;
    const socialChannels=Number(socialEvidence.uniqueChannels24h)||0;
    const socialSources=Number(socialEvidence.uniqueSources24h)||0;
    const socialEntities=Number(socialEvidence.independentEntities24h??(socialAuthors+socialChannels))||0;
    const socialIdentity=Number(socialEvidence.exactMatchSharePct??(100-Number(socialEvidence.weakMatchSharePct||0)));
    const socialDuplicates=Number(socialEvidence.duplicateSharePct)||0;
    const legacySocialEvidence=!Object.hasOwn(socialEvidence,'independentEntities24h')
      &&socialSample>=10&&Number(socialEvidence.weakMatchSharePct||0)<35
      &&((socialSources>=2&&socialAuthors>=5)||socialChannels>=3);
    const socialCommunitySpread=(socialSources>=2&&socialAuthors>=3)||socialChannels>=3;
    const earlySocialEvidence=['early_signal','limited_sample'].includes(candidateIntel.socialConfidence)
      &&socialSample>=3&&socialEntities>=3&&socialCommunitySpread
      &&Number.isFinite(socialIdentity)&&socialIdentity>=70&&socialDuplicates<50;
    if(candidateIntel.socialQuality!==null&&(earlySocialEvidence||legacySocialEvidence))f.social=candidateIntel.socialQuality;
    const h=fieldFresh('txnsH1')?t.txns?.h1:null,buys=n(h?.buys),sells=n(h?.sells),total=buys+sells,vol1=n(freshVolume.h1),vol24=n(freshVolume.h24),liq=n(t.liquidityUsd),fdv=n(t.fdv||t.marketCap);
    if(h&&total>0){
      // Activity measures transaction breadth only; volume belongs to demand quality.
      f.activity=clamp(Math.log10(total+1)*42);
      const ratio=buys/total;
      // Momentum is strictly short-window price/relative-volume evidence. H1
      // transaction count is already represented by activity and is not reused.
      if(microstructure.score!==null)f.momentum=microstructure.score;
      f.buyRatio=Number((ratio*100).toFixed(1));f.buySellRatio=Number((buys/Math.max(1,sells)).toFixed(2));
    }else if(microstructure.score!==null)f.momentum=microstructure.score;
    const hasVolume24=fieldFresh('volumeH24')&&freshVolume.h24!==null&&freshVolume.h24!==undefined&&Number.isFinite(Number(freshVolume.h24));if(t.liquidityUsd!==null&&t.liquidityUsd!==undefined&&Number.isFinite(Number(t.liquidityUsd))&&hasVolume24)f.market=clamp(Math.sqrt(Math.max(0,liq))*.055+Math.log10(vol24+1)*17);
    const liquidityObserved=t.liquidityUsd!==null&&t.liquidityUsd!==undefined&&Number.isFinite(Number(t.liquidityUsd))&&liq>=0;
    if(liquidityObserved){
      const hist=Array.isArray(t.history)?t.history:[],prior=hist.length>=2?hist[hist.length-2]:null;
      const change=prior&&Number(prior.liquidityUsd)>0?(liq/Number(prior.liquidityUsd)-1)*100:null;
      const ratio=liq>0&&fdv>0?fdv/liq:null;
      const components=[];
      // No universal optimum exists for volume/liquidity turnover.
      if(change!==null)components.push({weight:.55,value:clamp(70+change*1.5)});
      if(ratio!==null)components.push({weight:.45,value:clamp(100-Math.max(0,ratio-10)*1.5)});
      if(components.length>=2){const totalWeight=components.reduce((sum,x)=>sum+x.weight,0);f.liquidityQuality=clamp(components.reduce((sum,x)=>sum+x.value*x.weight,0)/totalWeight);}
      t.metrics={...(t.metrics||{}),volumeToLiquidity:liq>0&&freshVolume.h1!=null?Number((n(freshVolume.h1)/liq).toFixed(3)):null,fdvToLiquidity:ratio===null?null:Number(ratio.toFixed(2)),liquidityChangePct:change===null?null:Number(change.toFixed(2)),priceChangeSincePrevious:prior&&prior.priceUsd>0?Number(((t.priceUsd/prior.priceUsd-1)*100).toFixed(2)):null};
    }
    if(candidateIntel.tradeQuality!==null)f.demandQuality=candidateIntel.tradeQuality;
    const sellabilityRows=[...(Array.isArray(t.sellabilityChecks)?t.sellabilityChecks:[]),...(t.sellability?[t.sellability]:[])];
    const freshSellabilityRows=sellabilityRows.filter(row=>{const at=Date.parse(row?.checkedAt||'');return Number.isFinite(at)&&Date.now()-at<=10*60*1000&&Date.now()>=at-60000;});
    const byTestSize=new Map();
    for(const row of freshSellabilityRows){const size=Number(row.requestedUsd||DEFAULT_TEST_USD);const prior=byTestSize.get(size);if(!prior||Date.parse(row.checkedAt)>Date.parse(prior.checkedAt))byTestSize.set(size,row);}
    const currentExitQuotes=[...byTestSize.values()];
    // Supply caps can make the actual sold notional smaller than the requested test size.
    // All exitability metrics must use the amount actually quoted by Jupiter.
    const quoteNotionalUsd=row=>{const actual=Number(row?.inputAmountUsd);if(Number.isFinite(actual)&&actual>0)return actual;const requested=Number(row?.requestedUsd||DEFAULT_TEST_USD);return Number.isFinite(requested)&&requested>0?requested:0;};
    // Some Jupiter routes omit priceImpactPct but still return an exact USDC outAmount.
    // effectiveLossPct is the conservative, measured all-in execution loss (impact + fees).
    // Use it as a fallback eligibility bound; never relabel it as priceImpactPct.
    const quoteExecutionLossPct=row=>{const impact=row?.priceImpactPct;if(impact!==null&&impact!==undefined&&Number.isFinite(Number(impact)))return Number(impact);const loss=row?.effectiveLossPct;return loss!==null&&loss!==undefined&&Number.isFinite(Number(loss))?Math.max(0,Number(loss)):null;};
    const lowSizeNoRoute=currentExitQuotes.some(row=>quoteNotionalUsd(row)<=100&&(row.status==='no_route'||row.status==='high_impact'||(quoteExecutionLossPct(row)!==null&&quoteExecutionLossPct(row)>5)));
    const executableQuotes=currentExitQuotes.filter(row=>row.routeAvailable===true&&row.status==='route_available'&&quoteExecutionLossPct(row)!==null&&quoteExecutionLossPct(row)<=5);
    const exitCapacityUsd=executableQuotes.reduce((max,row)=>Math.max(max,quoteNotionalUsd(row)),0);
    if(currentExitQuotes.length){
      if(lowSizeNoRoute)f.executionQuality=0;
      else {
        const largestQuote=currentExitQuotes.slice().sort((a,b)=>quoteNotionalUsd(b)-quoteNotionalUsd(a))[0];
        const impact=Number(largestQuote?.priceImpactPct),loss=Number(largestQuote?.effectiveLossPct);
        f.executionQuality=clamp((exitCapacityUsd/250)*75+(exitCapacityUsd>0?25:0)-(Number.isFinite(impact)?Math.max(0,impact)*4:0)-(Number.isFinite(loss)?Math.max(0,loss):0));
      }
    }
    const qualifiedEarlyBuyers=t.tradeIntel?.earlyWindow?.complete&&Array.isArray(t.tradeIntel.earlyBuyers)?t.tradeIntel.earlyBuyers.filter(x=>n(x.buys)>=2&&n(x.buyVolumeUsd)>=150):[];if(qualifiedEarlyBuyers.length)f.earlyBuyerSignal=clamp(40+Math.min(qualifiedEarlyBuyers.length,4)*15);
    const walletSignal=t.walletReputation;
    if(walletSignal?.qualified===true&&Number.isFinite(Number(walletSignal.score)))f.walletReputationSignal=clamp(walletSignal.score);
    if(t.security?.checkedAt){const sec=t.security.data||{},authorityKnown=typeof sec.freezeAuthorityActive==='boolean'&&typeof sec.mintAuthorityActive==='boolean',tokenProgramKnown=sec.tokenProgram?([SPL_TOKEN_MINT_PROGRAM,TOKEN_2022_MINT_PROGRAM].includes(sec.tokenProgram)):sec.isToken2022===false,tokenProgramConsistent=!sec.tokenProgram||(sec.tokenProgram===TOKEN_2022_MINT_PROGRAM?sec.isToken2022===true:sec.isToken2022===false),tokenTypeReviewed=sec.isInitialized===true&&tokenProgramKnown&&tokenProgramConsistent&&(!sec.isToken2022||sec.token2022ExtensionsReviewed===true),holderKnown=sec.ownerConcentrationAvailable===true&&sec.top10HolderPercent!==null&&Number.isFinite(Number(sec.top10HolderPercent)),holderComplete=holderKnown&&Number(sec.holderSampleAccounts)>=5&&Number(sec.unknownOwnerAccounts)===0,holderSampleReviewed=Number(sec.holderSampleAccounts)>=5&&sec.top10AccountPercent!==null&&sec.top10AccountPercent!==undefined&&Number.isFinite(Number(sec.top10AccountPercent))&&sec.holderSampleCoveragePct!==null&&sec.holderSampleCoveragePct!==undefined&&Number.isFinite(Number(sec.holderSampleCoveragePct))&&Number(sec.holderSampleCoveragePct)>0,freeze=sec.freezeAuthorityActive===true,top=holderKnown?Number(sec.top10HolderPercent):null,flags=[freeze,sec.mintAuthorityActive===true,top!==null&&top>=70].filter(Boolean).length;const token2022Penalty=(sec.permanentDelegateActive?22:0)+(sec.transferHookActive?10:0)+(sec.confidentialTransfer?12:0)+(sec.mintCloseAuthorityActive?6:0)+(sec.defaultAccountFrozen?25:0)+(Number(sec.maxTransferFeeBps)>500?Math.min(25,Math.ceil((Number(sec.maxTransferFeeBps)-500)/200)):0)+(sec.pausableActive?12:0);t.security.hardBlocked=freeze||sec.nonTransferable===true||sec.pausablePaused===true;t.security.risk=!authorityKnown?'unknown':t.security.hardBlocked?'high':!tokenTypeReviewed||!holderSampleReviewed?'partial':!holderComplete||flags||token2022Penalty?'medium':'observations_only';t.security.holderEvidenceComplete=holderComplete&&tokenTypeReviewed;t.security.holderSampleReviewed=holderSampleReviewed;if(authorityKnown&&tokenTypeReviewed)f.security=clamp(100-(freeze?35:0)-(sec.mintAuthorityActive===true?15:0)-(top!==null&&top>=70?25:0)-(top!==null&&top>=50&&top<70?10:0)-token2022Penalty);}
    if(t.launchSource&&t.pumpCreatedAt){const launchAt=Date.parse(t.pumpCreatedAt);if(Number.isFinite(launchAt))t.launchAgeHours=Math.max(0,(Date.now()-launchAt)/3600000);}
    const ageForPhase=Number.isFinite(Number(t.launchAgeHours))?Number(t.launchAgeHours):Number.isFinite(Number(t.ageHours))?Number(t.ageHours):null;
    const launchPhase=ageForPhase===null?'unknown':ageForPhase<5/60?'launch_discovery':ageForPhase<0.5?'early':ageForPhase<2?'momentum':ageForPhase<24?'established':'mature';
    const available=Object.entries(weights).filter(([k])=>Number.isFinite(f[k])),coverage=available.reduce((sum,[k])=>sum+weights[k],0);
    const hasScoreEvidence=Object.keys(scoreWeights).some(key=>Number.isFinite(f[key]));
    // Missing factors contribute neutral 50 but never inflate coverage.
    const score=hasScoreEvidence?Math.round(Object.entries(scoreWeights).reduce((sum,[key,weight])=>sum+(Number.isFinite(f[key])?f[key]:50)*weight,0)/100):null;
    const flags=[...microstructure.flags];const token2022=t.security?.data;if(token2022?.tokenProgram&&!([SPL_TOKEN_MINT_PROGRAM,TOKEN_2022_MINT_PROGRAM].includes(token2022.tokenProgram)))flags.push({level:'warning',code:'UNKNOWN_TOKEN_PROGRAM',message:'Programme propriétaire du mint non reconnu; facteur sécurité non qualifié.'});if(token2022?.isToken2022===true){if(token2022.token2022ExtensionsReviewed!==true)flags.push({level:'warning',code:'TOKEN_2022_REVIEW',message:'Token-2022 détecté : extensions inconnues ou données TLV invalides, sécurité non qualifiée.'});if(token2022.nonTransferable===true)flags.push({level:'critical',code:'TOKEN_2022_NON_TRANSFERABLE',message:'Token-2022 NonTransferable : le transfert et la revente sont désactivés.'});if(token2022.pausablePaused===true)flags.push({level:'critical',code:'TOKEN_2022_PAUSED',message:'Le mint Token-2022 est actuellement en pause.'});if(token2022.permanentDelegateActive===true)flags.push({level:'warning',code:'TOKEN_2022_PERMANENT_DELEGATE',message:'Un permanent delegate peut agir sur les tokens des détenteurs.'});if(token2022.transferHookActive===true)flags.push({level:'warning',code:'TOKEN_2022_TRANSFER_HOOK',message:'Un transfer hook externe intervient dans les transferts.'});if(token2022.defaultAccountFrozen===true)flags.push({level:'warning',code:'TOKEN_2022_DEFAULT_FROZEN',message:'Les nouveaux comptes sont gelés par défaut.'});if(token2022.pausableActive===true&&token2022.pausablePaused!==true)flags.push({level:'warning',code:'TOKEN_2022_PAUSABLE',message:'Le mint peut être mis en pause par une autorité.'});if(token2022.confidentialTransfer===true)flags.push({level:'warning',code:'TOKEN_2022_CONFIDENTIAL_TRANSFER',message:'Les transferts confidentiels limitent la transparence des soldes.'});if(Number(token2022.maxTransferFeeBps)>500)flags.push({level:'warning',code:'TOKEN_2022_HIGH_TRANSFER_FEE',message:'Frais de transfert configurés jusqu’à '+(Number(token2022.maxTransferFeeBps)/100)+'%.'});}if(t.security?.data?.freezeAuthorityActive===true)flags.push({level:'critical',code:'FREEZE_AUTHORITY',message:'Freeze authority active'});if(t.security?.data?.mintAuthorityActive===true)flags.push({level:'warning',code:'MINT_AUTHORITY',message:'Mint authority active'});if(t.security?.data?.ownerConcentrationAvailable===true&&Number(t.security.data.top10HolderPercent)>=70)flags.push({level:'warning',code:'HOLDER_CONCENTRATION',message:'Top 10 observed wallets concentration: '+t.security.data.top10HolderPercent+'% (sample may include pool or program-controlled accounts).'});if(t.security?.data?.ownerConcentrationAvailable===true&&Number(t.security.data.top1OwnerPercent)>=20)flags.push({level:'warning',code:'TOP1_WALLET_CONCENTRATION',message:'One observed wallet controls '+t.security.data.top1OwnerPercent+'% of supply (verify whether it is a pool or program account).'});if(t.security?.data?.ownerConcentrationAvailable===true&&Number(t.security.data.top5OwnerPercent)>=50)flags.push({level:'warning',code:'TOP5_WALLET_CONCENTRATION',message:'Top 5 observed wallets control '+t.security.data.top5OwnerPercent+'% of supply'});if(t.security?.data?.ownerConcentrationAvailable!==true&&Number(t.security?.data?.top10AccountPercent)>=85)flags.push({level:'warning',code:'TOP10_ACCOUNT_CONCENTRATION_UNVERIFIED',message:'Les 10 plus gros comptes représentent '+t.security.data.top10AccountPercent+'% de la supply, mais les propriétaires ne sont pas tous identifiés : concentration des wallets inconnue.'});if(liq>0&&fdv>0&&fdv/liq>30)flags.push({level:'warning',code:'HIGH_FDV_LIQUIDITY',message:'FDV / liquidity ratio is unusually high'});if(total>=10&&buys/total<.4)flags.push({level:'warning',code:'SELL_PRESSURE',message:'Sell transactions dominate recent activity'});if(t.metrics?.liquidityChangePct!==null&&t.metrics?.liquidityChangePct!==undefined&&t.metrics.liquidityChangePct< -15)flags.push({level:'critical',code:'LIQUIDITY_DROP',message:'Liquidity dropped more than 15% between observations'});if(t.ageHours!==null&&t.ageHours!==undefined&&t.ageHours<1&&liq<3000)flags.push({level:'warning',code:'THIN_NEW_POOL',message:'Very new pool with low liquidity'});const creatorSoldPct=Number(t.creatorSaleSummary?.soldPctSupply24h??t.creatorSaleSummary?.soldPctSupplyLast);if(Number.isFinite(creatorSoldPct)&&creatorSoldPct>=1)flags.push({level:creatorSoldPct>=5?'critical':'warning',code:'CREATOR_SELL_OBSERVED',message:'Sorties cumulées du créateur dans des swap-like observés sur 24 h : '+creatorSoldPct+'% de la supply (estimation).'});if(t.sellability?.status==='high_impact')flags.push({level:'warning',code:'SELL_ROUTE_HIGH_IMPACT',message:'La route de vente Jupiter estimée présente un impact de prix de '+t.sellability.priceImpactPct+'% pour environ '+(t.sellability.inputAmountUsd||t.sellability.requestedUsd||100)+' USD.'});if(t.sellability?.status==='no_route')flags.push({level:'warning',code:'SELL_ROUTE_UNAVAILABLE',message:'Jupiter ne trouve pas de route de vente pour le montant testé. Ce résultat ne prouve pas un honeypot; le DEX, la liquidité ou le token peuvent ne pas être pris en charge.'});const recentEarlyOutflows=(t.earlyWalletOutflows||[]).filter(x=>x.swapConfirmed&&Date.now()-Date.parse(x.at||0)<=600000);const earlySellerCount=new Set(recentEarlyOutflows.map(x=>x.wallet)).size;if(earlySellerCount>=3)flags.push({level:'warning',code:'EARLY_WALLET_SELL_CLUSTER',message:earlySellerCount+' wallets acheteurs précoces ont eu une sortie swap-like observée dans les 10 dernières minutes.'});
    const externalAssessment=assessExternalSecurity(t.externalSecurity);
    // GL1TCH is an optional second opinion, never a hard dependency or veto.
    if(externalAssessment.decision==='block')flags.push({level:'warning',code:'EXTERNAL_SECURITY_RISK',message:externalAssessment.reason});
    else if(externalAssessment.decision!=='clear')flags.push({level:'warning',code:'EXTERNAL_SECURITY_UNVERIFIED',message:externalAssessment.reason});
    const hardBlocked=Boolean(t.security?.hardBlocked||flags.some(x=>x.level==='critical'));
    flags.push(...candidateIntel.flags);
    const eliteIntelligence=evaluateEliteIntelligence(t,this.state,eliteIndex);
    flags.push(...eliteIntelligence.flags);
    const adjustedScore=score===null?null:clamp(score+candidateIntel.adjustment+eliteIntelligence.adjustment);
    const factorLabels={activity:'activité distincte',momentum:'momentum court terme',market:'données de marché',liquidityQuality:'stabilité et valorisation de la liquidité',executionQuality:'capacité de sortie Jupiter',security:'sécurité on-chain',demandQuality:'flux nets et acheteurs distincts',earlyBuyerSignal:'cohorte des premiers acheteurs',walletReputationSignal:'réputation des wallets',social:'preuves sociales indépendantes'};
    const missingFactors=[...Object.keys(weights).filter(key=>!Number.isFinite(f[key])),...(!Number.isFinite(f.social)?['social']:[])];
    const marketLinked=Boolean(t.pairAddress||t.geckoPoolAddress);
    const securityEvidence=Number.isFinite(f.security);
    const securityPublicationReady=securityEvidence&&t.security?.holderSampleReviewed===true;const securityComprehensive=securityEvidence&&t.security?.holderEvidenceComplete===true;
    const readiness=!marketLinked?'awaiting_market':coverage>=70&&securityComprehensive&&Number.isFinite(f.social)?'complete':coverage>=20?'partial':'insufficient_data';
    const readinessLabel=readiness==='awaiting_market'?'Pré-marché · pool absent':readiness==='complete'?'Analyse complète':readiness==='partial'?'Analyse partielle':'Données insuffisantes';
    const missingReasons={
      activity:!h?'transactions 1h absentes ou trop anciennes':(n(h.buys)+n(h.sells))<=0?'aucun achat/vente exploitable sur 1h':null,
      momentum:!Array.isArray(t.history)||t.history.length<2?'deux snapshots comparables requis':null,
      market:!marketLinked?'aucun pool DEX relié':!(Number(t.liquidityUsd)>0)?'liquidité USD absente':!hasVolume24?'volume 24h absent ou trop ancien':null,
      liquidityQuality:'évolution de liquidité et FDV/liquidité doivent être observés sur plusieurs snapshots',
      executionQuality:'aucune cotation de vente Jupiter récente pour le montant de test',
      demandQuality:'échantillon récent avec flux nets et acheteurs distincts indisponible',
      security:!t.security?.checkedAt?'contrôle RPC pas encore effectué':t.security?.data?.isToken2022===true?'Token-2022 : extensions non vérifiées':!securityEvidence?'autorités du mint ou type de programme non confirmés':null,
      earlyBuyerSignal:'fenêtre initiale ou cohorte des 70 premiers acheteurs incomplète',
      walletReputationSignal:'pas encore assez de positions clôturées et vérifiées pour noter les wallets',
      social:'au moins cinq publications pertinentes, identité du token confirmée et plusieurs auteurs ou canaux'
    };
    const missingFactorReasons=missingFactors.map(key=>({key,label:factorLabels[key]||key,reason:missingReasons[key]||'preuves insuffisantes'}));
    const evidenceGaps=[];
    if(securityEvidence&&!securityComprehensive)evidenceGaps.push({key:'holders',reason:'Autorités vérifiées, mais concentration des détenteurs non calculable : propriétaires RPC incomplets.'});
    const readinessReason=!marketLinked?'Token détecté avant marché exploitable : aucun pool DEX n’est encore relié. L’âge sert uniquement à segmenter la phase de lancement; il ne contribue ni au score ni à la couverture.':missingFactorReasons.length?'Facteurs manquants : '+missingFactorReasons.map(x=>x.label+' ('+x.reason+')').join('; ')+'.':evidenceGaps.length?'Facteurs principaux disponibles, mais preuves complémentaires incomplètes.':'Les principaux facteurs du scanner sont disponibles.';
    return {criteriaVersion:3,legacyScore,score:adjustedScore===null?null:Math.round(adjustedScore),baseScore:score,coverage,readiness,readinessLabel,readinessReason,marketLinked,launchPhase,launchAgeHours:ageForPhase===null?null:Number(ageForPhase.toFixed(2)),exitCapacityUsd:currentExitQuotes.length?exitCapacityUsd:null,missingFactors,missingFactorReasons,evidenceGaps,securityComprehensive,securityPublicationReady,externalSecurity:externalAssessment,factors:{...f,...(candidateIntel.tradeQuality===null?{}:{tradeQuality:candidateIntel.tradeQuality})},walletReputation:walletSignal||null,candidateIntel,eliteIntelligence,marketSignals:microstructure.metrics,hardBlocked,risk:hardBlocked||flags.some(x=>x.level==='critical')?'high':flags.some(x=>x.level==='warning')?'medium':t.security?.risk||'unknown',confidence:readiness==='complete'?'high':coverage>=35?'medium':'low',flags,classification:score===null?'insufficient_data':coverage<45?'low_confidence':hardBlocked?'blocked':readiness==='complete'&&adjustedScore>=80?'strong_candidate':adjustedScore>=65?'watch':'weak'};
  }
  scoreAll({reuseContext=false}={}){const signals=reuseContext&&this.scoreContext?this.scoreContext.signals:buildWalletTokenSignals(this.state);const eliteIndex=reuseContext&&this.scoreContext?this.scoreContext.eliteIndex:buildEliteIntelligenceIndex(this.state);this.scoreContext={signals,eliteIndex};for(const t of Object.values(this.state.tokens)){t.walletReputation=signals[t.mint]||null;t.analysis=this.score(t,eliteIndex);}}
  async refreshExternalSecurityCandidates(limit=5){
    const settings=this.state.scannerSettings||{},floor=Math.max(55,(Number(settings.minScore)||80)-15);
    const candidates=Object.values(this.state.tokens||{}).filter(t=>t?.mint&&(t.pairAddress||t.geckoPoolAddress)&&Number(t.analysis?.score)>=floor&&!t.analysis?.hardBlocked&&t.analysis?.risk!=='high')
      .sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)||Number(b.liquidityUsd||0)-Number(a.liquidityUsd||0))
      .slice(0,Math.max(1,Math.min(5,Number(limit)||3)));
    let checked=0;
    for(const token of candidates){
      const previous=token.externalSecurity,age=previous?.checkedAt?Date.now()-Date.parse(previous.checkedAt):Infinity;
      if(previous&&age<(previous.status==='ok'?30*60*1000:5*60*1000))continue;
      try{await this.inspectExternalSecurity(token);checked++;}
      catch(error){token.externalSecurity={status:'unavailable',provider:'GL1TCH · API publique gratuite',checkedAt:iso(),error:String(error.message||error).slice(0,180)};}
    }
    return {considered:candidates.length,checked};
  }
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
  async refreshSellabilityQuotes(candidates=[]) {
    const now=Date.now();
    const refreshFloor=Math.max(60,(Number(this.state.scannerSettings?.minScore)||80)-15);
    const eligible=(Array.isArray(candidates)?candidates:[]).filter(token=>{
      if(!token?.mint||token.analysis?.hardBlocked===true||(token.analysis?.securityPublicationReady!==true&&token.analysis?.securityComprehensive!==true)||Number(token.analysis?.score)<refreshFloor)return false;
      if(!(token.pairAddress||token.geckoPoolAddress)||!(Number(token.liquidityUsd)>0))return false;
      const checked=Date.parse(token.sellability?.checkedAt||'');
      const status=token.sellability?.status;
      const impact=token.sellability?.priceImpactPct,loss=token.sellability?.effectiveLossPct;
      const impactKnown=impact!==null&&impact!==undefined&&Number.isFinite(Number(impact));
      const executionLossKnown=loss!==null&&loss!==undefined&&Number.isFinite(Number(loss));
      // A quoted all-in loss is enough to assess execution conservatively even
      // when Jupiter omits its separate impact field. Retry only truly incomplete routes.
      const ttlMs=status==='error'?60_000
        :status==='route_available'&&!impactKnown&&!executionLossKnown?3*60*1000
        :status==='no_route'||status==='high_impact'?5*60*1000:10*60*1000;
      return !Number.isFinite(checked)||now-checked>=ttlMs;
    }).sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)
      ||inspectionTimestamp(a,a.sellability?.checkedAt)-inspectionTimestamp(b,b.sellability?.checkedAt));
    const token=eligible[0];
    if(!token){
      this.state.sources.jupiterSellability={ok:true,skipped:true,at:iso(),checked:0,mode:'Swap API V2 /order · aucun candidat prioritaire à vérifier'};
      return {checked:0,skipped:true};
    }
    const jupiterPriceAt=Date.parse(token.jupiterPrice?.checkedAt||'');
    const jupiterPriceFresh=Number(token.jupiterPrice?.priceUsd)>0&&Number.isFinite(jupiterPriceAt)&&now-jupiterPriceAt<5*60*1000;
    const price=jupiterPriceFresh?Number(token.jupiterPrice.priceUsd):Number(token.priceUsd);
    const decimals=Number.isInteger(Number(token.jupiterPrice?.decimals))&&token.jupiterPrice?.decimals!==null
      ?Number(token.jupiterPrice.decimals)
      :Number.isInteger(Number(token.security?.data?.decimals))?Number(token.security.data.decimals):null;
    const testSizes=[50,100,250];
    const priorChecks=Array.isArray(token.sellabilityChecks)?token.sellabilityChecks:[];
    const testUsd=testSizes.find(size=>!priorChecks.some(row=>Number(row.requestedUsd)===size))??testSizes.slice().sort((a,b)=>{const aAt=Date.parse(priorChecks.find(row=>Number(row.requestedUsd)===a)?.checkedAt||'')||0;const bAt=Date.parse(priorChecks.find(row=>Number(row.requestedUsd)===b)?.checkedAt||'')||0;return aAt-bAt;})[0];
    const amount=amountForUsd({usd:testUsd,priceUsd:price,decimals,supplyUi:token.security?.data?.supply});
    if(!amount){
      const missingPrice=!Number.isFinite(price)||price<=0;
      const invalidDecimals=!Number.isInteger(decimals)||decimals<0||decimals>18;
      const reason=missingPrice?'Prix USD absent ou invalide.':invalidDecimals?'Décimales du token absentes ou invalides.':'Montant de test inférieur à la précision représentable.';
      token.sellability={status:'unsupported',routeAvailable:null,checkedAt:iso(),reason,executionSimulated:false,transactionRequested:false};
      this.state.sources.jupiterSellability={ok:true,skipped:true,at:iso(),checked:0,status:'unsupported',reason,priceUsd:missingPrice?null:price,decimals:invalidDecimals?null:decimals,mode:'Jupiter · montant de test indisponible'};
      return {checked:0,skipped:true,reason:'unsupported_amount'};
    }
    try{
      const quote=await fetchJupiterSellQuote(token.mint,amount.amountRaw);
      const sellabilityCheck={...quote,requestedUsd:testUsd,inputAmountUsd:amount.inputAmountUsd,checkedAt:iso(),tokenDecimals:decimals,priceSource:jupiterPriceFresh?'Jupiter Price API v3':'DexScreener',source:'Jupiter Swap API V2 /order',executionSimulated:false,transactionRequested:false};
      token.sellabilityChecks=Array.isArray(token.sellabilityChecks)?token.sellabilityChecks.filter(row=>Number(row.requestedUsd)!==testUsd).slice(-2):[];
      token.sellabilityChecks.push(sellabilityCheck);
      token.sellability={
        ...quote,
        status:quote.status,
        checkedAt:iso(),
        requestedUsd:testUsd,
        inputAmountUsd:amount.inputAmountUsd,
        tokenDecimals:decimals,
        maxSupplyShareBps:MAX_SUPPLY_SHARE_BPS,
        priceSource:jupiterPriceFresh?'Jupiter Price API v3':'DexScreener',
        source:'Jupiter Swap API V2 /order',
        executionSimulated:false,
        transactionRequested:false
      };
      this.state.sources.jupiterSellability={
        ok:true,at:iso(),checked:1,status:quote.status,routeAvailable:quote.routeAvailable,
        priceImpactPct:quote.priceImpactPct??null,
        mode:'Jupiter Swap API V2 /order · lecture seule · test '+testUsd+' USD · 1 quote maximum par scan'
      };
      return {checked:1,mint:token.mint,status:quote.status,routeAvailable:quote.routeAvailable};
    }catch(error){
      token.sellability={status:'error',routeAvailable:null,checkedAt:iso(),error:String(error.message||error).slice(0,180),source:'Jupiter Swap API V2 /order',executionSimulated:false,transactionRequested:false};
      this.state.sources.jupiterSellability={ok:false,at:iso(),checked:1,error:token.sellability.error,mode:'Jupiter Swap API V2 /order · erreur temporaire'};
      return {checked:1,mint:token.mint,status:'error',error:token.sellability.error};
    }
  }
  jupiterRefreshCandidates(limit=20){
    const refreshFloor=Math.max(60,(Number(this.state.scannerSettings?.minScore)||80)-15);
    return Object.values(this.state.tokens||{}).filter(token=>{
      const score=Number(token?.analysis?.score);
      return Boolean(token?.mint&&(token.pairAddress||token.geckoPoolAddress))
        &&Number.isFinite(score)&&score>=refreshFloor
        &&token.analysis?.hardBlocked!==true
        &&token.analysis?.risk!=='high'&&token.analysis?.risk!=='unknown'
        &&(token.analysis?.securityPublicationReady===true||token.analysis?.securityComprehensive===true)
        &&Number(token.liquidityUsd)>0;
    }).sort((a,b)=>Number(b.analysis?.score||0)-Number(a.analysis?.score||0)
      ||inspectionTimestamp(a,a.sellability?.checkedAt)-inspectionTimestamp(b,b.sellability?.checkedAt)
      ||Number(b.liquidityUsd||0)-Number(a.liquidityUsd||0)).slice(0,Math.max(1,Math.min(30,Number(limit)||20)));
  }
  async refreshJupiterSignals(candidates=[]) {
    // Selection cards are intentionally lightweight snapshots. Jupiter price and
    // sellability checks need the canonical token record (price, decimals, supply,
    // security evidence and prior quote history), so resolve every mint back to
    // the live state before either task runs.
    const liveCandidates=resolveLiveTokenCandidates(candidates,this.state.tokens);
    if(this.jupiterTaskTurn==='sellability'){
      const result=await this.refreshSellabilityQuotes(liveCandidates);
      this.jupiterTaskTurn='price';
      return {task:'sellability',result};
    }
    const result=await this.refreshJupiterPrices(liveCandidates);
    this.jupiterTaskTurn='sellability';
    return {task:'price',result};
  }
  async scan(){
    if(this.scanning){this.lastScanSkipReason='scan_already_running';return {skipped:true,reason:'scan_already_running'};}
    if(this.backgroundTaskRunning){this.queueScanRetry(5000,'background_task_busy:'+this.backgroundTaskRunning);return {skipped:true,reason:'background_task_busy',backgroundTask:this.backgroundTaskRunning,retryScheduled:true};}
    if(this.scanRetryTimer){clearTimeout(this.scanRetryTimer);this.scanRetryTimer=null;}
    this.scanning=true;const start=Date.now();let scanCompleted=false;this.lastScanAttemptAt=iso();this.lastScanSkipReason=null;this.state.lastScanError=null;
    try{
      const initialBudget=memoryBudget({maxHeapMiB:460,maxExternalMiB:120,maxRssMiB:800});
      if(!initialBudget.ok){
        this.state.sources.scannerMemory={ok:false,at:iso(),reason:'Scan différé pour protéger la limite mémoire de l’hébergement',...initialBudget};
        this.queueScanRetry(30000,'memory_budget');
        return {skipped:true,reason:'memory_budget',memory:initialBudget,retryScheduled:true};
      }
      this.state.sources.scannerMemory={ok:true,at:iso(),reason:null,...initialBudget};
      // Fetch and consume one upstream payload at a time. Keeping five large
      // API responses alive in Promise.all caused avoidable RSS spikes on FadeHost.
      // Discovery needs only mint identity. Retaining full DexScreener payloads
      // in a Map duplicated data already stored by upsert() and inflated heap.
      const discoveredMints=new Set();
      const launchpadBudget=memoryBudget({maxHeapMiB:440,maxExternalMiB:112,maxRssMiB:760});
      const launchpadStreamStatus=this.launchpadLogStream.status();
      if(launchpadBudget.ok){
        const launchpadDiscovery=await processPendingLaunchpadTransactions(this.state,(method,params)=>this.rpc(method,params),event=>{
          const token=this.ingestLaunchpad(event);
          if(token)discoveredMints.add(token.mint);
        },{maxTransactions:3});
        this.state.sources.launchpadDiscovery={...launchpadStreamStatus,ok:launchpadStreamStatus.connected,connected:launchpadStreamStatus.connected,configured:launchpadStreamStatus.configured,at:iso(),lastSuccess:launchpadStreamStatus.connected?iso():this.state.sources.launchpadDiscovery?.lastSuccess||null,...launchpadDiscovery};
      }else{
        this.state.sources.launchpadDiscovery={...launchpadStreamStatus,ok:false,skipped:true,at:iso(),error:'Traitement différé : réserve mémoire prioritaire',memory:launchpadBudget};
      }
      const add=(arr,source)=>{if(!Array.isArray(arr))return;for(const x of arr){if(String(x.chainId).toLowerCase()!=='solana'||!x.tokenAddress)continue;discoveredMints.add(x.tokenAddress);this.upsert(x,source);}};
      const dexSources=[['profile',DEX+'/token-profiles/latest/v1'],['boost',DEX+'/token-boosts/latest/v1'],['top_boost',DEX+'/token-boosts/top/v1']];
      const dexErrors=[];let dexOk=false;
      for(const [source,url] of dexSources){
        try{const payload=await json(url,{},1,1024*1024);add(payload,source);dexOk=true;}
        catch(error){dexErrors.push(source+': '+String(error.message||error).slice(0,120));}
      }
      this.state.sources.dexscreener=dexOk?{ok:true,at:iso(),error:null}:{ok:false,error:dexErrors.join('; ').slice(0,200)};
      const takeoverStatus=this.state.sources.dexscreenerCommunityTakeovers||{};
      const takeoverLastAttempt=Date.parse(takeoverStatus.lastAttemptAt||'')||0;
      if(Date.now()-takeoverLastAttempt>=300000){
        const attemptedAt=iso();
        try{
          const payload=await json(DEX+'/community-takeovers/latest/v1',{},1,1024*1024);
          const rows=Array.isArray(payload)?payload.filter(row=>String(row?.chainId||'').toLowerCase()==='solana'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(row?.tokenAddress||''))).slice(0,30):[];
          add(rows,'community_takeover');
          this.state.sources.dexscreenerCommunityTakeovers={ok:true,at:iso(),lastAttemptAt:attemptedAt,count:rows.length,error:null,discoveryOnly:true};
        }catch(error){
          this.state.sources.dexscreenerCommunityTakeovers={ok:false,at:iso(),lastAttemptAt:attemptedAt,count:0,error:String(error.message||error).slice(0,160),discoveryOnly:true};
        }
      }
      let geckoCount=0,geckoSuccesses=0;const geckoErrors=[];
      const geckoPageLimit=resolveNewPoolPageLimit(process.env.GECKO_NEW_POOL_PAGES,5);
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
      const archivedBatch=this.archive.selectForScan(this.archiveScanBatch,900000);
      for(const token of archivedBatch){if(!this.state.tokens[token.mint]){this.state.tokens[token.mint]=token;discoveredMints.add(token.mint);}}
      const archivedAddresses=archivedBatch.map(token=>token.mint);
      const archivedMintSet=new Set(archivedAddresses);
      const tracked=topTokens(this.state.tokens,t=>Boolean(t.pairAddress||t.geckoPoolAddress),(a,b)=>n(b.liquidityUsd)-n(a.liquidityUsd),60);
      for(const t of tracked)discoveredMints.add(t.mint);
      // Refresh strong and near-threshold candidates independently of the liquidity leaderboard.
      // This keeps their market snapshots fresh enough for the five-minute Elite opportunity gate.
      const scoreFocus=selectScoreFocusCandidates(this.state.tokens,this.state.scannerSettings?.minScore,30);
      for(const token of scoreFocus)discoveredMints.add(token.mint);
      const socialNow=Date.now();
      const socialCandidates=topTokens(this.state.tokens,
        t=>Boolean(t.socialDiscovery?.lastSeenAt)&&socialNow-Date.parse(t.socialDiscovery.lastSeenAt)<86400000,
        (a,b)=>(Number(b.socialDiscovery?.mentions)||0)-(Number(a.socialDiscovery?.mentions)||0)||Date.parse(b.socialDiscovery?.lastSeenAt||0)-Date.parse(a.socialDiscovery?.lastSeenAt||0),
        40
      );
      for(const token of socialCandidates)discoveredMints.add(token.mint);
      const recentLaunches=topTokens(
        this.state.tokens,
        t=>Boolean(t.launchSource||t.geckoPoolAddress||(t.sources||[]).includes('kol_expert_trade'))&&Date.now()-Date.parse(t.firstSeenAt||t.pumpCreatedAt||t.geckoPoolCreatedAt||0)<86400000,
        (a,b)=>Date.parse(b.firstSeenAt||b.pumpCreatedAt||b.geckoPoolCreatedAt||0)-Date.parse(a.firstSeenAt||a.pumpCreatedAt||a.geckoPoolCreatedAt||0),
        20
      );
      for(const t of recentLaunches)discoveredMints.add(t.mint);
      // Recently published tokens get a reserved market-refresh lane so their
      // Telegram price cards and timed milestones do not depend on score rank.
      const telegramPerformanceMints=selectTelegramPerformanceMints(
        this.state.telegramPerformance,this.state.tokens,Date.now(),40
      );
      const telegramPerformanceMintSet=new Set(telegramPerformanceMints);
      const watchlistAddresses=this.state.watchlist.filter(mint=>this.state.tokens[mint]?.mint).slice(-20);
      const priorityAddresses=[...telegramPerformanceMints,...watchlistAddresses,...scoreFocus.map(t=>t.mint),...socialCandidates.map(t=>t.mint),...archivedAddresses,...tracked.map(t=>t.mint),...recentLaunches.map(t=>t.mint)];
      const freshBatch=selectFreshDiscoveryBatch([...discoveredMints],priorityAddresses,this.state.freshDiscoveryCursor||0,120);
      const freshAddresses=freshBatch.items;
      this.state.freshDiscoveryCursor=freshBatch.nextCursor;
      const addresses=[...new Set([...telegramPerformanceMints,...watchlistAddresses,...scoreFocus.map(t=>t.mint),...archivedAddresses,...tracked.map(t=>t.mint),...freshAddresses,...recentLaunches.map(t=>t.mint)])].slice(0,200);
      let archivedFetchSucceeded=true;
      const marketBatchStats={attemptedBatches:0,succeededBatches:0,pairs:0,snapshots:0,telegramPerformanceRequested:telegramPerformanceMints.length,telegramPerformanceObserved:0,errors:[]};
      for(let i=0;i<addresses.length;i+=30){
        const batchBudget=memoryBudget({maxHeapMiB:460,maxExternalMiB:120,maxRssMiB:800});
        if(!batchBudget.ok){archivedFetchSucceeded=false;this.state.sources.scannerMemory={ok:false,at:iso(),reason:'Rafraîchissement marché interrompu par la garde mémoire',...batchBudget};break;}
        const chunk=addresses.slice(i,i+30);
        const includesArchive=chunk.some(mint=>archivedMintSet.has(mint));
        marketBatchStats.attemptedBatches++;
        try{
          const pairs=await json(DEX+'/tokens/v1/solana/'+chunk.join(','));
          marketBatchStats.succeededBatches++;
          if(!Array.isArray(pairs)){if(includesArchive)archivedFetchSucceeded=false;marketBatchStats.errors.push('Réponse marché non tabulaire');continue;}
          marketBatchStats.pairs+=pairs.length;
          const requestedMints=new Set(chunk);
          const bestByMint=new Map();
          for(const pair of pairs){
            if(pair?.chainId!=='solana')continue;
            // DexScreener can return a requested mint on either side of a pool.
            // Index both sides; pair() normalizes quote-side pricing before snapshotting.
            for(const mint of [pair?.baseToken?.address,pair?.quoteToken?.address]){
              if(!mint||!requestedMints.has(mint))continue;
              const liquidity=Number(pair.liquidity?.usd)||0;
              const previous=bestByMint.get(mint);
              if(!previous||liquidity>(Number(previous.liquidity?.usd)||0))bestByMint.set(mint,pair);
            }
          }
          for(const [mint,pair] of bestByMint){
            if(this.pair(pair,mint))marketBatchStats.snapshots++;
            if(telegramPerformanceMintSet.has(mint)){
              const observedAt=Date.parse(this.state.tokens[mint]?.marketObservedAt||'');
              if(this.state.tokens[mint]?.marketObservationSource==='dexscreener'&&Number.isFinite(observedAt)&&observedAt>=start-1000)marketBatchStats.telegramPerformanceObserved++;
            }
          }
        }catch(error){
          if(includesArchive)archivedFetchSucceeded=false;
          marketBatchStats.errors.push(String(error.message||error).slice(0,140));
          console.warn('[dex pairs]',error.message);
        }
      }
      this.state.sources.dexMarket={ok:marketBatchStats.succeededBatches>0,at:iso(),...marketBatchStats,telegramPerformanceUnobserved:Math.max(0,marketBatchStats.telegramPerformanceRequested-marketBatchStats.telegramPerformanceObserved),error:marketBatchStats.errors.length?marketBatchStats.errors.slice(0,4).join('; '):null,requestedAddresses:addresses.length,mode:'DexScreener /tokens/v1/solana'};
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
      let budget=memoryBudget({maxHeapMiB:440,maxExternalMiB:112,maxRssMiB:760});
      if(budget.ok)await this.securityLeaders();else console.warn('[memory guard] startup security stage deferred',budget);
      budget=memoryBudget({maxHeapMiB:440,maxExternalMiB:112,maxRssMiB:760});
      if(budget.ok)await this.refreshCandidateIntelligence();else console.warn('[memory guard] startup candidate intelligence deferred',budget);
      this.scoreAll();await this.refreshExternalSecurityCandidates(5);this.scoreAll({reuseContext:true});let currentSelection=this.selection();const jupiterCandidates=this.jupiterRefreshCandidates(20);await this.refreshJupiterSignals(jupiterCandidates);this.scoreAll({reuseContext:true});currentSelection=this.selection();updateSelectionCohorts(this.state,currentSelection);stepPaperTrading(this.state,currentSelection,Date.now());await this.alerts();this.save();
      scanCompleted=true;
      return {discovered:discoveredMints.size,total:Object.keys(this.state.tokens).length,durationMs:this.state.lastScanDurationMs};
    }catch(error){
      this.state.lastScanError=String(error.message||error).slice(0,180);
      throw error;
    }finally{
      this.scanning=false;
      if(scanCompleted){
        this.state.lastScanCompletedAt=iso();
        this.state.lastScanCompletedDurationMs=Date.now()-start;
      }
      this.scheduleSave();
    }
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
    // Full parsed transactions can carry large logs/account metadata. Keep each
    // response bounded so sequential sampling cannot accumulate oversized buffers.
    const maxResponseBytes=method==='getTransaction'?1024*1024:2*1024*1024;
    for(const endpoint of ordered){
      const started=Date.now();
      try{
        const data=await json(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})},0,maxResponseBytes);
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
    const token2022Intel=isToken2022?inspectToken2022MintExtensions(b):null;
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
    const rpcEndpoint=String(this.state.sources.solanaRpc?.endpoint||'');
    const rpcProvider=rpcEndpoint.toLowerCase().includes('helius')?'Helius RPC':rpcEndpoint||'Solana RPC';
    const securityCheckedAt=iso();
    t.security={checkedAt:securityCheckedAt,staticCheckedAt:securityCheckedAt,holderCheckedAt:securityCheckedAt,provider:rpcProvider,rpcEndpoint:rpcEndpoint||null,data:{holderCheckedAt:securityCheckedAt,
      mintAuthorityActive:Boolean(mintAuthority),freezeAuthorityActive:Boolean(freezeAuthority),
      mintAuthority,freezeAuthority,tokenProgram,isToken2022,top10HolderPercent,top10AccountPercent,
      top5OwnerPercent:holderIntel.top5OwnerPercent,top1OwnerPercent:holderIntel.top1OwnerPercent,
      uniqueOwnerCount:holderIntel.uniqueOwnerCount,ownerConcentrationAvailable:holderIntel.ownerConcentrationAvailable,
      top20HolderPercent:holderIntel.top20HolderPercent,top20AccountPercent:holderIntel.top20AccountPercent,
      holderGiniTop20:holderIntel.holderGiniTop20,holderHhiTop20:holderIntel.holderHhiTop20,
      effectiveOwnersTop20:holderIntel.effectiveOwnersTop20,holderSampleAccounts:holderIntel.holderSampleAccounts,
      holderSampleOwners:holderIntel.holderSampleOwners,holderSampleCoveragePct:holderIntel.holderSampleCoveragePct,
      unknownOwnerAccounts:holderIntel.unknownOwnerAccounts,
      decimals:b[44],isInitialized:b[45]===1,supply:supply?.value?.uiAmountString||null,
      ...(token2022Intel||{})
    }};
    t.security.hardBlocked=Boolean(freezeAuthority||token2022Intel?.nonTransferable||token2022Intel?.pausablePaused);
    if(persist){this.scoreAll();this.save();}
    return t.security;
  }
  async securityLeaders() {
    if(Date.now()-this.lastSecurity<SECURITY_REFRESH_INTERVAL_MS)return;
    // Run a small batch every scan instead of four checks every five minutes.
    // This advances the initial security pass much faster without parallel RPC
    // payloads or raising the host's existing memory ceiling.
    const budget=memoryBudget({maxHeapMiB:440,maxExternalMiB:112,maxRssMiB:760});
    if(!budget.ok){console.warn('[memory guard] security checks deferred',budget);return;}
    this.lastSecurity=Date.now();
    const leaders=rankSecurityCandidates(Object.values(this.state.tokens),Date.now(),SECURITY_REFRESH_BATCH_SIZE);
    for(const t of leaders){
      t.securityLastAttemptAt=iso();
      try{
        await this.inspectSecurity(t,{persist:false});
        t.securityCheckFailureCount=0;
        t.securityRetryAt=null;
        t.securityCheckError=null;
      }catch(e){
        const failures=Math.min(8,(Number(t.securityCheckFailureCount)||0)+1);
        const retryDelayMs=Math.min(30*60*1000,2*60*1000*Math.pow(2,failures-1));
        t.securityCheckFailureCount=failures;
        t.securityRetryAt=new Date(Date.now()+retryDelayMs).toISOString();
        t.securityCheckError=String(e.message||e).slice(0,180);
        this.state.sources.solanaRpc={ok:false,at:iso(),error:t.securityCheckError,providerCount:this.rpcEndpoints.length,lastFailedMint:t.mint,retryAt:t.securityRetryAt};
        console.warn('[security check]',t.mint,t.securityCheckError,'retry in',Math.round(retryDelayMs/1000),'s');
        // One invalid mint or provider error must not starve every candidate behind it.
        continue;
      }
      // External reputation is optional and refreshed in its own bounded stage;
      // do not serialize an extra network request behind every on-chain audit.
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
    let remainingTransactions=WALLET_REFRESH_MAX_TRANSACTIONS_PER_CYCLE,totalProcessed=0,memoryPaused=false,memoryPauseBudget=null;
    const stableMints=new Set([
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    ]);
    const amount=(rows,mint,owner)=>rows.filter(x=>x.mint===mint&&x.owner===owner).reduce((sum,x)=>sum+Number(x.uiTokenAmount?.amount||0)/Math.pow(10,Number(x.uiTokenAmount?.decimals||0)),0);
    for(const wallet of monitored){
      if(remainingTransactions<=0||memoryPaused)break;
      const walletBudget=memoryBudget({maxHeapMiB:440,maxExternalMiB:100,maxRssMiB:700});
      if(!walletBudget.ok){memoryPaused=true;memoryPauseBudget=walletBudget;break;}
      try{
        const fetchLimit=1000,processLimit=Math.min(WALLET_REFRESH_PER_WALLET_LIMIT,remainingTransactions);
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
          const transactionBudget=memoryBudget({maxHeapMiB:440,maxExternalMiB:100,maxRssMiB:700});
          if(!transactionBudget.ok){memoryPaused=true;memoryPauseBudget=transactionBudget;break;}
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
          const tradeMints=[...changedMints].filter(mint=>!stableMints.has(mint));
          const hasSwapInstruction=hasVerifiedSwapInstruction(tx);
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
          for(const mint of tradeMints){
            mints.add(mint);
            const delta=amount(post,mint,wallet.address)-amount(pre,mint,wallet.address);
            if(Math.abs(delta)<=0)continue;
            const token=this.state.tokens[mint];
            const isCreatorToken=Boolean(wallet.creator&&token?.creatorObservedAtLaunch===true&&token.creator===wallet.address);
            const direction=delta>0?'buy':'sell';
            const swapConfirmed=tradeMints.length===1&&hasSwapInstruction&&(direction==='sell'?Boolean(quoteIn):Boolean(quoteOut));
            const event={
              wallet:wallet.address,mint,signature:signature.signature,
              at:tx.blockTime?new Date(tx.blockTime*1000).toISOString():iso(),
              direction,tokenAmount:Math.abs(delta),
              observedPriceUsd:token?.priceUsd||null,
              role:isCreatorToken?'creator':wallet.automatic?'early_buyer':wallet.creator?'creator_wallet':'tracked_wallet',slot:Number.isFinite(Number(tx.slot))?Number(tx.slot):null,
              creatorToken:isCreatorToken,swapConfirmed,swapEvidenceStatus:swapConfirmed?'verified':(quoteIn||quoteOut?'probable':'unconfirmed'),
              flowType:swapConfirmed?'swap_verified':direction==='sell'?'token_outflow_unconfirmed':'token_inflow_unconfirmed',
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
        remainingTransactions=Math.max(0,remainingTransactions-processedSignatures);totalProcessed+=processedSignatures;
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
    this.state.sources.walletMonitoring={at:iso(),processed:totalProcessed,remainingBudget:remainingTransactions,pausedByMemory:memoryPaused,...(memoryPauseBudget?{memory:memoryPauseBudget}:{})};
    this.scoreAll();this.save();
  }
  async social(mint) {
    const t=this.state.tokens[mint];if(!t)throw new Error('Token introuvable');
    return {configured:true,source:'Bluesky + Nostr + X facultatif + découverte Telegram publique',socials:t.socials||[],websites:t.websites||[],intel:t.socialIntel||this.mergeSocialIntel(t),message:'Mentions publiques Bluesky, Nostr, X si connecté et canaux Telegram publics découverts ou référencés par les métadonnées. Reddit RSS est désactivé; les groupes privés ne sont pas accessibles.'};
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
    const learning=this.learningSummary();
    const calibration=resolveAdaptiveSelectionThreshold(learning.outOfSample,68);
    const settings=this.state.scannerSettings||{};
    const configuredMin=Number(settings.minScore)||80;
    const selection=buildSelection(this.state.tokens,Date.now(),{minScore:configuredMin,settings,adaptiveModel:learning.adaptiveModel});
    selection.adaptiveThreshold={...calibration,threshold:configuredMin,calibrationThreshold:calibration.threshold,configuredThreshold:configuredMin,source:'dashboard_minimum'};
    selection.adaptiveModel={status:learning.adaptiveModel?.status||'insufficient_sample',enabled:learning.adaptiveModel?.enabled===true,observations:learning.adaptiveModel?.observations||0,source:learning.adaptiveModel?.source||'active_cache',generatedAt:learning.adaptiveModel?.generatedAt||null,reason:learning.adaptiveModel?.reason||'En attente de données.'};
    return selection;
  }
  activeAlertThreshold(){
    const configuredThreshold=Number(this.state.scannerSettings?.minScore)||n(process.env.ALERT_MIN_SCORE)||80;
    const outOfSample=this.learningSummary().outOfSample||{};
    const holdout=outOfSample.holdoutAtSelectedThreshold||{};
    const validated=outOfSample.status==='holdout_available'
      &&Number(outOfSample.validation?.tokens)>=20
      &&Number(holdout.tokens)>=20
      &&Number(holdout.positive15Pct)>=55
      &&Number(holdout.averageReturnPct)>0
      &&Number(holdout.loss20Pct)<=25;
    // The dashboard value is a hard user floor. Calibration remains diagnostic
    // and may rank candidates, but it must never silently raise the publication threshold.
    return {threshold:configuredThreshold,source:'dashboard',validated,holdoutTokens:Number(holdout.tokens)||0};
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
      let previewId=null;
      try{
        const publishedMint=extractMintFromAlertId(entry.alertId);
        const publishedToken=publishedMint?this.state.tokens[publishedMint]:null;
        const publishedAlert=this.state.alerts.find(alert=>String(alert.at||'')+':'+String(alert.mint||'')+':'+String(alert.level||'')===entry.alertId);
        const publishedAt=Date.now();
        // Prefer the latest fresh market observation, but fall back to the immutable
        // decision snapshot captured when the alert was selected. This prevents a
        // delayed/alternating token refresh from silently dropping the performance card.
        const baseline=resolveTelegramPublicationBaseline(publishedToken,publishedAlert?.decisionSnapshot,publishedAt);
        const baselineValid=Boolean(baseline);
        if(!baselineValid)throw new Error('Prix de référence indisponible ou trop ancien : publication reportée pour garantir le suivi des performances.');
        const performanceToken=baseline?{
          ...(publishedToken||{}),
          mint:publishedMint,
          name:publishedToken?.name||publishedAlert?.symbol||'MEMECOIN',
          symbol:publishedToken?.symbol||publishedAlert?.symbol||'TOKEN',
          priceUsd:baseline.priceUsd,
          marketObservedAt:new Date(baseline.observedAt).toISOString(),
          marketObservationSource:baseline.source
        }:publishedToken;
        previewId=baselineValid&&this.telegramPreviewBaseUrl?crypto.randomBytes(18).toString('base64url'):null;
        if(previewId){
          const seeds=this.telegramPreviewSeeds;
          for(const [id,seed] of seeds)if(!seed||Number(seed.previewExpiresAt)<=publishedAt)seeds.delete(id);
          while(seeds.size>=25)seeds.delete(seeds.keys().next().value);
          // Publish the exact same baseline to the preview route before Telegram
          // can request it. The seed is replaced by the durable entry after send.
          seeds.set(previewId,{
            previewId,
            tokenName:String(performanceToken?.name||'MEMECOIN'),
            tokenSymbol:String(performanceToken?.symbol||'TOKEN'),
            basePriceUsd:baseline.priceUsd,
            baselineObservedAt:baseline.observedAt,
            publishedAt,
            lastCurrentPriceUsd:baseline.priceUsd,
            lastCurrentObservedAt:baseline.observedAt,
            horizons:{},
            previewExpiresAt:publishedAt+120000
          });
        }
        const previewUrl=previewId?buildTelegramPreviewUrl(this.telegramPreviewBaseUrl,previewId,publishedAt):'';
        if(previewUrl)entry.message=String(entry.message||'')+'\n'+buildTelegramPreviewAnchor(previewUrl);
        const sendOptions={
          ...(entry.parseMode?{parse_mode:entry.parseMode}:{}),
          ...(previewUrl?{link_preview_options:{url:previewUrl,prefer_large_media:true,show_above_text:false}}:{disable_web_page_preview:true}),
          ...(entry.replyMarkup?{reply_markup:entry.replyMarkup}:{})
        };
        const sentMessage=await this.bot.api.sendMessage(entry.chatId,entry.message,sendOptions);
        markTelegramOutboxSent(this.state.telegramOutbox,entry.id);
        markAlertDelivered(this.state.alerts,entry.alertId,entry.chatId);
        try{
          const performanceEntry=createTelegramPerformanceEntry({mint:publishedMint,chatId:entry.chatId,messageId:sentMessage?.message_id,originalMessage:entry.message,replyMarkup:entry.replyMarkup,token:performanceToken,previewId,publishedAt});
          if(performanceEntry){
            this.state.telegramPerformance=Array.isArray(this.state.telegramPerformance)?this.state.telegramPerformance:[];
            this.state.telegramPerformance.push(performanceEntry);
            if(this.state.telegramPerformance.length>MAX_TELEGRAM_PERFORMANCE_TRACKED)this.state.telegramPerformance.splice(0,this.state.telegramPerformance.length-MAX_TELEGRAM_PERFORMANCE_TRACKED);
            if(previewId)this.telegramPreviewSeeds.delete(previewId);
          }
        }catch(performanceError){
          console.warn('[telegram performance] tracking initialization failed:',String(performanceError.message||performanceError).slice(0,180));
        }
        const channel=this.state.telegramChannels.find(row=>row.chatId===entry.chatId);
        if(channel){channel.lastSentAt=iso();channel.lastError=null;}
        sent++;
      }catch(error){
        if(previewId)this.telegramPreviewSeeds.delete(previewId);
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
  async refreshTelegramPerformance(limit=10){
    if(!this.bot||!Array.isArray(this.state.telegramPerformance)||!this.state.telegramPerformance.length)return {edited:0,pending:0};
    const updates=collectTelegramPerformanceUpdates(this.state.telegramPerformance,this.state.tokens,Date.now()).slice(0,Math.max(1,Math.min(10,Number(limit)||10)));
    let edited=0;
    for(const entry of updates){
      const now=Date.now();
      const message=formatTelegramPerformanceMessage(entry,now,this.telegramPreviewBaseUrl);
      const previewUrl=buildTelegramPreviewUrl(this.telegramPreviewBaseUrl,entry.previewId,telegramPerformancePreviewVersion(entry));
      const previewOptions=previewUrl?{link_preview_options:{url:previewUrl,prefer_large_media:true,show_above_text:false}}:{disable_web_page_preview:true};
      try{
        await this.bot.api.editMessageText(entry.chatId,entry.messageId,message,{parse_mode:'HTML',...previewOptions,...(entry.replyMarkup?{reply_markup:entry.replyMarkup}:{})});
        markTelegramPerformanceRendered(entry,Date.now());
        edited++;
      }catch(error){
        const reason=String(error.message||error).slice(0,180);
        if(/message is not modified/i.test(reason)){
          markTelegramPerformanceRendered(entry,Date.now());
          edited++;
        }else{
          entry.lastError=reason;
          console.warn('[telegram performance]',entry.chatId,entry.messageId,reason);
        }
      }
    }
    if(updates.length)this.scheduleSave();
    return {edited,pending:Math.max(0,this.state.telegramPerformance.length-edited)};
  }
  async alerts(){
    this.lastAlertThreshold=this.activeAlertThreshold();
    const threshold=this.lastAlertThreshold.threshold;
    const settings=this.state.scannerSettings||{};
    const tradesByMint=new Map();
    for(const event of this.state.walletTrades||[]){
      if(event.role!=='early_buyer'||event.swapConfirmed!==true||!event.mint)continue;
      let bucket=tradesByMint.get(event.mint);
      if(!bucket){bucket=[];tradesByMint.set(event.mint,bucket);}
      bucket.push(event);
    }
    const now=Date.now();
    for(const t of Object.values(this.state.tokens)){
      t.earlyBuyerExitSummary=this.earlyBuyerExitIntel(t.mint,tradesByMint.get(t.mint)||[],now);
    }
    const selectedBestMints=new Set(this.selection().best.map(candidate=>candidate.mint));
    const watchlist=new Set(Array.isArray(this.state.watchlist)?this.state.watchlist:[]);
    for(const t of Object.values(this.state.tokens)){
      const a=t.analysis||{};
      const exits=t.earlyBuyerExitSummary;
      const marketLinked=Boolean(t.pairAddress||t.geckoPoolAddress);
      const quality=qualifyOpportunity(t,{...settings,now});
      t.opportunityQualification=quality;
      const watchEligible=Boolean(t.analysis&&a.score!==null&&a.coverage>=45&&marketLinked&&!a.hardBlocked&&a.risk!=='high'&&a.risk!=='unknown');
      const critical=(a.flags||[]).some(flag=>flag.level==='critical')||a.hardBlocked===true;
      const previouslyPromoted=(this.state.alerts||[]).some(row=>row.mint===t.mint&&row.level==='opportunity'&&now-Date.parse(row.at||0)<=24*60*60*1000);
      const riskEligible=critical&&settings.publishRisks!==false&&(watchlist.has(t.mint)||previouslyPromoted);
      const evidence=assessOpportunityEvidence(t,now);
      const evidenceFresh=evidence.eligible;
      const opportunityEligible=quality.eligible&&evidenceFresh&&settings.publishOpportunities!==false&&selectedBestMints.has(t.mint);
      const liquidity=n(t.liquidityUsd);
      const proposedLevel=opportunityEligible&&a.score>=threshold?'opportunity':riskEligible?'danger':watchEligible&&a.score>=Math.max(60,threshold-15)?'watch':'none';
      let level=proposedLevel;
      if(exits.alert&&!critical&&level==='none'&&watchEligible)level='watch';
      const qualified=qualifyAlertLevel(t,level,a.score,now);
      level=qualified.level;
      t.signalLevel=level;
      t.signalFreshness=qualified.freshness;
      const reasons=qualified.reason?[qualified.reason]:critical&&riskEligible?(a.flags||[]).filter(flag=>flag.level==='critical').map(flag=>flag.message):level==='opportunity'?(quality.warnings?.length?['Point de vigilance : '+quality.warnings[0]]:['Tous les critères du profil '+(settings.preset||'élite')+' sont validés.']):level==='watch'?['Candidat en observation : critères stricts incomplets.']:quality.reasons.slice(0,5);
      if(exits.alert)reasons.push('Sorties swap-like observées chez '+exits.wallets+' acheteurs précoces suivis en 30 min ('+exits.soldSharePct+'% des achats swap-like suivis estimés).');
      t.signalReasons=reasons;
      if(level==='none')continue;
      const previous=[...this.state.alerts].reverse().find(x=>x.mint===t.mint&&x.level===level);
      const duplicateWindowMs=level==='watch'?3600000:21600000;
      const duplicateWithinWindow=Boolean(previous&&now-Date.parse(previous.at)<duplicateWindowMs);
      const label=level==='danger'?'DANGER':level==='opportunity'?'OPPORTUNITÉ':'À SURVEILLER';
      const message=label+' MEME RADAR : '+(t.symbol||t.mint)+' — '+(a.score??'—')+'/100, couverture '+(a.coverage??'—')+'%, liquidité '+Math.round(liquidity)+' USD';
      const marketView=freshMarketView(t,now);
      const alert=duplicateWithinWindow?previous:{mint:t.mint,symbol:t.symbol||t.mint.slice(0,6),level,score:a.score??null,coverage:a.coverage??null,classification:a.classification||'unknown',flags:a.flags||[],reasons:t.signalReasons,qualification:quality,decisionSnapshot:{capturedAt:now,priceUsd:n(t.priceUsd)||null,marketObservedAt:t.marketObservedAt||null,marketObservationSource:t.marketObservationSource||null,marketFieldObservations:{volumeM5:t.marketFieldsObservedAt?.volumeM5||null,volumeH1:t.marketFieldsObservedAt?.volumeH1||null,volumeH24:t.marketFieldsObservedAt?.volumeH24||null,txnsM5:t.marketFieldsObservedAt?.txnsM5||null,txnsH1:t.marketFieldsObservedAt?.txnsH1||null,priceChangeM5:t.marketFieldsObservedAt?.priceChangeM5||null,priceChangeH1:t.marketFieldsObservedAt?.priceChangeH1||null,priceChangeH24:t.marketFieldsObservedAt?.priceChangeH24||null},liquidityUsd:n(t.liquidityUsd)||null,fdv:n(t.fdv)||null,volume1hUsd:validMarketNumber(marketView.volume?.h1)?Number(marketView.volume.h1):null,buys1h:validMarketNumber(marketView.txns?.h1?.buys)?Number(marketView.txns.h1.buys):null,sells1h:validMarketNumber(marketView.txns?.h1?.sells)?Number(marketView.txns.h1.sells):null,pairCreatedAt:t.pairCreatedAt||t.geckoPoolCreatedAt||t.pumpCreatedAt||null,analysis:{criteriaVersion:a.criteriaVersion||null,legacyScore:a.legacyScore??null,score:a.score??null,coverage:a.coverage??null,launchPhase:a.launchPhase||null,risk:a.risk||null,hardBlocked:a.hardBlocked===true,factors:a.factors&&typeof a.factors==='object'?a.factors:{},flags:Array.isArray(a.flags)?a.flags:[]},securityEvidence:{staticCheckedAt:t.security?.staticCheckedAt||t.security?.checkedAt||null,dynamicHolderCheckedAt:t.security?.holderCheckedAt||t.security?.data?.holderCheckedAt||t.security?.checkedAt||null,holderEvidenceComplete:t.security?.holderEvidenceComplete===true,top10HolderPercent:validMarketNumber(t.security?.data?.top10HolderPercent)?Number(t.security.data.top10HolderPercent):null,unknownOwnerAccounts:validMarketNumber(t.security?.data?.unknownOwnerAccounts)?Number(t.security.data.unknownOwnerAccounts):null},creatorEvidence:{creatorObservedAtLaunch:t.creatorObservedAtLaunch===true,creator:t.creatorObservedAtLaunch===true?t.creator||null:null,creatorFunding:{status:t.creatorFunding?.status||null,funder:t.creatorFunding?.funder||null,checkedAt:t.creatorFunding?.checkedAt||null},creatorReputation:a.eliteIntelligence?.phases?.creatorReputation||null,walletNetwork:a.eliteIntelligence?.phases?.walletNetwork||null},qualification:quality,momentumRisk:evaluateMomentumRisk(marketView),executionEvidence:{exitCapacityUsd:a.exitCapacityUsd??null,quotes:(Array.isArray(t.sellabilityChecks)?t.sellabilityChecks:[]).slice(-3).map(row=>({requestedUsd:n(row.requestedUsd),status:row.status||null,routeAvailable:row.routeAvailable===true,priceImpactPct:Number.isFinite(Number(row.priceImpactPct))?Number(row.priceImpactPct):null,checkedAt:row.checkedAt||null}))},demandEvidence:{tradeIntel:{checkedAt:t.tradeIntel?.checkedAt||null,tradeCount:validMarketNumber(t.tradeIntel?.tradeCount)?Number(t.tradeIntel.tradeCount):null,uniqueBuyers:validMarketNumber(t.tradeIntel?.uniqueBuyers)?Number(t.tradeIntel.uniqueBuyers):null,top5BuyerSharePct:validMarketNumber(t.tradeIntel?.top5BuyerSharePct)?Number(t.tradeIntel.top5BuyerSharePct):null,buyVolumeUsd:validMarketNumber(t.tradeIntel?.buyVolumeUsd)?Number(t.tradeIntel.buyVolumeUsd):null,sellVolumeUsd:validMarketNumber(t.tradeIntel?.sellVolumeUsd)?Number(t.tradeIntel.sellVolumeUsd):null,netBuyVolumeUsd:validMarketNumber(t.tradeIntel?.buyVolumeUsd)&&validMarketNumber(t.tradeIntel?.sellVolumeUsd)?Number((Number(t.tradeIntel.buyVolumeUsd)-Number(t.tradeIntel.sellVolumeUsd)).toFixed(2)):null,sameBlockBuyerClusters:n(t.tradeIntel?.sameBlockBuyerClusters)||0,earlyWindowComplete:t.tradeIntel?.earlyWindow?.complete===true,first70BuyerCohort:{complete:t.tradeIntel?.first70BuyerCohort?.complete===true,observedBuyers:n(t.tradeIntel?.first70BuyerCohort?.observedBuyers)||0,retentionPct:t.tradeIntel?.first70BuyerCohort?.retentionPct!==null&&t.tradeIntel?.first70BuyerCohort?.retentionPct!==undefined&&Number.isFinite(Number(t.tradeIntel.first70BuyerCohort.retentionPct))?Number(t.tradeIntel.first70BuyerCohort.retentionPct):null,retainedInSample:n(t.tradeIntel?.first70BuyerCohort?.retainedInSample)||0,mostlyExitedInSample:n(t.tradeIntel?.first70BuyerCohort?.mostlyExitedInSample)||0}},poolRpc:{checkedAt:t.tradeIntel?.rpcConfirmedCheckedAt||null,lastTradeAt:t.tradeIntel?.rpcConfirmedLastTradeAt||null,confirmedSwaps:validMarketNumber(t.tradeIntel?.rpcConfirmedTradeCount)?Number(t.tradeIntel.rpcConfirmedTradeCount):null,uniqueBuyers:validMarketNumber(t.tradeIntel?.rpcConfirmedUniqueBuyers)?Number(t.tradeIntel.rpcConfirmedUniqueBuyers):null,uniqueSellers:validMarketNumber(t.tradeIntel?.rpcConfirmedUniqueSellers)?Number(t.tradeIntel.rpcConfirmedUniqueSellers):null,buyVolumeUsd:validMarketNumber(t.tradeIntel?.rpcConfirmedBuyVolumeUsd)?Number(t.tradeIntel.rpcConfirmedBuyVolumeUsd):null,sellVolumeUsd:validMarketNumber(t.tradeIntel?.rpcConfirmedSellVolumeUsd)?Number(t.tradeIntel.rpcConfirmedSellVolumeUsd):null,volumeCoveragePct:validMarketNumber(t.tradeIntel?.rpcConfirmedVolumeCoverage)?Number(t.tradeIntel.rpcConfirmedVolumeCoverage):null,source:t.tradeIntel?.rpcConfirmedSource||null},social:{checkedAt:t.socialIntel?.checkedAt||null,score:Number.isFinite(Number(a.factors?.social))?Number(a.factors.social):null,sampledPosts24h:n(t.socialIntel?.evidence?.sampledPosts24h)||0,nonPromotionalPosts24h:n(t.socialIntel?.evidence?.nonPromotionalPosts24h)||0,uniqueAuthors24h:n(t.socialIntel?.evidence?.uniqueAuthors24h)||0,uniqueChannels24h:n(t.socialIntel?.evidence?.uniqueChannels24h)||0,uniqueSources24h:n(t.socialIntel?.evidence?.uniqueSources24h)||0,independentEntities24h:n(t.socialIntel?.evidence?.independentEntities24h)||0,exactMatchSharePct:Number.isFinite(Number(t.socialIntel?.evidence?.exactMatchSharePct))?Number(t.socialIntel.evidence.exactMatchSharePct):null,duplicateSharePct:n(t.socialIntel?.evidence?.duplicateSharePct)||0},walletReputation:{qualified:t.walletReputation?.qualified===true,score:Number.isFinite(Number(t.walletReputation?.score))?Number(t.walletReputation.score):null},earlyBuyerSignalScore:Number.isFinite(Number(a.factors?.earlyBuyerSignal))?Number(a.factors.earlyBuyerSignal):null},earlyBuyerExitSummary:exits},at:iso(),message,telegramSentTo:[]};
      if(!duplicateWithinWindow)this.state.alerts.push(alert);
      // A recent alert may have been recorded while Telegram was not configured
      // or while every channel was disabled. Reconcile its delivery on later
      // scans instead of letting the duplicate cooldown silently discard it.
      if(this.bot&&level==='opportunity'){
        const channels=normalizeTelegramChannels(this.state.telegramChannels);
        this.state.telegramChannels=channels;
        const publication=formatTelegramAlert(t,level);
        const replyMarkup=buildTelegramAlertKeyboard(t);
        const queued=queueAlertForChannels({alert,channels,outbox:this.state.telegramOutbox,message:publication,replyMarkup,now:iso()});
        if(queued)this.scheduleSave();
      }
      if(duplicateWithinWindow)continue;
    }
    // Drain on every scan, including scans that did not create a new alert.
    if(this.bot){await this.drainTelegramOutbox();await this.refreshTelegramPerformance();}
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
      reddit:{ok:true,disabled:true,retired:true,critical:false,detail:'Source retirée; non utilisée par le scanner.'},
      bluesky:{ok:status.bluesky.connected===true,critical:false,lastSuccess:status.bluesky.lastSuccess,error:status.bluesky.lastError},
      nostr:{ok:status.nostr?.connected===true,critical:false,lastSuccess:status.nostr?.lastSuccess||null,error:status.nostr?.lastError||null},
      telegramSocial:{ok:status.telegramSocial?.connected===true,critical:false,lastSuccess:status.telegramSocial?.lastSuccess||null,error:status.telegramSocial?.lastError||null},
      xSocial:{ok:status.xSocial?.connected===true,critical:false,lastSuccess:status.xSocial?.lastSuccess||null,error:status.xSocial?.lastError||null,detail:status.xSocial?.mode||'Recherche X facultative'}
    };
    return {state:Object.values(checks).filter(x=>x.critical).every(x=>x.ok)?'healthy':'degraded',checks,checkedAt:iso(),note:'La disponibilité des sources externes est mesurée séparément; une source publique peut être temporairement indisponible.'};
  }
  overview(){const a=Object.values(this.state.tokens),archive=this.archive.summary();return {ok:true,narratives:narrativeSummary(a),eliteIntelligence:buildEliteIntelligenceIndexSummary(this.state,this.learningSummary()),social:{redditPosts:0,redditDisabled:true,matchedTokens:a.filter(t=>(t.socialIntel?.mentions24h||0)>0).length},stats:{tracked:a.length,archived:archive.tokens,totalStored:a.length+archive.tokens,archiveAvailable:archive.available,autoWallets:(this.state.autoWallets||[]).length,activePairs:a.filter(t=>t.pairAddress||t.geckoPoolAddress).length,recentLaunches:a.filter(t=>(t.launchSource||t.geckoPoolAddress)&&Date.now()-Date.parse(t.firstSeenAt||t.pumpCreatedAt||t.geckoPoolCreatedAt||0)<86400000).length,migrations:a.filter(t=>t.migrated).length,highSignals:a.filter(t=>t.analysis?.score>=75&&t.analysis?.coverage>=45&&!t.analysis?.hardBlocked).length,blocked:a.filter(t=>t.analysis?.hardBlocked).length,alerts:this.state.alerts.length},archive,lastScanAt:this.state.lastScanAt,lastScanDurationMs:this.state.lastScanDurationMs||null,sources:this.status(),thresholds:{minLiquidityUsd:Number(this.state.scannerSettings?.minLiquidityUsd)||n(process.env.MIN_LIQUIDITY_USD)||5000,alertMinScore:this.lastAlertThreshold.threshold,alertThresholdSource:this.lastAlertThreshold.source,scannerSettings:this.state.scannerSettings},scannerRunning:this.running};}
  addWatch(mint){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint||'')))throw new Error('Adresse Solana invalide');if(!this.state.watchlist.includes(mint))this.state.watchlist.push(mint);this.save();return this.state.watchlist;}
  removeWatch(mint){this.state.watchlist=this.state.watchlist.filter(x=>x!==mint);this.save();return this.state.watchlist;}
  addWallet(address,label=''){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address||'')))throw new Error('Adresse wallet Solana invalide');if(!this.state.wallets.some(x=>x.address===address)){if(this.state.wallets.length>=10)throw new Error('Limite de 10 wallets suivis pour maîtriser les quotas RPC publics');this.state.wallets.push({address,label:String(label).slice(0,60),addedAt:iso()});}this.save();return this.state.wallets;}
  removeWallet(address){this.state.wallets=this.state.wallets.filter(x=>x.address!==address);this.save();return this.state.wallets;}
}
Object.assign(MemeScanner.prototype,require('./intelligence'),require('./historical-benchmark'),require('./learning'),require('./external-security'),require('./wallet-graph'),require('./data-quality'),require('./wallet-signal-backtest'));
Object.assign(MemeScanner.prototype,require('./publication-diagnostics'));
module.exports={MemeScanner,buildRpcEndpoints,memoryBudget};
