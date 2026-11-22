'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { analyzeLargestHolders } = require('./holder-intel');
const { LaunchStream } = require('./launch-stream');
const { analyzeMicrostructure } = require('./market-intel');
const { narrativeSummary } = require('./narratives');
const DEX = 'https://api.dexscreener.com';
const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet.solana.com';
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const clamp = v => Math.max(0, Math.min(100, n(v)));
const iso = () => new Date().toISOString();
const wait = ms => new Promise(r => setTimeout(r, ms));
async function json(url, options = {}, retries = 1) {
  let error;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
      if ((r.status === 429 || r.status >= 500) && i < retries) { await wait(500 * (i + 1)); continue; }
      const body = await r.text();
      let data; try { data = body ? JSON.parse(body) : {}; } catch { throw new Error('Réponse JSON invalide (' + r.status + ')'); }
      if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + String(data.message || data.error || r.statusText).slice(0, 160));
      return data;
    } catch (e) { error = e; if (i < retries && (e.name === 'TimeoutError' || e.name === 'TypeError')) { await wait(300 * (i + 1)); continue; } break; }
  }
  throw error || new Error('Source indisponible');
}
function fresh() { return { version: 2, tokens: {}, alerts: [], watchlist: [], wallets: [], walletActivity: {}, sources: {}, lastScanAt: null }; }
class MemeScanner {
  constructor({ dataFile, bot, telegramChatId }) {
    this.file = dataFile || path.join(__dirname, '..', 'data', 'store.json');
    try { this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { try { this.state = JSON.parse(fs.readFileSync(this.file + '.bak', 'utf8')); this.state.recoveredFromBackup = true; } catch { this.state = fresh(); } }
    this.state.walletTrades ||= []; for (const k of ['tokens', 'walletActivity', 'sources']) this.state[k] ||= {};
    for (const k of ['alerts', 'watchlist', 'wallets']) this.state[k] ||= [];
    this.bot = bot || null; this.chat = String(telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    this.running = false; this.timer = null; this.walletTimer = null; this.lastSecurity = 0;
    this.launchStream = new LaunchStream({ onToken: event => this.ingestLaunch(event), onMigration: event => this.ingestMigration(event) });
  }
  save() {
    this.state.updatedAt = iso();
    this.state.tokens = Object.fromEntries(Object.entries(this.state.tokens).sort((a,b) => String(b[1].updatedAt || '').localeCompare(String(a[1].updatedAt || ''))).slice(0,1200));
    this.state.alerts = this.state.alerts.slice(-500); this.state.walletTrades = (this.state.walletTrades||[]).slice(-5000); this.state.watchlist = this.state.watchlist.slice(-300); this.state.wallets = this.state.wallets.slice(-100);
    fs.mkdirSync(path.dirname(this.file), { recursive:true, mode:0o700 });
    const tmp = this.file + '.' + process.pid + '.tmp';
    if (fs.existsSync(this.file)) {
      try {
        JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const backup=this.file+'.bak';
        const backupDue=!fs.existsSync(backup)||Date.now()-fs.statSync(backup).mtimeMs>3600000;
        if(backupDue)fs.copyFileSync(this.file,backup);
      } catch {}
    }
    fs.writeFileSync(tmp, JSON.stringify(this.state), { mode:0o600 }); fs.renameSync(tmp, this.file);
  }
  status() {
    const src=this.state.sources;
    return {
      dexscreener:{configured:true,connected:src.dexscreener?.ok===true,lastSuccess:src.dexscreener?.at||null,error:src.dexscreener?.error||null,mode:'API publique gratuite'},
      solanaRpc:{configured:true,connected:src.solanaRpc?.ok===true,lastSuccess:src.solanaRpc?.at||null,error:src.solanaRpc?.error||null,mode:'RPC public Solana · sécurité et wallets'},
      pumpPortal:this.launchStream.status(),
      telegram:{configured:Boolean(this.bot&&this.chat),connected:Boolean(this.bot&&this.chat),mode:'Alertes Telegram (gratuit)'}
    };
  }
  async start() {
    if (this.running) return; this.running = true;
    await this.scan().catch(e => console.error('[scan]', e.message));
    this.timer = setInterval(() => this.scan().catch(e => console.error('[scan]', e.message)), Math.max(30000,n(process.env.SCAN_INTERVAL_MS)||60000));
    this.walletTimer = setInterval(() => this.refreshWallets().catch(e => console.error('[wallets]',e.message)),600000);
    this.launchStream.start();
    this.refreshWallets().catch(e => console.error('[wallets]',e.message));
  }
  stop() { this.running=false; clearInterval(this.timer); clearInterval(this.walletTimer); this.launchStream.stop(); }
  upsert(item, source) {
    const mint = String(item.tokenAddress || item.mint || ''); if (!mint) return;
    const t = this.state.tokens[mint] || { mint, sources:[], smartMoney:{hits:0,wallets:[]} };
    if (!t.sources.includes(source)) t.sources.push(source);
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
    const t=this.state.tokens[mint]||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    if(!t.sources.includes('pumpportal_new_token'))t.sources.push('pumpportal_new_token');
    t.name=String(event.name||t.name||'Token sans nom').slice(0,100);
    t.symbol=String(event.symbol||t.symbol||'—').slice(0,24);
    t.creator=String(event.traderPublicKey||event.creator||t.creator||'');
    t.tokenUri=String(event.uri||event.metadataUri||t.tokenUri||'').slice(0,500);
    t.pumpCreatedAt=t.pumpCreatedAt||new Date(Number(event.timestamp)>1e12?Number(event.timestamp):Number(event.timestamp)>0?Number(event.timestamp)*1000:Date.now()).toISOString();
    t.firstSeenAt=t.firstSeenAt||iso();
    t.launchSource='Pump.fun';t.launchObservedVia=t.migrated?'creation_and_migration':'creation_event';
    t.launchData={initialBuyTokens:Number(event.initialBuy||0)||null,marketCapSol:Number(event.marketCapSol||0)||null,bondingCurveSol:Number(event.vSolInBondingCurve||0)/1e9||null,bondingCurveTokens:Number(event.vTokensInBondingCurve||0)/1e6||null,bondingCurveKey:String(event.bondingCurveKey||''),signature:String(event.signature||''),observedAt:iso()};
    t.launchAgeHours=Math.max(0,(Date.now()-Date.parse(t.pumpCreatedAt))/3600000);t.ageHours=t.launchAgeHours;
    t.updatedAt=iso();this.state.tokens[mint]=t;
  }
  ingestMigration(event) {
    const mint=String(event.mint||event.tokenAddress||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return;
    const t=this.state.tokens[mint]||{mint,sources:[],smartMoney:{hits:0,wallets:[]}};
    if(!t.sources.includes('pumpportal_migration'))t.sources.push('pumpportal_migration');
    t.launchSource=t.launchSource||'Pump.fun';t.firstSeenAt=t.firstSeenAt||iso();t.launchObservedVia=t.launchObservedVia==='creation_event'?'creation_and_migration':(t.launchObservedVia||'migration_only');
    t.migratedAt=iso();t.migrated=true;t.migrationPool=String(event.pool||event.poolAddress||'').slice(0,100);
    t.updatedAt=iso();this.state.tokens[mint]=t;
  }
  pair(p) {
    const mint=p?.baseToken?.address; if(!mint||p.chainId!=='solana') return;
    const t=this.state.tokens[mint]||{mint,sources:['dex_pair'],smartMoney:{hits:0,wallets:[]}};
    t.name=p.baseToken.name||t.name||'Unknown';t.symbol=p.baseToken.symbol||t.symbol||'—';t.pairAddress=p.pairAddress||t.pairAddress;t.dexUrl=p.url||t.dexUrl;
    t.priceUsd=n(p.priceUsd);t.liquidityUsd=n(p.liquidity?.usd);t.fdv=n(p.fdv);t.marketCap=n(p.marketCap||p.fdv);t.volume=p.volume||{};t.txns=p.txns||{};t.priceChange=p.priceChange||{};
    t.pairCreatedAt=n(p.pairCreatedAt)||t.pairCreatedAt||null;t.ageHours=t.pairCreatedAt?Math.max(0,(Date.now()-t.pairCreatedAt)/3600000):null;
    t.socials=p.info?.socials||t.socials||[];t.websites=p.info?.websites||t.websites||[];t.imageUrl=p.info?.imageUrl||t.imageUrl;
    t.history=Array.isArray(t.history)?t.history:[];
    const currentAnalysis=this.score(t);const snap={at:Date.now(),priceUsd:t.priceUsd,liquidityUsd:t.liquidityUsd,volume1h:n(t.volume.h1),volume24h:n(t.volume.h24),buys1h:n(t.txns.h1?.buys),sells1h:n(t.txns.h1?.sells),fdv:t.fdv,score:currentAnalysis.score,coverage:currentAnalysis.coverage,classification:currentAnalysis.classification,risk:currentAnalysis.risk,flags:currentAnalysis.flags||[]};
    const last=t.history[t.history.length-1];if(!last||snap.at-last.at>=45000){t.history.push(snap);t.history=t.history.slice(-100);this.recordForecast(t,snap);}
    t.updatedAt=iso();this.state.tokens[mint]=t;
  }
  score(t) {
    const weights={activity:20,momentum:20,market:15,liquidityQuality:15,security:15,smartMoney:10,timing:5},f={};
    const microstructure=analyzeMicrostructure(t);
    const h=t.txns?.h1,buys=n(h?.buys),sells=n(h?.sells),total=buys+sells,vol1=n(t.volume?.h1),vol24=n(t.volume?.h24),liq=n(t.liquidityUsd),fdv=n(t.fdv||t.marketCap);
    if(h&&total>0){f.activity=clamp(Math.log10(total+1)*34+Math.log10(vol1+1)*17);const ratio=buys/total;const hist=Array.isArray(t.history)?t.history:[];const prior=hist.length>=2?hist[hist.length-2]:null;const accel=prior?total/Math.max(1,prior.buys1h+prior.sells1h)-1:null;f.momentum=clamp(clamp((ratio-.35)/.45*100)*.65+(accel===null?50:clamp(50+accel*25))*.35);if(microstructure.score!==null)f.momentum=clamp(f.momentum*.75+microstructure.score*.25);f.buyRatio=Number((ratio*100).toFixed(1));f.buySellRatio=Number((buys/Math.max(1,sells)).toFixed(2));}else if(microstructure.score!==null)f.momentum=microstructure.score;
    if(t.liquidityUsd!==undefined&&t.volume?.h24!==undefined)f.market=clamp(Math.sqrt(Math.max(0,liq))*.055+Math.log10(vol24+1)*17);
    if(liq>0){const ratio=fdv>0?fdv/liq:null,turnover=vol1/liq,hist=Array.isArray(t.history)?t.history:[],prior=hist.length>=2?hist[hist.length-2]:null,change=prior&&prior.liquidityUsd>0?(liq/prior.liquidityUsd-1)*100:null;f.liquidityQuality=clamp(clamp(100-Math.abs(turnover-.35)*90)*.45+(change===null?50:clamp(50+change*2))*.35+(100-(ratio===null?0:clamp((ratio-5)*4)))*.2);t.metrics={volumeToLiquidity:Number(turnover.toFixed(3)),fdvToLiquidity:ratio===null?null:Number(ratio.toFixed(2)),liquidityChangePct:change===null?null:Number(change.toFixed(2)),priceChangeSincePrevious:prior&&prior.priceUsd>0?Number(((t.priceUsd/prior.priceUsd-1)*100).toFixed(2)):null};}
    if(t.smartMoney?.hits>0)f.smartMoney=clamp(40+t.smartMoney.hits*15);
    if(t.security?.checkedAt){const sec=t.security.data||{},known=sec.freezeAuthorityActive!==undefined||sec.mintAuthorityActive!==undefined||sec.top10HolderPercent!==undefined,freeze=sec.freezeAuthorityActive===true,top=Number.isFinite(Number(sec.top10HolderPercent))?Number(sec.top10HolderPercent):null,flags=[freeze,sec.mintAuthorityActive===true,top!==null&&top>=70].filter(Boolean).length;t.security.hardBlocked=freeze||(top!==null&&top>=85);t.security.risk=!known?'unknown':t.security.hardBlocked?'high':flags?'medium':'observations_only';if(known)f.security=clamp(100-flags*25-(top!==null&&top>=50?20:0));}
    if(t.launchSource&&t.pumpCreatedAt)t.launchAgeHours=Math.max(0,(Date.now()-Date.parse(t.pumpCreatedAt))/3600000);const ageForTiming=t.launchSource&&Number.isFinite(Number(t.launchAgeHours))?Number(t.launchAgeHours):t.ageHours;if(ageForTiming!==null&&ageForTiming!==undefined)f.timing=clamp(100-Math.max(0,ageForTiming-1)*4);
    const available=Object.entries(weights).filter(([k])=>Number.isFinite(f[k])),coverage=available.reduce((sum,[k])=>sum+weights[k],0),score=coverage?Math.round(available.reduce((sum,[k])=>sum+f[k]*weights[k],0)/coverage):null;
    const flags=[...microstructure.flags];if(t.security?.data?.isToken2022===true)flags.push({level:'warning',code:'TOKEN_2022_REVIEW',message:'Token-2022 détecté : les extensions doivent être vérifiées séparément.'});if(t.security?.data?.freezeAuthorityActive===true)flags.push({level:'critical',code:'FREEZE_AUTHORITY',message:'Freeze authority active'});if(t.security?.data?.mintAuthorityActive===true)flags.push({level:'warning',code:'MINT_AUTHORITY',message:'Mint authority active'});if(Number(t.security?.data?.top10HolderPercent)>=70)flags.push({level:Number(t.security.data.top10HolderPercent)>=85?'critical':'warning',code:'HOLDER_CONCENTRATION',message:'Top 10 wallets concentration: '+t.security.data.top10HolderPercent+'%'});if(Number(t.security?.data?.top1OwnerPercent)>=20)flags.push({level:Number(t.security.data.top1OwnerPercent)>=35?'critical':'warning',code:'TOP1_WALLET_CONCENTRATION',message:'One wallet controls '+t.security.data.top1OwnerPercent+'% of supply'});if(Number(t.security?.data?.top5OwnerPercent)>=50)flags.push({level:'warning',code:'TOP5_WALLET_CONCENTRATION',message:'Top 5 wallets control '+t.security.data.top5OwnerPercent+'% of supply'});if(liq>0&&fdv>0&&fdv/liq>30)flags.push({level:'warning',code:'HIGH_FDV_LIQUIDITY',message:'FDV / liquidity ratio is unusually high'});if(total>=10&&buys/total<.4)flags.push({level:'warning',code:'SELL_PRESSURE',message:'Sell transactions dominate recent activity'});if(t.metrics?.liquidityChangePct!==null&&t.metrics?.liquidityChangePct!==undefined&&t.metrics.liquidityChangePct< -15)flags.push({level:'critical',code:'LIQUIDITY_DROP',message:'Liquidity dropped more than 15% between observations'});if(t.ageHours!==null&&t.ageHours!==undefined&&t.ageHours<1&&liq<3000)flags.push({level:'warning',code:'THIN_NEW_POOL',message:'Very new pool with low liquidity'});
    const hardBlocked=Boolean(t.security?.hardBlocked||flags.some(x=>x.level==='critical'&&x.code==='LIQUIDITY_DROP'));
    return {score,coverage,factors:f,marketSignals:microstructure.metrics,hardBlocked,risk:hardBlocked||flags.some(x=>x.level==='critical')?'high':flags.some(x=>x.level==='warning')?'medium':t.security?.risk||'unknown',confidence:coverage>=70?'high':coverage>=45?'medium':'low',flags,classification:score===null?'insufficient_data':coverage<45?'low_confidence':hardBlocked?'blocked':score>=80?'strong_candidate':score>=65?'watch':'weak'};
  }
  scoreAll(){for(const t of Object.values(this.state.tokens))t.analysis=this.score(t);}
  async scan(){
    if(this.scanning)return {skipped:true};this.scanning=true;const start=Date.now();
    try{
      const results=await Promise.allSettled([json(DEX+'/token-profiles/latest/v1'),json(DEX+'/token-boosts/latest/v1'),json(DEX+'/token-boosts/top/v1')]);
      const map=new Map();const add=(arr,source)=>{if(!Array.isArray(arr))return;for(const x of arr){if(String(x.chainId).toLowerCase()!=='solana'||!x.tokenAddress)continue;map.set(x.tokenAddress,{...map.get(x.tokenAddress),...x});this.upsert(x,source);}};
      if(results[0].status==='fulfilled')add(results[0].value,'profile');if(results[1].status==='fulfilled')add(results[1].value,'boost');if(results[2].status==='fulfilled')add(results[2].value,'top_boost');
      const ok=results.some(x=>x.status==='fulfilled');this.state.sources.dexscreener=ok?{ok:true,at:iso(),error:null}:{ok:false,error:results.map(x=>x.reason?.message).filter(Boolean).join('; ').slice(0,200)};
      const tracked=Object.values(this.state.tokens).filter(t=>t.pairAddress).sort((a,b)=>n(b.liquidityUsd)-n(a.liquidityUsd)).slice(0,100);for(const t of tracked)map.set(t.mint,{tokenAddress:t.mint});
      for(const t of Object.values(this.state.tokens))if(t.launchSource&&Date.now()-Date.parse(t.firstSeenAt||t.pumpCreatedAt||0)<86400000)map.set(t.mint,{tokenAddress:t.mint});for(const mint of this.state.watchlist)if(this.state.tokens[mint]?.mint)map.set(mint,{tokenAddress:mint});
      const addresses=[...map.keys()];for(let i=0;i<addresses.length;i+=30){try{const pairs=await json(DEX+'/tokens/v1/solana/'+addresses.slice(i,i+30).join(','));if(Array.isArray(pairs))pairs.forEach(p=>this.pair(p));}catch(e){console.warn('[dex pairs]',e.message);}}
      this.state.lastScanAt=iso();this.state.lastScanDurationMs=Date.now()-start;this.scoreAll();await this.securityLeaders();this.scoreAll();await this.alerts();this.save();return {discovered:map.size,total:Object.keys(this.state.tokens).length,durationMs:this.state.lastScanDurationMs};
    }finally{this.scanning=false;}
  }
  async rpc(method,params=[]) {
    const data=await json(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})},1);
    if(data.error)throw new Error(data.error.message||'Erreur RPC Solana');
    this.state.sources.solanaRpc={ok:true,at:iso(),error:null};
    return data.result;
  }
  async inspectSecurity(t) {
    if(!t?.mint)throw new Error('Adresse du token absente');
    const [mint,largest,supply]=await Promise.all([
      this.rpc('getAccountInfo',[t.mint,{encoding:'base64',commitment:'confirmed'}]),
      this.rpc('getTokenLargestAccounts',[t.mint,{commitment:'confirmed'}]),
      this.rpc('getTokenSupply',[t.mint,{commitment:'confirmed'}])
    ]);
    const raw=mint?.value?.data?.[0];
    if(!raw)throw new Error('Compte mint introuvable ou fermé');
    const b=Buffer.from(raw,'base64');
    if(b.length<82)throw new Error('Compte mint SPL invalide');
    const mintAuthority=b.readUInt32LE(0)!==0?b.subarray(4,36).toString('hex'):null;
    const tokenProgram=String(mint?.value?.owner||'unknown');
    const isToken2022=tokenProgram==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    const freezeAuthority=b.readUInt32LE(46)!==0?b.subarray(50,82).toString('hex'):null;
    const rows=(largest?.value||[]).slice(0,20);
    let holderIntel={top10HolderPercent:null,top10AccountPercent:null,top5OwnerPercent:null,top1OwnerPercent:null,uniqueOwnerCount:0,ownerConcentrationAvailable:false};
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
    const top10HolderPercent=holderIntel.top10HolderPercent??top10AccountPercent;
    t.security={checkedAt:iso(),provider:'Solana RPC public',data:{
      mintAuthorityActive:Boolean(mintAuthority),freezeAuthorityActive:Boolean(freezeAuthority),
      mintAuthority,freezeAuthority,tokenProgram,isToken2022,top10HolderPercent,top10AccountPercent,
      top5OwnerPercent:holderIntel.top5OwnerPercent,top1OwnerPercent:holderIntel.top1OwnerPercent,
      uniqueOwnerCount:holderIntel.uniqueOwnerCount,ownerConcentrationAvailable:holderIntel.ownerConcentrationAvailable,
      decimals:b[44],isInitialized:b[45]===1,supply:supply?.value?.uiAmountString||null
    }};
    t.security.hardBlocked=Boolean(freezeAuthority)||top10HolderPercent!==null&&top10HolderPercent>=85;
    this.scoreAll();this.save();return t.security;
  }
  async securityLeaders() {
    if(Date.now()-this.lastSecurity<600000)return;
    this.lastSecurity=Date.now();
    const leaders=Object.values(this.state.tokens).filter(t=>t.pairAddress&&(!t.security?.checkedAt||Date.now()-Date.parse(t.security.checkedAt)>3600000))
      .sort((a,b)=>Number(Boolean(b.launchSource))-Number(Boolean(a.launchSource))||n(b.liquidityUsd)-n(a.liquidityUsd)).slice(0,5);
    for(const t of leaders){
      try{await this.inspectSecurity(t);}catch(e){this.state.sources.solanaRpc={ok:false,error:e.message.slice(0,180)};break;}
      try{await this.inspectExternalSecurity(t);}catch(e){console.warn('[external security]',e.message);}
    }
  }
  async refreshWallets() {
    if(!this.state.wallets.length)return;
    for(const w of this.state.wallets.slice(0,10)){
      try{
        const sigs=await this.rpc('getSignaturesForAddress',[w.address,{limit:5,commitment:'confirmed'}]);
        const mints=new Set();
        for(const sig of (sigs||[]).slice(0,5)){
          const tx=await this.rpc('getTransaction',[sig.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
          const pre=tx?.meta?.preTokenBalances||[],post=tx?.meta?.postTokenBalances||[],all=new Set([...pre,...post].map(x=>x.mint).filter(Boolean));for(const mint of all){mints.add(mint);const amount=(rows)=>rows.filter(x=>x.mint===mint&&x.owner===w.address).reduce((sum,x)=>sum+Number(x.uiTokenAmount?.amount||0)/Math.pow(10,Number(x.uiTokenAmount?.decimals||0)),0);const delta=amount(post)-amount(pre);if(Math.abs(delta)>0){this.state.walletTrades ||= [];const event={wallet:w.address,mint,signature:sig.signature,at:tx.blockTime?new Date(tx.blockTime*1000).toISOString():iso(),direction:delta>0?'buy':'sell',tokenAmount:Math.abs(delta),observedPriceUsd:this.state.tokens[mint]?.priceUsd||null};const exists=this.state.walletTrades.some(x=>x.signature===event.signature&&x.wallet===event.wallet&&x.mint===event.mint);if(!exists)this.state.walletTrades.push(event);}}
        }
        this.state.walletActivity[w.address]={at:iso(),mints:[...mints].slice(0,50)};
        for(const mint of mints){const t=this.state.tokens[mint];if(t){t.smartMoney ||= {hits:0,wallets:[]};if(!t.smartMoney.wallets.includes(w.address))t.smartMoney.wallets.push(w.address);t.smartMoney.hits=t.smartMoney.wallets.length;t.smartMoney.lastSeenAt=iso();}}
      }catch(e){this.state.walletActivity[w.address]={at:iso(),error:e.message.slice(0,160)};this.state.sources.solanaRpc={ok:false,error:e.message.slice(0,180)};}
    }
    this.scoreAll();this.save();
  }
  async social(mint) {
    const t=this.state.tokens[mint];if(!t)throw new Error('Token introuvable');
    return {configured:true,source:'Métadonnées DexScreener',socials:t.socials||[],websites:t.websites||[],message:'Liens publics uniquement; aucune mesure de mentions ou d’engagement.'};
  }
  async detail(mint) {
    const t=this.state.tokens[mint];if(!t)throw new Error('Token absent du scanner');
    try{const pairs=await json(DEX+'/token-pairs/v1/solana/'+encodeURIComponent(mint),{},0);if(Array.isArray(pairs)&&pairs.length){pairs.sort((a,b)=>n(b.liquidity?.usd)-n(a.liquidity?.usd));this.pair(pairs[0]);}}catch(e){t.detailError=e.message;}
    if(!t.security?.checkedAt||Date.now()-Date.parse(t.security.checkedAt)>300000){try{await this.inspectSecurity(t);}catch(e){t.security={checkedAt:iso(),provider:'Solana RPC public',error:e.message};}}
    await this.inspectExternalSecurity(t);
    this.scoreAll();this.save();return t;
  }
  async alerts(){
    const configuredThreshold=n(process.env.ALERT_MIN_SCORE)||78;
    const learnedThreshold=this.learningSummary().adaptiveThreshold;
    const threshold=learnedThreshold??configuredThreshold;
    const minLiq=n(process.env.MIN_LIQUIDITY_USD)||5000;
    for(const t of Object.values(this.state.tokens)){
      const a=t.analysis;
      if(!a||a.score===null||a.coverage<45||!t.pairAddress){t.signalLevel='none';continue;}
      const critical=(a.flags||[]).some(flag=>flag.level==='critical')||a.hardBlocked;
      const liquidity=n(t.liquidityUsd);
      const level=critical?'danger':a.score>=threshold&&liquidity>=minLiq?'opportunity':a.score>=60&&liquidity>=Math.min(minLiq,1500)?'watch':'none';
      t.signalLevel=level;
      t.signalReasons=critical?(a.flags||[]).filter(flag=>flag.level==='critical').map(flag=>flag.message):level==='opportunity'?['Score élevé, couverture suffisante et liquidité minimale atteinte']:level==='watch'?['Premiers signaux intéressants, confirmation encore nécessaire']:[];
      if(level==='none')continue;
      const previous=[...this.state.alerts].reverse().find(x=>x.mint===t.mint&&x.level===level);
      if(previous&&Date.now()-Date.parse(previous.at)<(level==='watch'?3600000:21600000))continue;
      const label=level==='danger'?'DANGER':level==='opportunity'?'OPPORTUNITÉ':'À SURVEILLER';
      const message=label+' MEME RADAR : '+(t.symbol||t.mint)+' — '+a.score+'/100, couverture '+a.coverage+'%, liquidité '+Math.round(liquidity)+' USD';
      const alert={mint:t.mint,symbol:t.symbol||t.mint.slice(0,6),level,score:a.score,coverage:a.coverage,classification:a.classification,flags:a.flags||[],reasons:t.signalReasons,at:iso(),message};
      this.state.alerts.push(alert);
      if(this.bot&&this.chat&&level!=='watch'){
        const caution=level==='danger'?'Risque détecté : vérifie le token avant toute décision.':'Signal de recherche uniquement, aucune recommandation d’achat.';
        await this.bot.api.sendMessage(this.chat,message+'\n'+(t.dexUrl||'https://dexscreener.com/solana/'+t.mint)+'\n'+caution).catch(e=>console.error('[telegram]',e.message));
      }
    }
  }
  tokens({sort='score',limit=100,search='',includeBlocked=true}={}){let a=Object.values(this.state.tokens).filter(t=>(includeBlocked||!t.analysis?.hardBlocked)&&(!search||((t.name||'')+' '+(t.symbol||'')+' '+t.mint).toLowerCase().includes(search.toLowerCase())));const sorters={score:(x,y)=>n(y.analysis?.score)-n(x.analysis?.score),liquidity:(x,y)=>n(y.liquidityUsd)-n(x.liquidityUsd),volume:(x,y)=>n(y.volume?.h24)-n(x.volume?.h24),newest:(x,y)=>(n(y.pairCreatedAt)||Date.parse(y.pumpCreatedAt||y.updatedAt)||0)-(n(x.pairCreatedAt)||Date.parse(x.pumpCreatedAt||x.updatedAt)||0),momentum:(x,y)=>n(y.analysis?.factors?.momentum)-n(x.analysis?.factors?.momentum)};a.sort(sorters[sort]||sorters.score);return a.slice(0,Math.min(250,Math.max(1,n(limit)||100)));}
  overview(){const a=Object.values(this.state.tokens);return {ok:true,narratives:narrativeSummary(a),stats:{tracked:a.length,activePairs:a.filter(t=>t.pairAddress).length,recentLaunches:a.filter(t=>t.launchSource&&Date.now()-Date.parse(t.firstSeenAt||t.pumpCreatedAt||0)<86400000).length,migrations:a.filter(t=>t.migrated).length,highSignals:a.filter(t=>t.analysis?.score>=75&&t.analysis?.coverage>=45&&!t.analysis?.hardBlocked).length,blocked:a.filter(t=>t.analysis?.hardBlocked).length,alerts:this.state.alerts.length},lastScanAt:this.state.lastScanAt,lastScanDurationMs:this.state.lastScanDurationMs||null,sources:this.status(),thresholds:{minLiquidityUsd:n(process.env.MIN_LIQUIDITY_USD)||5000,alertMinScore:n(process.env.ALERT_MIN_SCORE)||78},scannerRunning:this.running};}
  addWatch(mint){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint||'')))throw new Error('Adresse Solana invalide');if(!this.state.watchlist.includes(mint))this.state.watchlist.push(mint);this.save();return this.state.watchlist;}
  removeWatch(mint){this.state.watchlist=this.state.watchlist.filter(x=>x!==mint);this.save();return this.state.watchlist;}
  addWallet(address,label=''){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address||'')))throw new Error('Adresse wallet Solana invalide');if(!this.state.wallets.some(x=>x.address===address)){if(this.state.wallets.length>=10)throw new Error('Limite de 10 wallets suivis pour maîtriser les quotas RPC publics');this.state.wallets.push({address,label:String(label).slice(0,60),addedAt:iso()});}this.save();return this.state.wallets;}
  removeWallet(address){this.state.wallets=this.state.wallets.filter(x=>x.address!==address);this.save();return this.state.wallets;}
}
Object.assign(MemeScanner.prototype,require('./intelligence'),require('./historical-benchmark'),require('./learning'),require('./external-security'));
module.exports={MemeScanner};
