'use strict';
const fs = require('node:fs');
const path = require('node:path');
const DEX = 'https://api.dexscreener.com';
const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
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
    for (const k of ['tokens', 'walletActivity', 'sources']) this.state[k] ||= {};
    for (const k of ['alerts', 'watchlist', 'wallets']) this.state[k] ||= [];
    this.bot = bot || null; this.chat = String(telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    this.running = false; this.timer = null; this.walletTimer = null; this.lastSecurity = 0;
  }
  save() {
    this.state.updatedAt = iso();
    this.state.tokens = Object.fromEntries(Object.entries(this.state.tokens).sort((a,b) => String(b[1].updatedAt || '').localeCompare(String(a[1].updatedAt || ''))).slice(0,1200));
    this.state.alerts = this.state.alerts.slice(-500); this.state.watchlist = this.state.watchlist.slice(-300); this.state.wallets = this.state.wallets.slice(-100);
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
    t.socials=p.info?.socials||t.socials||[];t.websites=p.info?.websites||t.websites||[];t.imageUrl=p.info?.imageUrl||t.imageUrl;t.updatedAt=iso();this.state.tokens[mint]=t;
  }
  score(t) {
    const f={}, w={social:20,onchain:20,market:15,smartMoney:15,narrative:10,security:15,timing:5};
    const h=t.txns?.h1, buys=n(h?.buys), sells=n(h?.sells), vol1=n(t.volume?.h1), vol24=n(t.volume?.h24);
    if(h){const total=buys+sells;f.onchain=clamp(Math.log10(total+1)*25+Math.log10(vol1+1)*15);f.momentum=clamp(total?buys/total*100:0);}
    if(t.liquidityUsd!==undefined||t.volume?.h24!==undefined)f.market=clamp(Math.sqrt(Math.max(0,n(t.liquidityUsd)))/10*.55+Math.log10(vol24+1)*18*.45);
    if(t.socialData&&Number.isFinite(Number(t.socialData.mentions24h)))f.social=clamp(Math.log10(n(t.socialData.mentions24h)+1)*45+Math.log10(n(t.socialData.engagements)+1)*10);
    if(t.smartMoney?.hits>0)f.smartMoney=clamp(45+t.smartMoney.hits*15);
    if(t.security?.checkedAt){const s=t.security.data||{};const known=s.freezeAuthorityActive!==undefined||s.mintAuthorityActive!==undefined||s.top10HolderPercent!==undefined;const freeze=s.freezeAuthorityActive===true;const top=n(s.top10HolderPercent);const flags=[freeze,s.mintAuthorityActive===true,top>=70].filter(Boolean).length;t.security.hardBlocked=freeze||top>=85;t.security.risk=!known?'unknown':t.security.hardBlocked?'high':flags?'medium':'observations_only';if(known)f.security=clamp(100-flags*25-(top>=50?20:0));}
    if(t.ageHours!==null&&t.ageHours!==undefined)f.timing=clamp(100-Math.max(0,t.ageHours-2)*3.5);
    const coverage=Object.keys(w).reduce((sum,k)=>sum+(Number.isFinite(f[k])?w[k]:0),0);const score=coverage?Math.round(Object.entries(w).reduce((sum,[k,weight])=>sum+(Number.isFinite(f[k])?f[k]*weight:0),0)/coverage):null;
    return {score,coverage,factors:f,hardBlocked:Boolean(t.security?.hardBlocked),risk:t.security?.risk||'unknown',confidence:coverage>=70?'high':coverage>=45?'medium':'low'};
  }
  scoreAll(){for(const t of Object.values(this.state.tokens))t.analysis=this.score(t);}
  async scan(){
    if(this.scanning)return {skipped:true};this.scanning=true;const start=Date.now();
    try{
      const results=await Promise.allSettled([json(DEX+'/token-profiles/latest/v1'),json(DEX+'/token-boosts/latest/v1'),json(DEX+'/token-boosts/top/v1')]);
      const map=new Map();const add=(arr,source)=>{if(!Array.isArray(arr))return;for(const x of arr){if(String(x.chainId).toLowerCase()!=='solana'||!x.tokenAddress)continue;map.set(x.tokenAddress,{...map.get(x.tokenAddress),...x});this.upsert(x,source);}};
      if(results[0].status==='fulfilled')add(results[0].value,'profile');if(results[1].status==='fulfilled')add(results[1].value,'boost');if(results[2].status==='fulfilled')add(results[2].value,'top_boost');
      const ok=results.some(x=>x.status==='fulfilled');this.state.sources.dexscreener=ok?{ok:true,at:iso(),error:null}:{ok:false,error:results.map(x=>x.reason?.message).filter(Boolean).join('; ').slice(0,200)};
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
        const sigs=await this.rpc('getSignaturesForAddress',[w.address,{limit:10,commitment:'confirmed'}]);
        const mints=new Set();
        for(const sig of (sigs||[]).slice(0,5)){
          const tx=await this.rpc('getTransaction',[sig.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);
          for(const x of [...(tx?.meta?.preTokenBalances||[]),...(tx?.meta?.postTokenBalances||[])])if(x.mint)mints.add(x.mint);
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
  async alerts(){const threshold=n(process.env.ALERT_MIN_SCORE)||78,minLiq=n(process.env.MIN_LIQUIDITY_USD)||5000;for(const t of Object.values(this.state.tokens)){const a=t.analysis;if(!a||a.score===null||a.coverage<45||a.hardBlocked||a.score<threshold||!t.pairAddress||n(t.liquidityUsd)<minLiq)continue;const prev=[...this.state.alerts].reverse().find(x=>x.mint===t.mint);if(prev&&Date.now()-Date.parse(prev.at)<21600000)continue;const alert={mint:t.mint,symbol:t.symbol||t.mint.slice(0,6),score:a.score,coverage:a.coverage,at:iso(),message:'Signal MEME RADAR : '+(t.symbol||t.mint)+' — '+a.score+'/100, couverture '+a.coverage+'%'};this.state.alerts.push(alert);if(this.bot&&this.chat)await this.bot.api.sendMessage(this.chat,alert.message+'\n'+(t.dexUrl||'https://dexscreener.com/solana/'+t.mint)+'\nSignal de recherche, pas une recommandation d’achat.').catch(e=>console.error('[telegram]',e.message));}}
  tokens({sort='score',limit=100,search='',includeBlocked=true}={}){let a=Object.values(this.state.tokens).filter(t=>(includeBlocked||!t.analysis?.hardBlocked)&&(!search||((t.name||'')+' '+(t.symbol||'')+' '+t.mint).toLowerCase().includes(search.toLowerCase())));const sorters={score:(x,y)=>n(y.analysis?.score)-n(x.analysis?.score),liquidity:(x,y)=>n(y.liquidityUsd)-n(x.liquidityUsd),volume:(x,y)=>n(y.volume?.h24)-n(x.volume?.h24),newest:(x,y)=>(n(y.pairCreatedAt)||Date.parse(y.pumpCreatedAt||y.updatedAt)||0)-(n(x.pairCreatedAt)||Date.parse(x.pumpCreatedAt||x.updatedAt)||0),momentum:(x,y)=>n(y.analysis?.factors?.momentum)-n(x.analysis?.factors?.momentum)};a.sort(sorters[sort]||sorters.score);return a.slice(0,Math.min(250,Math.max(1,n(limit)||100)));}
  overview(){const a=Object.values(this.state.tokens);return {ok:true,stats:{tracked:a.length,activePairs:a.filter(t=>t.pairAddress).length,highSignals:a.filter(t=>t.analysis?.score>=75&&t.analysis?.coverage>=45&&!t.analysis?.hardBlocked).length,blocked:a.filter(t=>t.analysis?.hardBlocked).length,alerts:this.state.alerts.length},lastScanAt:this.state.lastScanAt,lastScanDurationMs:this.state.lastScanDurationMs||null,sources:this.status(),thresholds:{minLiquidityUsd:n(process.env.MIN_LIQUIDITY_USD)||5000,alertMinScore:n(process.env.ALERT_MIN_SCORE)||78},scannerRunning:this.running};}
  addWatch(mint){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint||'')))throw new Error('Adresse Solana invalide');if(!this.state.watchlist.includes(mint))this.state.watchlist.push(mint);this.save();return this.state.watchlist;}
  removeWatch(mint){this.state.watchlist=this.state.watchlist.filter(x=>x!==mint);this.save();return this.state.watchlist;}
  addWallet(address,label=''){if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address||'')))throw new Error('Adresse wallet Solana invalide');if(!this.state.wallets.some(x=>x.address===address)){if(this.state.wallets.length>=10)throw new Error('Limite de 10 wallets suivis pour maîtriser les quotas RPC publics');this.state.wallets.push({address,label:String(label).slice(0,60),addedAt:iso()});}this.save();return this.state.wallets;}
  removeWallet(address){this.state.wallets=this.state.wallets.filter(x=>x.address!==address);this.save();return this.state.wallets;}
}
module.exports={MemeScanner};
