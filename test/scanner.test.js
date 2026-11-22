'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {MemeScanner}=require('../lib/scanner');
function make(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-test-'));return new MemeScanner({dataFile:path.join(dir,'store.json')});}
test('score ne compte que les facteurs réellement disponibles',()=>{const s=make();const a=s.score({txns:{h1:{buys:70,sells:30}},volume:{h1:25000,h24:120000},liquidityUsd:45000,ageHours:3});assert.equal(a.coverage,40);assert.ok(a.score>=0&&a.score<=100);assert.equal(a.confidence,'low');});
test('une freeze authority active bloque le token',()=>{const s=make();const a=s.score({txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:10000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:true,mintAuthorityActive:false,top10HolderPercent:30}}});assert.equal(a.hardBlocked,true);assert.equal(a.risk,'high');});
test('les données sociales et wallet inconnues ne sont pas inventées',()=>{const s=make();const a=s.score({txns:{h1:{buys:1,sells:1}},volume:{h1:1,h24:2},liquidityUsd:100,ageHours:1,smartMoney:{hits:0,wallets:[]}});assert.equal(Object.hasOwn(a.factors,'social'),false);assert.equal(Object.hasOwn(a.factors,'smartMoney'),false);assert.equal(Object.hasOwn(a.factors,'narrative'),false);});
test('watchlist valide et déduplique les adresses',()=>{const s=make(),mint='So11111111111111111111111111111111111111112';assert.equal(s.addWatch(mint).length,1);assert.equal(s.addWatch(mint).length,1);assert.throws(()=>s.addWatch('invalid'),/invalide/);assert.equal(s.removeWatch(mint).length,0);});
test('wallets sont ajoutés et retirés proprement',()=>{const s=make(),wallet='So11111111111111111111111111111111111111112';assert.equal(s.addWallet(wallet,'Référence')[0].label,'Référence');assert.equal(s.removeWallet(wallet).length,0);});

test('le score expose les signaux de momentum et la qualité de liquidité',()=>{const s=make();const t={txns:{h1:{buys:80,sells:20}},volume:{h1:12000,h24:90000},liquidityUsd:30000,fdv:300000,ageHours:1,history:[{at:1,liquidityUsd:25000,priceUsd:0.00001,buys1h:30,sells1h:20},{at:2,liquidityUsd:30000,priceUsd:0.000012,buys1h:80,sells1h:20}]};const a=s.score(t);assert.ok(a.factors.activity>=0);assert.ok(a.factors.momentum>=0);assert.ok(a.factors.liquidityQuality>=0);assert.equal(a.factors.buyRatio,80);assert.equal(t.metrics.fdvToLiquidity,10);});
test('une forte baisse de liquidité est signalée',()=>{const s=make();const t={txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:7000,fdv:50000,ageHours:2,history:[{at:1,liquidityUsd:10000,priceUsd:1,buys1h:10,sells1h:5},{at:2,liquidityUsd:7000,priceUsd:.8,buys1h:20,sells1h:10}]};const a=s.score(t);assert.ok(a.flags.some(x=>x.code==='LIQUIDITY_DROP'));assert.equal(a.hardBlocked,true);});

test('une concentration extrême de wallets reste un avertissement tant que les comptes de pool ne sont pas exclus',()=>{
 const s=make();
 const a=s.score({txns:{h1:{buys:30,sells:10}},volume:{h1:8000,h24:30000},liquidityUsd:12000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:false,mintAuthorityActive:false,top10HolderPercent:90,top1OwnerPercent:38,top5OwnerPercent:61,ownerConcentrationAvailable:true}}});
 assert.ok(a.flags.some(x=>x.code==='TOP1_WALLET_CONCENTRATION'&&x.level==='warning'));
 assert.ok(a.flags.some(x=>x.code==='HOLDER_CONCENTRATION'&&x.level==='warning'));
 assert.equal(a.hardBlocked,false,'une concentration échantillonnée ne doit pas bloquer automatiquement un token');
 assert.ok(a.flags.some(x=>x.code==='TOP5_WALLET_CONCENTRATION'));
});

test('un lancement Pump.fun conserve le créateur et son horodatage',()=>{
 const scanner=make();
 const mint='So11111111111111111111111111111111111111112';
 scanner.ingestLaunch({mint,name:'Early Cat',symbol:'ECAT',traderPublicKey:'CreatorWallet111111111111111111111111111111',timestamp:Math.floor(Date.now()/1000),initialBuy:1.25,marketCapSol:30,signature:'sig'});
 const token=scanner.state.tokens[mint];
 assert.equal(token.launchSource,'Pump.fun');
 assert.equal(token.launchCohort.source,'Pump.fun');
 assert.equal(token.creator,'CreatorWallet111111111111111111111111111111');
 assert.equal(token.creatorObservedAtLaunch,true);
 assert.equal(token.symbol,'ECAT');
 assert.equal(token.launchData.initialBuyTokens,1.25);
 assert.ok(token.launchAgeHours>=0);
});

test('un fichier de données corrompu est récupéré depuis la sauvegarde valide',()=>{
 const scanner=make();
 scanner.state.tokens.first={mint:'first',symbol:'FIRST'};
 scanner.save();
 scanner.state.tokens.second={mint:'second',symbol:'SECOND'};
 scanner.save();
 fs.writeFileSync(scanner.file,'{corrupted','utf8');
 const recovered=new MemeScanner({dataFile:scanner.file});
 assert.equal(recovered.state.recoveredFromBackup,true);
 assert.ok(recovered.state.tokens.first);
 assert.equal(recovered.state.tokens.second,undefined);
 assert.ok(recovered.state.corruptFile);
 assert.equal(fs.readFileSync(path.join(path.dirname(scanner.file),recovered.state.corruptFile),'utf8'),'{corrupted');
 recovered.save();
 const backup=JSON.parse(fs.readFileSync(scanner.file+'.bak','utf8'));
 assert.ok(backup.tokens.first,'la sauvegarde valide ne doit jamais être remplacée par le JSON corrompu');
});

test('une migration sans événement de création est conservée sans inventer son âge',()=>{
 const scanner=make();
 const mint='So11111111111111111111111111111111111111112';
 scanner.ingestMigration({mint,pool:'PoolAddress'});
 const token=scanner.state.tokens[mint];
 assert.equal(token.launchSource,'Pump.fun');
 assert.equal(token.launchObservedVia,'migration_only');
 assert.equal(token.migrated,true);
 assert.equal(token.pumpCreatedAt,undefined);
 assert.equal(token.migrationPool,'PoolAddress');
});

test('un lancement Pump.fun est sauvegardé sans attendre le prochain scan',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-launch-save-'));
 const file=path.join(dir,'store.json');
 const scanner=new MemeScanner({dataFile:file});
 const mint='So11111111111111111111111111111111111111112';
 scanner.ingestLaunch({mint,name:'Saved Cat',symbol:'SCAT',traderPublicKey:'CreatorWallet111111111111111111111111111111',timestamp:Math.floor(Date.now()/1000)});
 assert.ok(scanner.persistTimer);
 scanner.flushScheduledSave();
 const reloaded=new MemeScanner({dataFile:file});
 assert.equal(reloaded.state.tokens[mint].symbol,'SCAT');
 assert.equal(reloaded.state.tokens[mint].creator,'CreatorWallet111111111111111111111111111111');
});

test('un nouveau pool GeckoTerminal est intégré sans inventer un créateur', () => {
 const scanner=make();
 const mint='11111111111111111111111111111111';
 scanner.ingestGeckoPool({tokenAddress:mint,name:'Pool Cat',symbol:'PCAT',poolAddress:'BPFLoaderUpgradeab1e11111111111111111111111',dexName:'Raydium',poolCreatedAt:new Date().toISOString(),ageHours:0,liquidityUsd:12000,priceUsd:0.01,fdv:100000,marketCap:80000,volume:{h1:3000,h24:15000},txns:{h1:{buys:20,sells:5}}});
 const token=scanner.state.tokens[mint];
 assert.equal(token.symbol,'PCAT');
 assert.equal(token.geckoDexName,'Raydium');
 assert.equal(token.liquidityUsd,12000);
 assert.equal(token.creator,undefined);
 assert.ok(token.firstSeenAt);
});

test('les wallets découverts automatiquement sont surveillés même sans wallet manuel',async()=>{
 const scanner=make();
 const address='AutoWallet11111111111111111111111111111111';
 scanner.state.autoWallets=[{address,label:'Acheteur observé'}];
 scanner.rpc=async(method)=>{assert.equal(method,'getSignaturesForAddress');return [];};
 scanner.save=()=>{};
 scanner.scoreAll=()=>{};
 await scanner.refreshWallets();
 assert.ok(scanner.state.walletActivity[address]);
});

test('le scanner surveille les sorties du créateur et distingue un swap-like d’un simple transfert',async()=>{
 const scanner=make();
 const mint='CreatorToken1111111111111111111111111111111';
 const creator='CreatorWallet111111111111111111111111111111';
 scanner.state.tokens[mint]={mint,symbol:'CREATOR',creator,creatorObservedAtLaunch:true,security:{data:{supply:'10000'}}};
 scanner.rpc=async(method)=>{
  if(method==='getSignaturesForAddress')return [{signature:'creator-sale-signature-new'},{signature:'creator-sale-signature-old'}];
  if(method==='getTransaction')return {
   slot:123,
   transaction:{message:{accountKeys:[creator]}},
   meta:{
    fee:5000,preBalances:[1000000000],postBalances:[1100000000],
    preTokenBalances:[{mint,owner:creator,uiTokenAmount:{amount:'1000',decimals:0}}],
    postTokenBalances:[{mint,owner:creator,uiTokenAmount:{amount:'500',decimals:0}}]
   }
  };
  throw new Error('unexpected RPC '+method);
 };
 await scanner.refreshWallets();
 const event=scanner.state.walletTrades[0];
 assert.equal(event.role,'creator');
 assert.equal(event.direction,'sell');
 assert.equal(event.swapConfirmed,true);
 assert.equal(event.quoteReceived.asset,'SOL');
 assert.equal(scanner.state.tokens[mint].creatorSaleSummary.soldPctSupplyLast,5);
 assert.equal(scanner.state.tokens[mint].creatorSaleSummary.totalSoldPctSupply,10);
 assert.equal(scanner.state.tokens[mint].creatorSaleSummary.soldPctSupply24h,10);
 assert.ok(scanner.score(scanner.state.tokens[mint]).hardBlocked);
});

test('le seuil des alertes ne change qu’après une validation hors échantillon suffisante',()=>{
 const scanner=make();
 const previous=process.env.ALERT_MIN_SCORE;
 process.env.ALERT_MIN_SCORE='78';
 try{
  scanner.learningSummary=()=>({outOfSample:{status:'holdout_available',selectedThreshold:70,validation:{tokens:25},holdoutAtSelectedThreshold:{tokens:22,positive15Pct:60,averageReturnPct:18,loss20Pct:15}}});
  assert.deepEqual(scanner.activeAlertThreshold(),{threshold:70,source:'out_of_sample_validation',validated:true,holdoutTokens:22});
  scanner.learningSummary=()=>({outOfSample:{status:'holdout_available',selectedThreshold:65,validation:{tokens:19},holdoutAtSelectedThreshold:{tokens:19,positive15Pct:80,averageReturnPct:40,loss20Pct:5}}});
  assert.deepEqual(scanner.activeAlertThreshold(),{threshold:78,source:'configured',validated:false,holdoutTokens:19});
 }finally{
  if(previous===undefined)delete process.env.ALERT_MIN_SCORE;else process.env.ALERT_MIN_SCORE=previous;
 }
});

test('le suivi wallet surveille les nouvelles signatures au lieu de paginer uniquement vers le passé',async()=>{
 const scanner=make();
 const address='CursorWallet111111111111111111111111111111';
 scanner.state.wallets=[{address,label:'Cursor'}];
 const calls=[];
 scanner.rpc=async(method,params)=>{
  if(method==='getSignaturesForAddress'){
   calls.push(params[1]);
   return calls.length===1?[{signature:'sig-new'},{signature:'sig-old'}]:[{signature:'sig-newer'},{signature:'sig-new'},{signature:'sig-old'}];
  }
  if(method==='getTransaction')return {slot:1,transaction:{message:{accountKeys:[address]}},meta:{preBalances:[100],postBalances:[100],preTokenBalances:[],postTokenBalances:[],fee:0}};
  throw new Error('unexpected RPC '+method);
 };
 scanner.save=()=>{};
 scanner.scoreAll=()=>{};
 await scanner.refreshWallets();
 assert.equal(scanner.state.walletLatestCursors[address],'sig-new');
 assert.equal(scanner.state.walletActivity[address].processedSignatures,2);
 await scanner.refreshWallets();
 assert.equal(scanner.state.walletLatestCursors[address],'sig-newer');
 assert.equal(scanner.state.walletActivity[address].processedSignatures,1);
 assert.ok(calls.every(options=>!Object.hasOwn(options,'before')));
});
test('le suivi wallet met en file les signatures récentes excédant vingt transactions par cycle',async()=>{
 const scanner=make(),address='BacklogWallet111111111111111111111111111111';
 scanner.state.wallets=[{address,label:'Backlog'}];
 const calls=[];
 scanner.rpc=async(method,params)=>{
  if(method==='getSignaturesForAddress'){
   calls.push(params[1]);
   if(calls.length===1)return [{signature:'anchor'}];
   return [...Array.from({length:30},(_,i)=>({signature:'new-'+String(i).padStart(2,'0')})),{signature:'anchor'}];
  }
  if(method==='getTransaction')return {slot:1,transaction:{message:{accountKeys:[address]}},meta:{preBalances:[100],postBalances:[100],preTokenBalances:[],postTokenBalances:[],fee:0}};
  throw new Error('unexpected RPC '+method);
 };
 scanner.save=()=>{};
 scanner.scoreAll=()=>{};
 await scanner.refreshWallets();
 await scanner.refreshWallets();
 assert.equal(scanner.state.walletActivity[address].processedSignatures,20);
 assert.equal(scanner.state.walletActivity[address].pendingSignatures,10);
 await scanner.refreshWallets();
 assert.equal(scanner.state.walletActivity[address].processedSignatures,10);
 assert.equal(scanner.state.walletActivity[address].pendingSignatures,0);
});

test('la santé distingue serveur actif et sources de données dégradées',()=>{
 const scanner=make();scanner.running=true;scanner.state.lastScanAt=new Date().toISOString();
 scanner.status=()=>({
  dexscreener:{lastSuccess:new Date().toISOString(),error:null},
  geckoTerminal:{lastSuccess:null,error:'offline'},
  solanaRpc:{lastSuccess:null,error:'offline'},
  pumpPortal:{connected:false,lastMessageAt:null,lastError:'offline'},
  redditRss:{connected:false,lastSuccess:null,error:'offline'},
  bluesky:{connected:false,lastSuccess:null,lastError:'offline'}
 });
 const health=scanner.healthSummary();
 assert.equal(health.state,'healthy');
 assert.equal(health.checks.dexscreener.ok,true);
 assert.equal(health.checks.pumpPortal.ok,false);
});

test('alerts require fresh market data and downgrade delayed signals',async()=>{
 const s=make(),now=Date.now();
 s.activeAlertThreshold=()=>({threshold:78});
 s.earlyBuyerExitIntel=()=>({alert:false,wallets:0,soldSharePct:0});
 const makeToken=(mint,at,critical=false)=>({mint,symbol:mint.toUpperCase(),pairAddress:'pair-'+mint,liquidityUsd:12000,history:[{at}],analysis:{score:90,coverage:90,factors:{security:80},hardBlocked:critical,flags:critical?[{level:'critical',message:'critical flag'}]:[]}});
 s.state.tokens={
  fresh:makeToken('fresh',now-60_000),
  delayed:makeToken('delayed',now-8*60_000),
  stale:makeToken('stale',now-20*60_000,true)
 };
 await s.alerts();
 assert.equal(s.state.tokens.fresh.signalLevel,'opportunity');
 assert.equal(s.state.tokens.delayed.signalLevel,'watch');
 assert.equal(s.state.tokens.stale.signalLevel,'none');
 assert.deepEqual(s.state.alerts.map(x=>x.mint).sort(),['delayed','fresh']);
 assert.equal(s.state.alerts.find(x=>x.mint==='delayed').level,'watch');
});


test('un état JSON valide mais de schéma incorrect ne fait pas planter le scanner',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-invalid-schema-'));
 const file=path.join(dir,'store.json');
 fs.writeFileSync(file,JSON.stringify({version:1,tokens:null,alerts:{},watchlist:'invalid',wallets:[null,{address:'walletA'}],autoWallets:'invalid',walletTrades:{},sources:[]}));
 const scanner=new MemeScanner({dataFile:file});
 assert.deepEqual(scanner.state.tokens,{});
 assert.deepEqual(scanner.state.alerts,[]);
 assert.deepEqual(scanner.state.watchlist,[]);
 assert.equal(scanner.state.wallets.length,1);
 assert.deepEqual(scanner.state.sources,{});
 assert.doesNotThrow(()=>scanner.status());
 assert.doesNotThrow(()=>scanner.overview());
 scanner.save();
 const reloaded=new MemeScanner({dataFile:file});
 assert.deepEqual(reloaded.state.tokens,{});
});

test('un fichier corrompu sans sauvegarde est préservé avant initialisation propre',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-corrupt-preserve-'));
 const file=path.join(dir,'store.json');
 const original='{ definitely not valid json';
 fs.writeFileSync(file,original,'utf8');
 const scanner=new MemeScanner({dataFile:file});
 assert.match(scanner.state.recoveryWarning,/illisibles/);
 assert.ok(scanner.state.corruptFile);
 assert.equal(fs.readFileSync(path.join(dir,scanner.state.corruptFile),'utf8'),original);
 scanner.save();
 assert.equal(fs.readFileSync(path.join(dir,scanner.state.corruptFile),'utf8'),original);
 assert.doesNotThrow(()=>new MemeScanner({dataFile:file}));
});

test('readiness remains false until the first scan has completed',()=>{
 const scanner=make();
 scanner.running=true;
 assert.equal(scanner.healthSummary().checks.scanner.ok,false);
 scanner.state.lastScanAt=new Date().toISOString();
 assert.equal(scanner.healthSummary().checks.scanner.ok,true);
 scanner.running=false;
 assert.equal(scanner.healthSummary().checks.scanner.ok,false);
});

test('background tasks do not overlap scans or each other',async()=>{
 const scanner=make();
 scanner.running=true;
 scanner.scanning=true;
 let called=0;
 const duringScan=await scanner.runBackgroundTask('test',async()=>{called++;});
 assert.equal(duringScan.skipped,true);
 assert.equal(called,0);
 scanner.scanning=false;
 scanner.backgroundTaskRunning='other';
 const duringBackground=await scanner.runBackgroundTask('test',async()=>{called++;});
 assert.equal(duringBackground.skipped,true);
 assert.equal(called,0);
 scanner.backgroundTaskRunning=null;
 const result=await scanner.runBackgroundTask('test',async()=>{called++;return 42;});
 assert.equal(result,42);
 assert.equal(called,1);
 assert.equal(scanner.backgroundTaskRunning,null);
 scanner.stop();
});


test('un lancement sans pool est explicitement en attente de marché et ne ressemble pas à une panne',()=>{
 const scanner=make();
 const a=scanner.score({mint:'NewLaunch11111111111111111111111111111111',launchSource:'Pump.fun',launchAgeHours:0.02,pumpCreatedAt:new Date().toISOString()});
 assert.equal(a.coverage,5);
 assert.equal(a.readiness,'awaiting_market');
 assert.equal(a.readinessLabel,'Marché en attente');
 assert.equal(a.marketLinked,false);
 assert.ok(a.readinessReason.includes('aucun pool'));
 assert.ok(a.missingFactors.includes('market'));
});

test('un token avec un pool mais peu de facteurs est signalé comme analyse incomplète',()=>{
 const scanner=make();
 const a=scanner.score({mint:'PoolToken11111111111111111111111111111111',pairAddress:'pool',liquidityUsd:10000,volume:{h24:5000},ageHours:null});
 assert.equal(a.readiness,'insufficient_data');
 assert.equal(a.marketLinked,true);
 assert.ok(a.missingFactors.includes('security'));
});


test('une concentration des comptes inconnue ne bloque pas le token et ne donne pas une sécurité complète',()=>{
 const s=make();
 const a=s.score({txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:10000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:false,mintAuthorityActive:false,top10HolderPercent:null,top10AccountPercent:95,ownerConcentrationAvailable:false}}});
 assert.equal(a.hardBlocked,false);
 assert.equal(a.factors.security,undefined);
 assert.ok(a.flags.some(x=>x.code==='TOP10_ACCOUNT_CONCENTRATION_UNVERIFIED'));
});

test('le momentum reste inconnu sans historique comparatif ni signal microstructure',()=>{
 const s=make();
 const a=s.score({txns:{h1:{buys:90,sells:10}},volume:{h1:10000,h24:50000},liquidityUsd:20000,fdv:100000,ageHours:1});
 assert.equal(a.factors.momentum,undefined);
 assert.equal(a.factors.activity!==undefined,true);
});

test('la qualité de liquidité ne reçoit pas une note avec un seul sous-indicateur',()=>{
 const s=make();
 const a=s.score({liquidityUsd:20000,ageHours:1,volume:{h1:1000}});
 assert.equal(a.factors.liquidityQuality,undefined);
});


test('seuls les acheteurs réellement observés dans une fenêtre initiale complète alimentent le facteur précoce',()=>{
 const s=make();
 const base={txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:10000,fdv:50000,ageHours:2,smartMoney:{hits:5,wallets:['manual-a','manual-b']}};
 const incomplete=s.score({...base,tradeIntel:{earlyWindow:{complete:false},earlyBuyers:[{wallet:'w1',buys:5,buyVolumeUsd:900}]}});
 assert.equal(incomplete.factors.earlyBuyerSignal,undefined);
 const complete=s.score({...base,tradeIntel:{earlyWindow:{complete:true},earlyBuyers:[{wallet:'w1',buys:3,buyVolumeUsd:300},{wallet:'w2',buys:2,buyVolumeUsd:200}]}});
 assert.equal(complete.factors.earlyBuyerSignal,70);
});


test('un volume 24h absent ne rend pas le facteur marché disponible',()=>{
 const s=make();
 const a=s.score({txns:{h1:{buys:20,sells:10}},volume:{h1:5000},liquidityUsd:10000,fdv:50000,ageHours:2});
 assert.equal(a.factors.market,undefined);
});


test('la freeze authority reste un blocage critique indépendant des données holders',()=>{
 const s=make();
 const a=s.score({txns:{h1:{buys:30,sells:10}},volume:{h1:8000,h24:30000},liquidityUsd:12000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:true,mintAuthorityActive:false,top10HolderPercent:null,ownerConcentrationAvailable:false}}});
 assert.equal(a.hardBlocked,true);
 assert.ok(a.flags.some(x=>x.code==='FREEZE_AUTHORITY'&&x.level==='critical'));
});


test('une couverture élevée sans facteur sécurité ne peut pas produire un candidat fort',()=>{
 const s=make();
 const token={txns:{h1:{buys:100,sells:10}},volume:{h1:10000,h24:50000},liquidityUsd:20000,fdv:100000,ageHours:1,history:[{at:1,liquidityUsd:15000,priceUsd:.01,buys1h:10,sells1h:10},{at:2,liquidityUsd:20000,priceUsd:.012,buys1h:100,sells1h:10}]};
 const a=s.score(token);
 assert.ok(a.coverage>=70);
 assert.equal(a.readiness,'partial');
 assert.equal(a.confidence,'medium');
 assert.notEqual(a.classification,'strong_candidate');
});

test('une opportunité Telegram exige une sécurité vérifiée; sinon le signal reste watch',async()=>{
 const s=make(),now=Date.now();
 s.activeAlertThreshold=()=>({threshold:78});
 s.earlyBuyerExitIntel=()=>({alert:false,wallets:0,soldSharePct:0});
 s.state.tokens={
  unverified:{mint:'unverified',symbol:'UNV',pairAddress:'pair-unverified',liquidityUsd:12000,history:[{at:now}],analysis:{score:95,coverage:90,factors:{activity:95},flags:[],hardBlocked:false}}
 };
 await s.alerts();
 assert.equal(s.state.tokens.unverified.signalLevel,'watch');
 assert.equal(s.state.alerts[0].level,'watch');
});
