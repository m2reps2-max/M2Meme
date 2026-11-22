'use strict';
const fs = require('node:fs');
const path = require('node:path');
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
    try { this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.state = fresh(); }
    this.state.walletTrades ||= []; for (const k of ['tokens', 'walletActivity', 'sources']) this.state[k] ||= {};
    for (const k of ['alerts', 'watchlist', 'wallets']) this.state[k] ||= [];
    this.bot = bot || null; this.chat = String(telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    this.running = false; this.timer = null; this.walletTimer = null; this.lastSecurity = 0;
  }
  save() {
    this.state.updatedAt = iso();
    this.state.tokens = Object.fromEntries(Object.entries(this.state.tokens).sort((a,b) => String(b[1].updatedAt || '').localeCompare(String(a[1].updatedAt || ''))).slice(0,1200));
    this.state.alerts = this.state.alerts.slice(-500); this.state.walletTrades = (this.state.walletTrades||[]).slice(-5000); this.state.watchlist = this.state.watchlist.slice(-300); this.state.wallets = this.state.wallets.slice(-100);
    fs.mkdirSync(path.dirname(this.file), { recursive:true, mode:0o700 });
    const tmp = this.file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.state), { mode:0o600 }); fs.renameSync(tmp, this.file);
  }
  status() {
    const src=this.state.sources;
    return {
      dexscreener:{configured:true,connected:src.dexscreener?.ok===true,lastSuccess:src.dexscreener?.at||null,error:src.dexscreener?.error||null,mode:'API publique gratuite'},
      solanaRpc:{configured:true,connected:src.solanaRpc?.ok===true,lastSuccess:src.solanaRpc?.at||null,error:src.solanaRpc?.error||null,mode:'RPC public Solana · sécurité et wallets'},
      telegram:{configured:Boolean(this.bot&&this.chat),connected:Boolean(this.bot&&this.chat),mode:'Alertes Telegram (gratuit)'}
    };
  }
  async start() {
    if (this.running) return; this.running = true;
    await this.scan().catch(e => console.error('[scan]', e.message));
    this.timer = setInterval(() => this.scan().catch(e => console.error('[scan]', e.message)), Math.max(30000,n(process.env.SCAN_INTERVAL_MS)||60000));
    this.walletTimer = setInterval(() => this.refreshWallets().catch(e => console.error('[wallets]',e.message)),600000);
    this.refreshWallets().catch(e => console.error('[wallets]',e.message));
  }
  stop() { this.running=false; clearInterval(this.timer); clearInterval(this.walletTimer); }
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
  pair(p) {
    const mint=p?.baseToken?.address; if(!mint||p.chainId!=='solana') return;
    const t=this.state.tokens[mint]||{mint,sources:['dex_pair'],smartMoney:{hits:0,wallets:[]}};
    t.name=p.baseToken.name||t.name||'Unknown';t.symbol=p.baseToken.symbol||t.symbol||'—';t.pairAddress=p.pairAddress||t.pairAddress;t.dexUrl=p.url||t.dexUrl;
    t.priceUsd=n(p.priceUsd);t.liquidityUsd=n(p.liquidity?.usd);t.fdv=n(p.fdv);t.marketCap=n(p.marketCap||p.fdv);t.volume=p.volume||{};t.txns=p.txns||{};t.priceChange=p.priceChange||{};
    t.pairCreatedAt=n(p.pairCreatedAt)||t.pairCreatedAt||null;t.ageHours=t.pairCreatedAt?Math.max(0,(Date.now()-t.pairCreatedAt)/3600000):null;
    t.socials=p.info?.socials||t.socials||[];t.websites=p.info?.websites||t.websites||[];t.imageUrl=p.info?.imageUrl||t.imageUrl;
    t.history=Array.isArray(t.history)?t.history:[];
    const currentAnalysis=this.score(t);const snap={at:Date.now(),priceUsd:t.priceUsd,liquidityUsd:t.liquidityUsd,volume1h:n(t.volume.h1),volume24h:n(t.volume.h24),buys1h:n(t.txns.h1?.buys),sells1h:n(t.txns.h1?.sells),fdv:t.fdv,score:currentAnalysis.score,coverage:currentAnalysis.coverage,classification:currentAnalysis.classification};
    const last=t.history[t.history.length-1];if(!last||snap.at-last.at>=45000){t.history.push(snap);t.history=t.history.slice(-100);}
    t.updatedAt=iso();this.state.tokens[mint]=t;
  }
  score(t) {
    const weights={activity:20,momentum:20,market:15,liquidityQuality:15,security:15,smartMoney:10,timing:5},f={};
    const h=t.txns?.h1,buys=n(h?.buys),sells=n(h?.sells),total=buys+sells,vol1=n(t.volume?.h1),vol24=n(t.volume?.h24),liq=n(t.liquidityUsd),fdv=n(t.fdv||t.marketCap);
    if(h&&total>0){f.activity=clamp(Math.log10(total+1)*34+Math.log10(vol1+1)*17);const ratio=buys/total;const hist=Array.isArray(t.history)?t.history:[];const prior=hist.length>=2?hist[hist.length-2]:null;const accel=prior?total/Math.max(1,prior.buys1h+prior.sells1h)-1:null;f.momentum=clamp(clamp((ratio-.35)/.45*100)*.65+(accel===null?50:clamp(50+accel*25))*.35);f.buyRatio=Number((ratio*100).toFixed(1));f.buySellRatio=Number((buys/Math.max(1,sells)).toFixed(2));}
    if(t.liquidityUsd!==undefined&&t.volume?.h24!==undefined)f.market=clamp(Math.sqrt(Math.max(0,liq))*.055+Math.log10(vol24+1)*17);
    if(liq>0){const ratio=fdv>0?fdv/liq:null,turnover=vol1/liq,hist=Array.isArray(t.history)?t.history:[],prior=hist.length>=2?hist[hist.length-2]:null,change=prior&&prior.liquidityUsd>0?(liq/prior.liquidityUsd-1)*100:null;f.liquidityQuality=clamp(clamp(100-Math.abs(turnover-.35)*90)*.45+(change===null?50:clamp(50+change*2))*.35+(100-(ratio===null?0:clamp((ratio-5)*4)))*.2);t.metrics={volumeToLiquidity:Number(turnover.toFixed(3)),fdvToLiquidity:ratio===null?null:Number(ratio.toFixed(2)),liquidityChangePct:change===null?null:Number(change.toFixed(2)),priceChangeSincePrevious:prior&&prior.priceUsd>0?Number(((t.priceUsd/prior.priceUsd-1)*100).toFixed(2)):null};}
    if(t.smartMoney?.hits>0)f.smartMoney=clamp(40+t.smartMoney.hits*15);
    if(t.security?.checkedAt){const sec=t.security.data||{},known=sec.freezeAuthorityActive!==undefined||sec.mintAuthorityActive!==undefined||sec.top10HolderPercent!==undefined,freeze=sec.freezeAuthorityActive===true,top=Number.isFinite(Number(sec.top10HolderPercent))?Number(sec.top10HolderPercent):null,flags=[freeze,sec.mintAuthorityActive===true,top!==null&&top>=70].filter(Boolean).length;t.security.hardBlocked=freeze||(top!==null&&top>=85);t.security.risk=!known?'unknown':t.security.hardBlocked?'high':flags?'medium':'observations_only';if(known)f.security=clamp(100-flags*25-(top!==null&&top>=50?20:0));}
    if(t.ageHours!==null&&t.ageHours!==undefined)f.timing=clamp(100-Math.max(0,t.ageHours-1)*4);
    const available=Object.entries(weights).filter(([k])=>Number.isFinite(f[k])),coverage=available.reduce((sum,[k])=>sum+weights[k],0),score=coverage?Math.round(available.reduce((sum,[k])=>sum+f[k]*weights[k],0)/coverage):null;
    const flags=[];if(t.security?.data?.freezeAuthorityActive===true)flags.push({level:'critical',code:'FREEZE_AUTHORITY',message:'Freeze authority active'});if(t.security?.data?.mintAuthorityActive===true)flags.push({level:'warning',code:'MINT_AUTHORITY',message:'Mint authority active'});if(Number(t.security?.data?.top10HolderPercent)>=70)flags.push({level:Number(t.security.data.top10HolderPercent)>=85?'critical':'warning',code:'HOLDER_CONCENTRATION',message:'Top 10 token accounts concentration: '+t.security.data.top10HolderPercent+'%'});if(liq>0&&fdv>0&&fdv/liq>30)flags.push({level:'warning',code:'HIGH_FDV_LIQUIDITY',message:'FDV / liquidity ratio is unusually high'});if(total>=10&&buys/total<.4)flags.push({level:'warning',code:'SELL_PRESSURE',message:'Sell transactions dominate recent activity'});if(t.metrics?.liquidityChangePct!==null&&t.metrics?.liquidityChangePct!==undefined&&t.metrics.liquidityChangePct< -15)flags.push({level:'critical',code:'LIQUIDITY_DROP',message:'Liquidity dropped more than 15% between observations'});if(t.ageHours!==null&&t.ageHours!==undefined&&t.ageHours<1&&liq<3000)flags.push({level:'warning',code:'THIN_NEW_POOL',message:'Very new pool with low liquidity'});
    const hardBlocked=Boolean(t.security?.hardBlocked||flags.some(x=>x.level==='critical'&&x.code==='LIQUIDITY_DROP'));
    return {score,coverage,factors:f,hardBlocked,risk:hardBlocked?'high':flags.some(x=>x.level==='warning')?'medium':t.security?.risk||'unknown',confidence:coverage>=70?'high':coverage>=45?'medium':'low',flags,classification:score===null?'insufficient_data':coverage<45?'low_confidence':hardBlocked?'blocked':score>=80?'strong_candidate':score>=65?'watch':'weak'};
  }
  scoreAll(){for(const t of Object.values(this.state.tokens))t.analysis=this.score(t);}
  async scan(){
    if(this.scanning)return {skipped:true};this.scanning=true;const start=Date.now();
    try{
      const results=await Promise.allSettled([json(DEX+'/token-profiles/latest/v1'),json(DEX+'/token-boosts/latest/v1'),json(DEX+'/token-boosts/top/v1')]);
      const map=new Map();const add=(arr,source)=>{if(!Array.isArray(arr))return;for(const x of arr){if(String(x.chainId).toLowerCase()!=='solana'||!x.tokenAddress)continue;map.set(x.tokenAddress,{...map.get(x.tokenAddress),...x});this.upsert(x,source);}};
      if(results[0].status==='fulfilled')add(results[0].value,'profile');if(results[1].status==='fulfilled')add(results[1].value,'boost');if(results[2].status==='fulfilled')add(results[2].value,'top_boost');
      const ok=results.some(x=>x.status==='fulfilled');this.state.sources.dexscreener=ok?{ok:true,at:iso(),error:null}:{ok:false,error:results.map(x=>x.reason?.message).filter(Boolean).join('; ').slice(0,200)};
      const tracked=Object.values(this.state.tokens).filter(t=>t.pairAddress).sort((a,b)=>n(b.liquidityUsd)-n(a.liquidityUsd)).slice(0,100);for(const t of tracked)map.set(t.mint,{tokenAddress:t.mint});for(const mint of this.state.watchlist)if(this.state.tokens[mint]?.mint)map.set(mint,{tokenAddress:mint});
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
    const freezeAuthority=b.readUInt32LE(46)!==0?b.subarray(50,82).toString('hex'):null;
    const totalRaw=BigInt(supply?.value?.amount||0);
    const top=(largest?.value||[]).slice(0,10).reduce((sum,x)=>sum+BigInt(x.amount||0),0n);
    const top10HolderPercent=totalRaw>0n?Number(top*1000000n/totalRaw)/10000:null;
    t.security={checkedAt:iso(),provider:'Solana RPC public',data:{
      mintAuthorityActive:Boolean(mintAuthority),freezeAuthorityActive:Boolean(freezeAuthority),
      mintAuthority,freezeAuthority,top10HolderPercent,decimals:b[44],isInitialized:b[45]===1,
      supply:supply?.value?.uiAmountString||null
    }};
    t.security.hardBlocked=Boolean(freezeAuthority)||top10HolderPercent!==null&&top10HolderPercent>=85;
    this.scoreAll();this.save();return t.security;
  }
  async securityLeaders() {
    if(Date.now()-this.lastSecurity<900000)return;
    this.lastSecurity=Date.now();
    const leaders=Object.values(this.state.tokens).filter(t=>t.pairAddress&&(!t.security?.checkedAt||Date.now()-Date.parse(t.security.checkedAt)>3600000))
      .sort((a,b)=>n(b.liquidityUsd)-n(a.liquidityUsd)).slice(0,3);
    for(const t of leaders){try{await this.inspectSecurity(t);}catch(e){this.state.sources.solanaRpc={ok:false,error:e.message.slice(0,180)};break;}}
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
    this.scoreAll();this.save();return t;
  }
  async alerts(){const threshold=n(process.env.ALERT_MIN_SCORE)||78,minLiq=n(process.env.MIN_LIQUIDITY_USD)||5000;for(const t of Object.values(this.state.tokens)){const a=t.analysis;if(!a||a.score===null||a.coverage<45||a.hardBlocked||a.score<threshold||!t.pairAddress||n(t.liquidityUsd)<minLiq)continue;const prev=[...this.state.alerts].reverse().find(x=>x.mint===t.mint);if(prev&&Date.now()-Date.parse(prev.at)<21600000)continue;const alert={mint:t.mint,symbol:t.symbol||t.mint.slice(0,6),score:a.score,coverage:a.coverage,classification:a.classification,flags:a.flags||[],at:iso(),message:'Signal MEME RADAR : '+(t.symbol||t.mint)+' — '+a.score+'/100, couverture '+a.coverage+'%, liquidité '+Math.round(n(t.liquidityUsd))+' USD'};this.state.alerts.push(alert);if(this.bot&&this.chat)await this.bot.api.sendMessage(this.chat,alert.message+'\\n'+(t.dexUrl||'https://dexscreener.com/solana/'+t.mint)+'\\nSignal de recherche, pas une recommandation d’achat.').catch(e=>console.error('[telegram]',e.message));}}
  tokens({sort='score',limit=100,search='',includeBlocked=true}={}){let a=Object.values(this.state.tokens).filter(t=>(includeBlocked||!t.analysis?.hardBlocked)&&(!search||((t.name||'')+' '+(t.symbol||'')+' '+t.mint).toLowerCase().includes(search.toLowerCase())));const sorters={score:(x,y)=>n(y.analysis?.score)-n(x.analysis?.score),liquidity:(x,y)=>n(y.liquidityUsd)-n(x.liquidityUsd),volume:(x,y)=>n(y.volume?.h24)-n(x.volume?.h24),newest:(x,y)=>(n(y.pairCreatedAt)||Date.parse(y.pumpCreatedAt||y.updatedAt)||0)-(n(x.pairCreatedAt)||Date.parse(x.pumpCreatedAt||x.updatedAt)||0),momentum:(x,y)=>n(y.analysis?.factors?.momentum)-n(x.analysis?.factors?.momentum)};a.sort(sorters[sort]||sorters.score);return a.slice(0,Math.min(250,Math.max(1,n(limit)||100)));}
  overview(){const a=Object.values(this.state.tokens);return {ok:true,stats:{tracked:a.length,activePairs:a.filter(t=>t.pairAddress).length,highSignals:a.filter(t=>t.analysis?.score>=75&&t.analysis?.coverage>=45&&!t.analysis?.hardBlocked).length,blocked:a.filter(t=>t.analysis?.hardBlocked).length,alerts:this.state.alerts.length},lastScanAt:this.state.lastScanAt,lastScanDurationMs:this.state.lastScanDurationMs||null,sources:this.status(),thresholds:{minLiquidityUsd:n(process.env.MIN_LIQUIDITY_USD)||5000,alertMinScore:n(process.env.ALERT_MIN_SCORE)||78},scannerRunning:this.running};}
  addWatch(mint){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint||'')))throw new Error('Adresse Solana invalide');if(!this.state.watchlist.includes(mint))this.state.watchlist.push(mint);this.save();return this.state.watchlist;}
  removeWatch(mint){this.state.watchlist=this.state.watchlist.filter(x=>x!==mint);this.save();return this.state.watchlist;}
  addWallet(address,label=''){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address||'')))throw new Error('Adresse wallet Solana invalide');if(!this.state.wallets.some(x=>x.address===address)){if(this.state.wallets.length>=10)throw new Error('Limite de 10 wallets suivis pour maîtriser les quotas RPC publics');this.state.wallets.push({address,label:String(label).slice(0,60),addedAt:iso()});}this.save();return this.state.wallets;}
  removeWallet(address){this.state.wallets=this.state.wallets.filter(x=>x.address!==address);this.save();return this.state.wallets;}
}
Object.assign(MemeScanner.prototype,require('./intelligence'));
module.exports={MemeScanner};
