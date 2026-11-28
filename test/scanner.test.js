'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {MemeScanner}=require('../lib/scanner');
function make(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-test-')),scanner=new MemeScanner({dataFile:path.join(dir,'store.json')});
 const originalScore=scanner.score.bind(scanner);
 scanner.score=token=>{
  if(token&&typeof token==='object'&&!token.marketFieldsObservedAt){
   const at=new Date().toISOString();
   token.marketFieldsObservedAt={volumeM5:at,volumeH1:at,volumeH24:at,priceChangeM5:at,priceChangeH1:at,priceChangeH24:at,txnsM5:at,txnsH1:at,txnsH24:at};
  }
  return originalScore(token);
 };
 return scanner;
}
test('social background task yields before starting network work when its time budget is exhausted',async()=>{
 const scanner=make();let xCalls=0,telegramCalls=0,scored=0,saved=0;
 scanner.xRadar.search=async()=>{xCalls++;return {available:false,posts:[]};};
 scanner.telegramRadar.discoverPublicChannels=async()=>{telegramCalls++;return null;};
 scanner.scoreAll=()=>{scored++;};scanner.save=()=>{saved++;};
 const result=await scanner.refreshSocialRadar({deadlineAt:Date.now()-1});
 assert.equal(xCalls,0);assert.equal(telegramCalls,0);
 assert.equal(result.partial,true);assert.equal(result.reason,'scanner_priority_time_budget');
 assert.equal(scored,1);assert.equal(saved,1);
});

test('per-token scoring initializes the shared intelligence index only once before a full refresh',()=>{
 const scanner=make();
 scanner.score({mint:'score-context-a',liquidityUsd:1000,analysis:{score:60}});
 const context=scanner.scoreContext;
 assert.ok(context?.eliteIndex);
 scanner.score({mint:'score-context-b',liquidityUsd:2000,analysis:{score:61}});
 assert.strictEqual(scanner.scoreContext,context,'individual score updates reuse the existing shared index');
 scanner.scoreAll();
 assert.notStrictEqual(scanner.scoreContext,context,'a full score pass rebuilds the index from current state');
});

test('score ignores preserved market values when their own field observations are stale',()=>{
 const scanner=make(),oldAt=new Date(Date.now()-20*60_000).toISOString();
 const token={liquidityUsd:20000,fdv:100000,ageHours:2,volume:{m5:10000,h1:90000,h24:500000},txns:{m5:{buys:80,sells:5},h1:{buys:500,sells:20}},priceChange:{m5:40,h1:120,h24:300},
  marketFieldsObservedAt:{volumeM5:oldAt,volumeH1:oldAt,volumeH24:oldAt,txnsM5:oldAt,txnsH1:oldAt,priceChangeM5:oldAt,priceChangeH1:oldAt,priceChangeH24:oldAt}};
 const analysis=scanner.score(token);
 assert.equal(analysis.factors.activity,undefined);assert.equal(analysis.factors.market,undefined);assert.equal(analysis.factors.momentum,undefined);
 assert.ok(analysis.missingFactors.includes('activity'));assert.ok(analysis.missingFactors.includes('market'));assert.ok(analysis.missingFactors.includes('momentum'));
});
test('market snapshots never timestamp stale merged volume or transaction counts as fresh',()=>{
 const scanner=make(),mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 const oldAt=new Date(Date.now()-60*60_000).toISOString();
 scanner.state.tokens[mint]={mint,volume:{h1:9000,h24:50000},txns:{h1:{buys:80,sells:20}},marketFieldsObservedAt:{volume:oldAt,volumeM5:oldAt,priceChangeM5:oldAt,volumeH1:oldAt,volumeH24:oldAt,txns:oldAt,txnsM5:oldAt,txnsH1:oldAt,txnsH24:oldAt}};
 scanner.pair({chainId:'solana',baseToken:{address:mint,name:'Snapshot test',symbol:'SNAP'},pairAddress:'PoolSnapshot111111111111111111111111111111',priceUsd:'0.01',liquidity:{usd:12000},volume:{},txns:{}});
 const token=scanner.state.tokens[mint],snapshot=token.history.at(-1);
 assert.equal(token.volume.h1,9000);assert.equal(token.txns.h1.buys,80);
 assert.equal(snapshot.volume1h,null);assert.equal(snapshot.buys1h,null);
 assert.equal(snapshot.fieldObservedAt.volume,null);assert.equal(snapshot.fieldObservedAt.volumeM5,null);assert.equal(snapshot.fieldObservedAt.priceChangeM5,null);assert.equal(snapshot.fieldObservedAt.volumeH1,null);assert.equal(snapshot.fieldObservedAt.txns,null);assert.equal(snapshot.fieldObservedAt.txnsM5,null);assert.equal(snapshot.fieldObservedAt.txnsH1,null);
 assert.equal(token.marketFieldsObservedAt.volume,oldAt);assert.equal(token.marketFieldsObservedAt.volumeM5,oldAt);assert.equal(token.marketFieldsObservedAt.priceChangeM5,oldAt);assert.equal(token.marketFieldsObservedAt.volumeH1,oldAt);assert.equal(token.marketFieldsObservedAt.txns,oldAt);assert.equal(token.marketFieldsObservedAt.txnsM5,oldAt);assert.equal(token.marketFieldsObservedAt.txnsH1,oldAt);
 assert.ok(token.marketFieldsObservedAt.priceUsd);
});
test('an h24-only market update never refreshes stale h1 metrics or snapshots',()=>{
 const scanner=make(),mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH',oldAt=new Date(Date.now()-20*60_000).toISOString();
 scanner.state.tokens[mint]={mint,volume:{h1:9000,h24:50000},txns:{h1:{buys:80,sells:20},h24:{buys:200,sells:50}},marketFieldsObservedAt:{volume:oldAt,volumeH1:oldAt,volumeH24:oldAt,txns:oldAt,txnsH1:oldAt,txnsH24:oldAt}};
 scanner.pair({chainId:'solana',baseToken:{address:mint,name:'Partial update',symbol:'PART'},pairAddress:'PoolSnapshot111111111111111111111111111111',priceUsd:'0.01',liquidity:{usd:12000},volume:{h24:110000},txns:{h24:{buys:300,sells:100}}});
 const token=scanner.state.tokens[mint],snapshot=token.history.at(-1);
 assert.equal(token.volume.h1,9000);assert.equal(token.txns.h1.buys,80);
 assert.equal(snapshot.volume1h,null);assert.equal(snapshot.volume24h,110000);assert.equal(snapshot.buys1h,null);
 assert.equal(snapshot.fieldObservedAt.volumeH1,null);assert.equal(snapshot.fieldObservedAt.txnsH1,null);assert.equal(snapshot.fieldObservedAt.volumeM5,null);assert.equal(snapshot.fieldObservedAt.priceChangeM5,null);
 assert.equal(token.marketFieldsObservedAt.volumeH1,oldAt);assert.equal(token.marketFieldsObservedAt.txnsH1,oldAt);
 assert.ok(token.marketFieldsObservedAt.volumeH24);assert.ok(token.marketFieldsObservedAt.txnsH24);
});
test('pool RPC trade inspection processes the full bounded eight-transaction batch',async()=>{
 const scanner=make(),mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH',pool='Bcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 scanner.state.tokens[mint]={mint,geckoPoolAddress:pool,pairAddress:pool,liquidityUsd:12000,priceUsd:.01,analysis:{score:70}};
 const signatures=Array.from({length:8},(_,i)=>({signature:`rpc-batch-signature-${i}`,slot:200+i,blockTime:Math.floor(Date.now()/1000)}));
 const processed=[];
 scanner.rpc=async(method,params)=>{
  if(method==='getSignaturesForAddress')return signatures;
  if(method==='getTransaction'){
   processed.push(params[0]);
   return {slot:200,blockTime:Math.floor(Date.now()/1000),transaction:{message:{accountKeys:[]}},meta:{err:null,preTokenBalances:[],postTokenBalances:[],innerInstructions:[],logMessages:[]}};
  }
  return null;
 };
 const result=await scanner.inspectPoolRpcTradeIntel(scanner.state.tokens[mint],{maxTransactions:8});
 assert.equal(processed.length,8,'the internal processing cap must allow all eight requested transactions');
 assert.equal(result.processedLastBatch,8);
 assert.equal(scanner.state.tokens[mint].poolRpcTradeState.pending.length,0);
});

test('Helius pool RPC prioritizes the newest signatures and refreshes the head while backlog remains',async()=>{
 const scanner=make(),mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH',pool='Bcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 const token={mint,geckoPoolAddress:pool,pairAddress:pool,liquidityUsd:12000,priceUsd:.01,analysis:{score:70},
  poolRpcTradeState:{cursorSignature:'old-cursor',pending:[],processedSignatures:[]}};
 scanner.state.tokens[mint]=token;
 const now=Math.floor(Date.now()/1000);
 const newest=Array.from({length:50},(_,i)=>({signature:`new-${i}`,slot:500-i,blockTime:now}));
 const nextHead=[{signature:'new-head',slot:501,blockTime:now},...newest.slice(0,49)];
 const signatureCalls=[],processed=[];
 scanner.rpc=async(method,params)=>{
  if(method==='getSignaturesForAddress'){
   signatureCalls.push(params[1]);
   return signatureCalls.length===1?newest:nextHead;
  }
  if(method==='getTransaction'){
   processed.push(params[0]);
   return {slot:500,blockTime:now,transaction:{message:{accountKeys:[],instructions:[]}},meta:{err:null,preTokenBalances:[],postTokenBalances:[],innerInstructions:[],logMessages:[]}};
  }
  return null;
 };
 await scanner.inspectPoolRpcTradeIntel(token,{maxTransactions:8});
 assert.equal(signatureCalls.length,1);
 assert.deepEqual(processed.slice(0,8),newest.slice(0,8).map(row=>row.signature),'the latest signatures must be processed first');
 assert.equal(token.poolRpcTradeState.pending.length,42);
 assert.equal(token.poolRpcTradeState.catchupBeforeSignature,null,'historical pagination is not allowed to block fresh evidence');
 assert.equal(token.poolRpcTradeState.cursorSignature,'new-0');
 assert.equal(token.poolRpcTradeState.gapDetected,true,'a missing cursor remains visible as a coverage gap');
 token.poolRpcTradeState.lastAttemptAt=new Date(Date.now()-60000).toISOString();
 await scanner.inspectPoolRpcTradeIntel(token,{maxTransactions:8});
 assert.equal(signatureCalls.length,2,'the collector must refresh the newest signature page even while older work remains queued');
 assert.deepEqual(processed.slice(8,16),['new-head',...newest.slice(8,15).map(row=>row.signature)]);
 assert.equal(token.poolRpcTradeState.pending.length,35);
 assert.equal(token.poolRpcTradeState.cursorSignature,'new-head');
 assert.equal(token.poolRpcTradeState.gapDetected,false,'a continuous current head clears the transient gap');
});

test('pool RPC drops expired queued signatures before processing the fresh demand window',async()=>{
 const scanner=make(),mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH',pool='Bcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 const now=Math.floor(Date.now()/1000),old=now-20*60,fresh=now-60;
 const token={mint,geckoPoolAddress:pool,pairAddress:pool,liquidityUsd:12000,analysis:{score:70},
  poolRpcTradeState:{cursorSignature:'cursor',pending:[
   {signature:'expired-signature',blockTime:old,attempts:0},
   {signature:'fresh-signature',blockTime:fresh,attempts:0},
   {signature:'unknown-time-signature',blockTime:null,attempts:0}
  ],processedSignatures:[]}};
 scanner.state.tokens[mint]=token;
 const processed=[];
 scanner.rpc=async(method,params)=>{
  if(method==='getSignaturesForAddress')return [];
  if(method==='getTransaction'){
   processed.push(params[0]);
   return {slot:1,blockTime:fresh,transaction:{message:{accountKeys:[],instructions:[]}},meta:{err:null,preTokenBalances:[],postTokenBalances:[],innerInstructions:[],logMessages:[]}};
  }
  return null;
 };
 const result=await scanner.inspectPoolRpcTradeIntel(token,{maxTransactions:2});
 assert.deepEqual(processed,['fresh-signature','unknown-time-signature']);
 assert.equal(result.processedLastBatch,2);
 assert.equal(token.poolRpcTradeState.pending.length,0);
 assert.ok(!token.poolRpcTradeState.processedSignatures.includes('expired-signature'),'expired signatures are dropped, not counted as current evidence');
});

test('pool RPC trade inspection records only confirmed signer-owned token swaps and deduplicates signatures',async()=>{
 const scanner=make(),mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH',pool='Bcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 const wallet='Ccdefghijkmnopqrstuvwxyz123456789ABCDEFGH',signature='rpc-pool-swap-1';
 scanner.state.tokens[mint]={mint,geckoPoolAddress:pool,pairAddress:pool,liquidityUsd:12000,priceUsd:.01,analysis:{score:70}};
 const tx={slot:123,blockTime:Math.floor(Date.now()/1000),transaction:{message:{accountKeys:[{pubkey:wallet,signer:true}],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},meta:{err:null,preTokenBalances:[],postTokenBalances:[{mint,owner:wallet,uiTokenAmount:{uiAmountString:'250',amount:'250000000',decimals:6}}],innerInstructions:[],logMessages:[]}};
 scanner.rpc=async(method)=>method==='getSignaturesForAddress'?[{signature,slot:123,blockTime:tx.blockTime}]:method==='getTransaction'?tx:null;
 const first=await scanner.inspectPoolRpcTradeIntel(scanner.state.tokens[mint],{maxTransactions:4});
 assert.equal(first.tradeCount,1);assert.equal(first.uniqueBuyers,1);assert.equal(first.buys,1);
 assert.equal(scanner.state.tokens[mint].rpcTradeEvents[0].wallet,wallet);
 scanner.state.tokens[mint].poolRpcTradeState.lastAttemptAt=new Date(Date.now()-60000).toISOString();
 const second=await scanner.inspectPoolRpcTradeIntel(scanner.state.tokens[mint],{maxTransactions:4});
 assert.equal(second.tradeCount,1);assert.equal(second.uniqueBuyers,1);
});
test('social evidence missing is explicit and prevents complete readiness without changing coverage',()=>{
 const scanner=make();
 const base={txns:{h1:{buys:80,sells:20}},volume:{h1:12000,h24:90000},liquidityUsd:30000,fdv:300000,ageHours:1,
  history:[{at:1,liquidityUsd:25000,priceUsd:.00001},{at:2,liquidityUsd:30000,priceUsd:.000012}],
  security:{checkedAt:new Date().toISOString(),holderEvidenceComplete:true,holderSampleReviewed:true,data:{isInitialized:true,isToken2022:false,freezeAuthorityActive:false,mintAuthorityActive:false,ownerConcentrationAvailable:true,top10HolderPercent:30,holderSampleAccounts:20,unknownOwnerAccounts:0,top10AccountPercent:30,holderSampleCoveragePct:90}}};
 const without=scanner.score(base),withSocial=scanner.score({...base,socialIntel:{available:true,mentions1h:8,mentions24h:20,uniqueAuthors24h:10,uniqueChannels24h:4,uniqueSources24h:3,sentimentScore:75,evidence:{sampledPosts24h:12,uniqueAuthors24h:10,uniqueChannels24h:4,uniqueSources24h:3,duplicateSharePct:0,weakMatchSharePct:0}}});
 assert.equal(without.coverage,withSocial.coverage);assert.ok(without.missingFactors.includes('social'));assert.notEqual(without.readiness,'complete');
});
test('score ne compte que les facteurs réellement disponibles',()=>{const s=make();const a=s.score({txns:{h1:{buys:70,sells:30}},volume:{h1:25000,h24:120000},liquidityUsd:45000,ageHours:3});assert.equal(a.coverage,22);assert.ok(a.score>=0&&a.score<=100);assert.equal(a.confidence,'low');});
test('une freeze authority active bloque le token',()=>{const s=make();const a=s.score({txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:10000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:true,mintAuthorityActive:false,top10HolderPercent:30}}});assert.equal(a.hardBlocked,true);assert.equal(a.risk,'high');});
test('les preuves sociales multi-auteurs sont un facteur pondéré et augmentent la couverture sans double bonus',()=>{
 const s=make();
 const t={
  txns:{h1:{buys:80,sells:20}},volume:{h1:12000,h24:90000},liquidityUsd:30000,fdv:300000,ageHours:1,
  history:[{at:1,liquidityUsd:25000,priceUsd:0.00001,buys1h:30,sells1h:20},{at:2,liquidityUsd:30000,priceUsd:0.000012,buys1h:80,sells1h:20}],
  security:{checkedAt:new Date().toISOString(),data:{isInitialized:true,isToken2022:false,freezeAuthorityActive:false,mintAuthorityActive:false,ownerConcentrationAvailable:true,top10HolderPercent:30}},
  socialIntel:{available:true,mentions1h:8,mentions24h:20,uniqueAuthors24h:10,uniqueChannels24h:4,uniqueSources24h:3,sentimentScore:75,evidence:{sampledPosts24h:12,uniqueAuthors24h:10,uniqueChannels24h:4,uniqueSources24h:3,duplicateSharePct:0,weakMatchSharePct:0}}
 };
 const withSocial=s.score(t);
 const withoutSocial=s.score({...t,socialIntel:null});
 const lowSocial=s.score({...t,socialIntel:{...t.socialIntel,mentions1h:1,mentions24h:5,uniqueAuthors24h:2,uniqueChannels24h:1,uniqueSources24h:1,sentimentScore:10,evidence:{sampledPosts24h:5,uniqueAuthors24h:2,uniqueChannels24h:1,duplicateSharePct:0,weakMatchSharePct:0}}});
 assert.ok(Number.isFinite(withSocial.factors.social));
 assert.equal(withSocial.coverage,withoutSocial.coverage,'le social influence le score, pas la couverture des preuves de base');
 assert.ok(Math.abs(withSocial.baseScore-withoutSocial.baseScore)>0.1,'la preuve sociale vérifiée doit réellement peser dans le score');
 assert.ok(Math.abs(withSocial.baseScore-withoutSocial.baseScore)<=10,'la preuve sociale ne doit pas dominer le classement');
 assert.equal(Object.hasOwn(lowSocial.factors,'social'),false,'un petit échantillon social ne doit pas être pondéré');
});

test('les données sociales et wallet inconnues ne sont pas inventées',()=>{const s=make();const a=s.score({txns:{h1:{buys:1,sells:1}},volume:{h1:1,h24:2},liquidityUsd:100,ageHours:1,smartMoney:{hits:0,wallets:[]}});assert.equal(Object.hasOwn(a.factors,'social'),false);assert.equal(Object.hasOwn(a.factors,'smartMoney'),false);assert.equal(Object.hasOwn(a.factors,'narrative'),false);});
test('watchlist valide et déduplique les adresses',()=>{const s=make(),mint='So11111111111111111111111111111111111111112';assert.equal(s.addWatch(mint).length,1);assert.equal(s.addWatch(mint).length,1);assert.throws(()=>s.addWatch('invalid'),/invalide/);assert.equal(s.removeWatch(mint).length,0);});
test('wallets sont ajoutés et retirés proprement',()=>{const s=make(),wallet='So11111111111111111111111111111111111111112';assert.equal(s.addWallet(wallet,'Référence')[0].label,'Référence');assert.equal(s.removeWallet(wallet).length,0);});

test('le score expose les signaux de momentum et la qualité de liquidité',()=>{const s=make();const t={txns:{h1:{buys:80,sells:20}},volume:{m5:5000,h1:12000,h24:90000},priceChange:{m5:8},liquidityUsd:30000,fdv:300000,ageHours:1,history:[{at:1,liquidityUsd:25000,priceUsd:0.00001,buys1h:30,sells1h:20},{at:2,liquidityUsd:30000,priceUsd:0.000012,buys1h:80,sells1h:20}]};const a=s.score(t);assert.ok(a.factors.activity>=0);assert.ok(a.factors.momentum>=0);assert.ok(a.factors.liquidityQuality>=0);assert.equal(a.factors.buyRatio,80);assert.equal(t.metrics.fdvToLiquidity,10);});
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

test('un lancement LaunchLab/Meteora est intégré au scanner et reste idempotent',()=>{
 const scanner=make();
 const mint='So11111111111111111111111111111111111111112';
 const creator='Bcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 const event={mint,creator,name:'Launchpad Cat',symbol:'LPCAT',launchpadId:'letsbonk',launchpadName:'LetsBonk',programId:'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',signature:'launch-signature',slot:123,blockTime:new Date().toISOString()};
 const first=scanner.ingestLaunchpad(event);
 const second=scanner.ingestLaunchpad(event);
 assert.equal(first.mint,mint);
 assert.equal(second.launchSource,'LetsBonk');
 assert.equal(second.creator,creator);
 assert.equal(second.creatorObservedAtLaunch,true);
 assert.equal(second.launchpadId,'letsbonk');
 assert.equal(second.launchSignature,'launch-signature');
 assert.equal(second.launchSlot,123);
 assert.equal(second.sources.filter(x=>x==='launchpad_letsbonk').length,1);
 assert.equal(second.launchCohort.source,'LetsBonk');
 const legacyMint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 scanner.state.tokens[legacyMint]={mint:legacyMint,symbol:'OLD'};
 assert.doesNotThrow(()=>scanner.ingestLaunchpad({...event,mint:legacyMint}));
 assert.deepEqual(scanner.state.tokens[legacyMint].sources,['launchpad_letsbonk']);
});

test('le scanner vérifie une seule route de vente en lecture seule et respecte son cache',async()=>{
 const scanner=make();
 const mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 const token={mint,name:'Sell Route Test',symbol:'SRT',pairAddress:'PairAddress',liquidityUsd:25000,priceUsd:0.0001,jupiterPrice:{priceUsd:0.0001,decimals:9,checkedAt:new Date().toISOString()},security:{data:{supply:'1000000000'}},analysis:{score:78,securityComprehensive:true,hardBlocked:false}};
 scanner.state.tokens[mint]=token;
 const originalFetch=global.fetch;
 let calls=0,requestUrl=null;
 global.fetch=async(url,options)=>{
  calls++;requestUrl=new URL(url);
  assert.equal(options.headers['x-api-key'],undefined);
  return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({router:'metis',outAmount:'98500000',priceImpactPct:'0.015',routePlan:[{swapInfo:{label:'Raydium'}}]})};
 };
 try{
  const first=await scanner.refreshSellabilityQuotes([token]);
  assert.equal(first.checked,1);
  assert.equal(token.sellability.status,'route_available');
  assert.equal(token.sellability.transactionRequested,false);
  assert.equal(token.sellability.executionSimulated,false);
  assert.equal(requestUrl.searchParams.get('inputMint'),mint);
  assert.equal(requestUrl.searchParams.has('taker'),false);
  const second=await scanner.refreshSellabilityQuotes([token]);
  assert.equal(second.skipped,true);
  assert.equal(calls,1,'un devis récent ne doit pas être redemandé à chaque scan');
  const analysis=scanner.score(token);
  assert.equal(analysis.hardBlocked,false);
 }finally{
  global.fetch=originalFetch;
 }
});

test('trade intelligence rotates through the oldest unchecked pools instead of starving lower-ranked tokens',async()=>{
 const scanner=make();
 const now=Date.now();
 const first={mint:'oldest',geckoPoolAddress:'Pool111111111111111111111111111111111',analysis:{score:90},tradeIntel:{checkedAt:new Date(now-20*60_000).toISOString()}};
 const second={mint:'second-oldest',geckoPoolAddress:'Pool222222222222222222222222222222222',analysis:{score:70},tradeIntel:{checkedAt:new Date(now-10*60_000).toISOString()}};
 const third={mint:'fresh',geckoPoolAddress:'Pool333333333333333333333333333333333',analysis:{score:99},tradeIntel:{checkedAt:new Date(now-60_000).toISOString()}};
 scanner.state.tokens={oldest:first,second,third};
 scanner.lastAutoCreatorFundingAt=Date.now();
 const checked=[];
 scanner.inspectTradeIntel=async token=>{checked.push(token.mint);token.tradeIntel={checkedAt:new Date().toISOString()};return token.tradeIntel;};
 await scanner.refreshCandidateIntelligence();
 await scanner.refreshCandidateIntelligence();
 assert.deepEqual(checked,['oldest','second-oldest']);
});

test('Helius pool scheduler prioritizes queued RPC backlogs ahead of idle higher-scoring pools with a ten-pool batch',async()=>{
 const scanner=make(),now=Date.now();
 scanner.lastAutoCreatorFundingAt=now;
 scanner.state.scannerSettings={minScore:80};
 const makePool=(mint,score,pending,lastAttempt)=>({mint,pairAddress:'pool-'+mint,liquidityUsd:20000,
  firstSeenAt:new Date(now-60_000).toISOString(),
  poolRpcTradeState:{pending:Array.from({length:pending},(_,i)=>({signature:mint+'-pending-'+i})),lastAttemptAt:new Date(lastAttempt).toISOString()},
  analysis:{score,hardBlocked:false,risk:'medium'}});
 const rows=[
  makePool('idle-high',90,0,now-60_000),
  makePool('backlog-small',75,40,now-30_000),
  makePool('backlog-large',74,180,now-10_000),
  makePool('idle-old',73,0,now-60*60_000),
  ...Array.from({length:7},(_,i)=>makePool('idle-'+i,72-i,0,now-60_000))
 ];
 scanner.state.tokens=Object.fromEntries(rows.map(token=>[token.mint,token]));
 const inspected=[];
 scanner.inspectPoolRpcTradeIntel=async token=>{inspected.push(token.mint);return null;};
 await scanner.refreshCandidateIntelligence();
 assert.equal(inspected.length,10);
 assert.equal(inspected[0],'backlog-large');
 assert.equal(inspected[1],'backlog-small');
});

test('Jupiter exit capacity uses measured all-in execution loss when priceImpactPct is omitted',()=>{
 const scanner=make(),checkedAt=new Date().toISOString();
 const makeToken=(mint,effectiveLossPct)=>({mint,pairAddress:'pool-'+mint,liquidityUsd:12000,priceUsd:0.01,
  sellabilityChecks:[{status:'route_available',routeAvailable:true,requestedUsd:50,inputAmountUsd:50,priceImpactPct:null,effectiveLossPct,checkedAt}]});
 const acceptable=scanner.score(makeToken('acceptable-exit',3.4));
 const expensive=scanner.score(makeToken('expensive-exit',6.1));
 assert.equal(acceptable.exitCapacityUsd,50,'a measured all-in loss below 5% is sufficient when Jupiter omits its separate impact field');
 assert.equal(expensive.exitCapacityUsd,0,'a measured all-in loss above 5% must remain ineligible');
});

test('Helius pool RPC follows the DexScreener market pair and resets a cursor from the previous Gecko pool',async()=>{
 const scanner=make();
 const mint='C'.repeat(43),pairAddress='A'.repeat(43),geckoPoolAddress='B'.repeat(43);
 const token={mint,pairAddress,geckoPoolAddress,liquidityUsd:12000,analysis:{score:70},
  poolRpcTradeState:{poolAddress:geckoPoolAddress,poolAddressSource:'geckoterminal_pool',lastAttemptAt:new Date().toISOString(),
   cursorSignature:'old-gecko-signature',pending:[{signature:'old-gecko-signature'}],processedSignatures:['old-gecko-done'],catchupBeforeSignature:'older-gecko',catchupHeadSignature:'head-gecko',gapDetected:true},
  rpcTradeEvents:[{signature:'old-gecko-swap',wallet:'wallet',mint,at:new Date().toISOString(),direction:'buy',swapConfirmed:true}],
  poolRpcTradeIntel:{tradeCount:1,uniqueBuyers:1},tradeIntel:{rpcConfirmedTradeCount:1,rpcConfirmedUniqueBuyers:1,tradeCount:20}};
 scanner.state.tokens[mint]=token;
 const requests=[];
 scanner.rpc=async(method,params)=>{requests.push({method,params});if(method==='getSignaturesForAddress')return [];return null;};
 await scanner.inspectPoolRpcTradeIntel(token,{maxTransactions:12});
 assert.equal(requests[0].method,'getSignaturesForAddress');
 assert.equal(requests[0].params[0],pairAddress,'the RPC sample must match the DexScreener market pair');
 assert.equal(token.poolRpcTradeState.poolAddress,pairAddress);
 assert.equal(token.poolRpcTradeState.poolAddressSource,'dexscreener_pair');
 assert.equal(token.poolRpcTradeState.previousPoolAddress,geckoPoolAddress);
 assert.equal(token.poolRpcTradeState.pending.length,0,'signatures from a different pool must not be mixed into this queue');
 assert.equal(token.poolRpcTradeState.cursorSignature,null);
 assert.ok(token.poolRpcTradeState.poolAddressChangedAt);
 assert.deepEqual(token.rpcTradeEvents,[],'confirmed events from the old pool must not leak into the new pool');
 assert.equal(token.poolRpcTradeIntel.poolAddress,pairAddress);
 assert.equal(token.tradeIntel.rpcConfirmedTradeCount,0,'the new pool starts with zero confirmed swaps, not the previous pool proof');
 assert.equal(token.tradeIntel.tradeCount,20,'Gecko market sample remains intact');
});

test('Solana RPC caps full transaction payloads at 1 MiB without restricting signature pages',async()=>{
 const scanner=make();
 scanner.rpcEndpoints=['https://rpc.test'];
 scanner.rpcProviderBackoff=new Map();
 const originalFetch=global.fetch;
 global.fetch=async()=>({ok:true,status:200,headers:{get:name=>name.toLowerCase()==='content-length'?'1153434':null},text:async()=>JSON.stringify({result:null})});
 try{
  await assert.rejects(()=>scanner.rpc('getTransaction',[]),/trop volumineuse/i);
  assert.equal(await scanner.rpc('getSignaturesForAddress',[]),null,'the normal 2 MiB RPC limit still allows larger signature pages');
 }finally{global.fetch=originalFetch;}
});

test('Helius pool sampling refreshes ten ranked pools per scan with a bounded twenty-transaction batch',async()=>{
 const scanner=make();
 scanner.lastAutoCreatorFundingAt=Date.now();
 scanner.state.scannerSettings={minScore:80};
 scanner.state.tokens={};
 for(let i=0;i<10;i++){
  const mint='rpc-pool-'+i;
  scanner.state.tokens[mint]={mint,pairAddress:'pool-'+i,liquidityUsd:10000-i*100,
   analysis:{score:75-i,hardBlocked:false,risk:'medium'}};
 }
 const inspected=[];
 scanner.inspectPoolRpcTradeIntel=async(token,options)=>{
  inspected.push({mint:token.mint,options});
  return null;
 };
 await scanner.refreshCandidateIntelligence();
 assert.equal(inspected.length,10);
 assert.deepEqual(inspected.map(row=>row.mint),Array.from({length:10},(_,i)=>'rpc-pool-'+i));
 assert.ok(inspected.every(row=>row.options.persist===false&&row.options.maxTransactions===20));
});

test('Jupiter refresh prioritizes stale checked tokens over newly discovered unquoted tokens',()=>{
 const scanner=make(),now=Date.now();
 const makeToken=(mint,firstSeenAt,checkedAt)=>({
  mint,pairAddress:'pool-'+mint,firstSeenAt:new Date(firstSeenAt).toISOString(),liquidityUsd:12000,
  ...(checkedAt?{sellability:{status:'route_available',checkedAt:new Date(checkedAt).toISOString()}}:{}),
  analysis:{score:75,hardBlocked:false,risk:'medium',securityPublicationReady:true,securityComprehensive:true}
 });
 const stale=makeToken('stale-quote',now-60*60_000,now-15*60_000);
 const newcomers=Array.from({length:20},(_,i)=>makeToken('new-quote-'+i,now-60_000,null));
 scanner.state.tokens=Object.fromEntries([stale,...newcomers].map(token=>[token.mint,token]));
 const selected=scanner.jupiterRefreshCandidates(20);
 assert.equal(selected[0].mint,'stale-quote');
 assert.ok(selected.some(token=>token.mint==='stale-quote'));
});

test('Helius pool refresh does not let never-inspected new tokens starve stale checked candidates',async()=>{
 const scanner=make(),now=Date.now();
 scanner.lastAutoCreatorFundingAt=now;
 scanner.state.scannerSettings={minScore:80};
 const stale={mint:'stale-rpc',pairAddress:'pool-stale',firstSeenAt:new Date(now-60*60_000).toISOString(),liquidityUsd:30000,
  poolRpcTradeState:{lastAttemptAt:new Date(now-15*60_000).toISOString()},
  analysis:{score:75,hardBlocked:false,risk:'medium'}};
 const newcomers=Array.from({length:8},(_,i)=>({mint:'new-rpc-'+i,pairAddress:'pool-new-'+i,
  firstSeenAt:new Date(now-60_000).toISOString(),liquidityUsd:20000-i*100,
  analysis:{score:75,hardBlocked:false,risk:'medium'}}));
 scanner.state.tokens=Object.fromEntries([stale,...newcomers].map(token=>[token.mint,token]));
 const inspected=[];
 scanner.inspectPoolRpcTradeIntel=async token=>{inspected.push(token.mint);return null;};
 await scanner.refreshCandidateIntelligence();
 assert.equal(inspected[0],'stale-rpc');
 assert.equal(inspected.length,9);
});

test('Jupiter refresh queue follows the configured score floor without changing publication thresholds',()=>{
 const scanner=make();
 scanner.state.scannerSettings={minScore:75};
 const token={mint:'near-threshold-token',pairAddress:'pool',liquidityUsd:18000,
  analysis:{score:67,securityPublicationReady:true,securityComprehensive:true,hardBlocked:false,risk:'observations_only'}};
 scanner.state.tokens={token};
 assert.deepEqual(scanner.jupiterRefreshCandidates().map(row=>row.mint),['near-threshold-token']);
 scanner.state.scannerSettings.minScore=90;
 assert.deepEqual(scanner.jupiterRefreshCandidates(),[]);
});
test('Jupiter retries a route with neither price impact nor all-in loss after a short cooldown',async()=>{
 const scanner=make(),mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 scanner.state.scannerSettings={minScore:75};
 const token={mint,pairAddress:'PoolAddress',liquidityUsd:22000,priceUsd:0.001,
  jupiterPrice:{priceUsd:0.001,decimals:9,checkedAt:new Date().toISOString()},
  security:{data:{supply:'1000000000',decimals:9}},
  sellability:{status:'route_available',routeAvailable:true,requestedUsd:50,inputAmountUsd:50,priceImpactPct:null,checkedAt:new Date(Date.now()-4*60_000).toISOString()},
  analysis:{score:67,securityPublicationReady:true,securityComprehensive:true,hardBlocked:false,risk:'observations_only'}};
 scanner.state.tokens[mint]=token;
 const originalFetch=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({router:'metis',outAmount:'49500000',priceImpactPct:'0.01',routePlan:[{swapInfo:{label:'Raydium'}}]})};};
 try{
  const result=await scanner.refreshSellabilityQuotes([token]);
  assert.equal(result.checked,1);
  assert.equal(calls,1);
  assert.equal(token.sellability.status,'route_available');
  assert.equal(token.sellability.priceImpactPct,1);
 }finally{global.fetch=originalFetch;}
});
test('Jupiter keeps a route cached when all-in execution loss is measured without priceImpactPct',async()=>{
 const scanner=make(),mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 const token={mint,pairAddress:'PoolAddress',liquidityUsd:22000,priceUsd:0.001,
  jupiterPrice:{priceUsd:0.001,decimals:9,checkedAt:new Date().toISOString()},
  security:{data:{supply:'1000000000',decimals:9}},
  sellability:{status:'route_available',routeAvailable:true,requestedUsd:50,inputAmountUsd:50,priceImpactPct:null,effectiveLossPct:3.4,checkedAt:new Date(Date.now()-2*60_000).toISOString()},
  analysis:{score:76,securityPublicationReady:true,securityComprehensive:true,hardBlocked:false,risk:'medium'}};
 const originalFetch=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({router:'metis',outAmount:'48300000',routePlan:[{swapInfo:{label:'Raydium'}}]})};};
 try{
  const result=await scanner.refreshSellabilityQuotes([token]);
  assert.equal(result.skipped,true);
  assert.equal(calls,0,'a measured all-in loss is sufficient; do not hammer Jupiter for a missing optional impact field');
 }finally{global.fetch=originalFetch;}
});

test('Jupiter refresh window prioritizes score before quote age',()=>{
 const scanner=make(),now=Date.now();
 const makeToken=(mint,score,ageMinutes)=>({mint,pairAddress:'pool-'+mint,liquidityUsd:22000,
  sellability:{status:'route_available',checkedAt:new Date(now-ageMinutes*60_000).toISOString()},
  analysis:{score,securityPublicationReady:true,securityComprehensive:true,hardBlocked:false,risk:'medium'}});
 const low=makeToken('low-score',65,40),high=makeToken('high-score',76,20);
 scanner.state.tokens={low,high};
 assert.deepEqual(scanner.jupiterRefreshCandidates(20).map(token=>token.mint),['high-score','low-score']);
});
test('default Jupiter quote rotation is limited to five top candidates',()=>{
 const scanner=make(),now=Date.now();
 scanner.state.scannerSettings={minScore:75};
 const tokens=Array.from({length:9},(_,i)=>({
  mint:'quote-rotation-'+i,pairAddress:'pool-'+i,liquidityUsd:22000,
  sellability:{status:'route_available',checkedAt:new Date(now-(i+1)*60_000).toISOString()},
  analysis:{score:82-i,hardBlocked:false,risk:'medium'}
 }));
 scanner.state.tokens=Object.fromEntries(tokens.map(token=>[token.mint,token]));
 const selected=scanner.jupiterRefreshCandidates();
 assert.equal(selected.length,5,'one quote every other scan can refresh all five within the 10-minute evidence TTL');
 assert.deepEqual(selected.map(token=>token.mint),tokens.slice(0,5).map(token=>token.mint));
});


test('Jupiter refreshes high-quality live tokens even when strict Best/Observe selection excludes them',()=>{
 const scanner=make(),now=Date.now();
 const eligible={mint:'eligible-jupiter-token',pairAddress:'pool',liquidityUsd:24000,
  marketObservedAt:new Date(now-2*60_000).toISOString(),
  sellability:{status:'route_available',checkedAt:new Date(now-25*60_000).toISOString()},
  analysis:{score:76,securityPublicationReady:true,securityComprehensive:true,hardBlocked:false,risk:'medium'}};
 const noSecurity={...eligible,mint:'no-security',analysis:{...eligible.analysis,securityPublicationReady:false,securityComprehensive:false}};
 const blocked={...eligible,mint:'blocked',analysis:{...eligible.analysis,hardBlocked:true}};
 const lowScore={...eligible,mint:'low-score',analysis:{...eligible.analysis,score:59}};
 const noPool={...eligible,mint:'no-pool',pairAddress:null};
 scanner.state.tokens={eligible,noSecurity,blocked,lowScore,noPool};
 scanner.selection=()=>({best:[],observe:[]});
 const candidates=scanner.jupiterRefreshCandidates(20);
 assert.deepEqual(candidates.map(token=>token.mint),['eligible-jupiter-token','no-security']);
 assert.ok(candidates.every(token=>token.analysis.hardBlocked!==true),'read-only quotes remain limited to non-blocked tokens');
});
test('une absence de route Jupiter est un avertissement, jamais un blocage honeypot automatique',async()=>{
 const scanner=make();
 const mint='Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
 const token={mint,pairAddress:'PairAddress',liquidityUsd:20000,priceUsd:0.001,jupiterPrice:{priceUsd:0.001,decimals:9},analysis:{score:72,risk:'medium',hardBlocked:false}};
 scanner.state.tokens[mint]=token;
 const originalFetch=global.fetch;
 global.fetch=async()=>({ok:false,status:400,headers:{get:()=>null},text:async()=>JSON.stringify({error:'No routes found',errorCode:'NO_ROUTES_FOUND'})});
 try{
  await scanner.refreshSellabilityQuotes([token]);
  assert.equal(token.sellability.status,'no_route');
  const analysis=scanner.score(token);
  assert.equal(analysis.hardBlocked,false);
  assert.ok(analysis.flags.some(flag=>flag.code==='SELL_ROUTE_UNAVAILABLE'));
 }finally{
  global.fetch=originalFetch;
 }
});

test('les requêtes Jupiter Price et Sell sont alternées pour respecter le quota keyless',async()=>{
 const scanner=make();
 const calls=[];
 scanner.refreshJupiterPrices=async()=>{calls.push('price');};
 scanner.refreshSellabilityQuotes=async()=>{calls.push('sellability');};
 await scanner.refreshJupiterSignals([]);
 await scanner.refreshJupiterSignals([]);
 await scanner.refreshJupiterSignals([]);
 assert.deepEqual(calls,['price','sellability','price']);
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



test('a scan skipped during background work schedules an automatic retry',async()=>{
 const scanner=make();
 scanner.running=true;
 scanner.backgroundTaskRunning='wallets';
 const result=await scanner.scan();
 assert.equal(result.skipped,true);
 assert.equal(result.reason,'background_task_busy');
 assert.equal(result.retryScheduled,true);
 assert.ok(scanner.scanRetryTimer);
 scanner.stop();
 assert.equal(scanner.scanRetryTimer,null);
});

test('releasing a background task schedules the waiting market scan',async()=>{
 const scanner=make();
 scanner.running=true;
 scanner.scan=async()=>({ok:true});
 const result=await scanner.runBackgroundTask('social',async()=>({ok:true}),252);
 assert.deepEqual(result,{ok:true});
 assert.ok(scanner.scanRetryTimer);
 scanner.stop();
});

test('GeckoTerminal market observations create timestamped snapshots usable by publication freshness',()=>{
 const scanner=make();
 const mint='11111111111111111111111111111111';
 scanner.ingestGeckoPool({tokenAddress:mint,name:'Fresh Gecko',symbol:'FG',poolAddress:'BPFLoaderUpgradeab1e11111111111111111111111',poolCreatedAt:new Date().toISOString(),ageHours:0,liquidityUsd:12000,priceUsd:0.01,fdv:100000,volume:{h1:3000,h24:15000},txns:{h1:{buys:20,sells:5}}});
 const token=scanner.state.tokens[mint];
 assert.equal(token.history.length,1);
 assert.equal(token.history[0].source,'geckoterminal');
 assert.equal(token.history[0].liquidityUsd,12000);
 assert.ok(Math.abs(Date.now()-token.history[0].at)<5000);
 const {assessAlertFreshness}=require('../lib/alert-quality');
 assert.equal(assessAlertFreshness(token).status,'fresh');
});

test('GeckoTerminal partial refreshes never erase previously observed market metrics',()=>{
 const scanner=make();
 const mint='11111111111111111111111111111111';
 scanner.ingestGeckoPool({
  tokenAddress:mint,name:'Stable Gecko',symbol:'SG',poolAddress:'BPFLoaderUpgradeab1e11111111111111111111111',
  liquidityUsd:12000,priceUsd:0.01,fdv:100000,marketCap:90000,
  volume:{h1:3000,h24:15000},txns:{h1:{buys:20,sells:5}},priceChange:{h1:42.5}
 });
 const token=scanner.state.tokens[mint];
 scanner.ingestGeckoPool({
  tokenAddress:mint,name:'Stable Gecko',symbol:'SG',poolAddress:'BPFLoaderUpgradeab1e11111111111111111111111',
  liquidityUsd:12500,priceUsd:0.011,fdv:null,marketCap:undefined,
  volume:{h1:null,h24:undefined},txns:{h1:{buys:22,sells:null}},priceChange:{h1:null,h24:undefined}
 });
 assert.equal(token.fdv,100000);
 assert.equal(token.marketCap,90000);
 assert.deepEqual(token.volume,{h1:3000,h24:15000});
 assert.deepEqual(token.txns.h1,{buys:22,sells:5});
 assert.deepEqual(token.priceChange,{h1:42.5});
 assert.equal(token.liquidityUsd,12500);
 assert.equal(token.priceUsd,0.011);
});

test('GeckoTerminal does not create a fresh snapshot from missing current liquidity or price',()=>{
 const scanner=make();
 const mint='11111111111111111111111111111111';
 scanner.ingestGeckoPool({tokenAddress:mint,name:'Partial Gecko',symbol:'PG',poolAddress:'BPFLoaderUpgradeab1e11111111111111111111111',liquidityUsd:12000,priceUsd:null});
 const token=scanner.state.tokens[mint];
 assert.equal((token.history||[]).length,0);
 assert.equal(token.marketObservedAt,undefined);
});

test('DexScreener does not refresh snapshot age using a previously cached liquidity value',()=>{
 const scanner=make();
 const mint='11111111111111111111111111111111';
 scanner.state.tokens[mint]={mint,name:'Cached',symbol:'C',liquidityUsd:15000,priceUsd:0.01,history:[],sources:[],smartMoney:{hits:0,wallets:[]}};
 const created=scanner.pair({chainId:'solana',baseToken:{address:mint,name:'Cached',symbol:'C'},priceUsd:'0.02',fdv:100000});
 assert.equal(created,false);
 assert.equal(scanner.state.tokens[mint].history.length,0);
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
   transaction:{message:{accountKeys:[creator],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},
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
 scanner.state.scannerSettings={minScore:78};
 try{
  scanner.learningSummary=()=>({outOfSample:{status:'holdout_available',selectedThreshold:70,validation:{tokens:25},holdoutAtSelectedThreshold:{tokens:22,positive15Pct:60,averageReturnPct:18,loss20Pct:15}}});
  assert.deepEqual(scanner.activeAlertThreshold(),{threshold:78,source:'dashboard',validated:true,holdoutTokens:22});
  scanner.learningSummary=()=>({outOfSample:{status:'holdout_available',selectedThreshold:65,validation:{tokens:19},holdoutAtSelectedThreshold:{tokens:19,positive15Pct:80,averageReturnPct:40,loss20Pct:5}}});
  assert.deepEqual(scanner.activeAlertThreshold(),{threshold:78,source:'dashboard',validated:false,holdoutTokens:19});
 }finally{
  if(previous===undefined)delete process.env.ALERT_MIN_SCORE;else process.env.ALERT_MIN_SCORE=previous;
 }
});


test('le seuil minimum choisi dans le dashboard reste prioritaire sur un seuil adaptatif plus bas',()=>{
 const scanner=make();
 scanner.state.scannerSettings={minScore:84};
 scanner.learningSummary=()=>({outOfSample:{status:'holdout_available',selectedThreshold:70,validation:{tokens:25},holdoutAtSelectedThreshold:{tokens:22,positive15Pct:60,averageReturnPct:18,loss20Pct:15}}});
 assert.deepEqual(scanner.activeAlertThreshold(),{threshold:84,source:'dashboard',validated:true,holdoutTokens:22});
});

test('a validated adaptive threshold cannot silently raise the score floor set in the dashboard',()=>{
 const scanner=make();
 scanner.state.scannerSettings={minScore:80};
 scanner.learningSummary=()=>({outOfSample:{status:'holdout_available',selectedThreshold:90,validation:{tokens:30},holdoutAtSelectedThreshold:{tokens:24,positive15Pct:62,averageReturnPct:12,loss20Pct:18}}});
 assert.deepEqual(scanner.activeAlertThreshold(),{threshold:80,source:'dashboard',validated:true,holdoutTokens:24});
 const selected=scanner.selection();
 assert.equal(selected.adaptiveThreshold.threshold,80);
 assert.equal(selected.adaptiveThreshold.calibrationThreshold,90);
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
test('le suivi wallet borne le traitement à huit transactions par portefeuille et par cycle',async()=>{
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
 assert.equal(scanner.state.walletActivity[address].processedSignatures,8);
 assert.equal(scanner.state.walletActivity[address].pendingSignatures,22);
 await scanner.refreshWallets();
 assert.equal(scanner.state.walletActivity[address].processedSignatures,8);
 assert.equal(scanner.state.walletActivity[address].pendingSignatures,14);
});

test('wallet refresh has a strict global cap of 160 transaction reads across twenty monitored wallets',async()=>{
 const scanner=make();
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 const addresses=Array.from({length:20},(_,i)=>'A'.repeat(40)+alphabet[i]);
 const mints=Array.from({length:5},(_,i)=>'B'.repeat(40)+alphabet[i]);
 scanner.state.wallets=addresses.slice(0,10).map((address,i)=>({address,label:'Manual '+i}));
 scanner.state.autoWallets=addresses.slice(10,15).map((address,i)=>({address,label:'Auto '+i}));
 scanner.state.tokens=Object.fromEntries(addresses.slice(15).map((address,i)=>[mints[i],{mint:mints[i],creator:address,creatorObservedAtLaunch:true}]));
 let transactionReads=0;
 scanner.rpc=async(method,params)=>{
  if(method==='getSignaturesForAddress')return Array.from({length:50},(_,i)=>({signature:'wallet-signature-'+params[0]+'-'+i}));
  if(method==='getTransaction'){
   transactionReads++;
   return {slot:1,transaction:{message:{accountKeys:[params[0]]}},meta:{preBalances:[100],postBalances:[100],preTokenBalances:[],postTokenBalances:[],fee:0}};
  }
  throw new Error('unexpected RPC '+method);
 };
 scanner.save=()=>{};scanner.scoreAll=()=>{};
 await scanner.refreshWallets();
 assert.equal(transactionReads,160);
 assert.equal(Object.keys(scanner.state.walletActivity).length,20);
 assert.ok(Object.values(scanner.state.walletActivity).every(row=>row.processedSignatures===8));
 assert.equal(scanner.state.sources.walletMonitoring.processed,160);
 assert.equal(scanner.state.sources.walletMonitoring.pausedByMemory,false);
});

test('la santé distingue serveur actif et sources de données dégradées',()=>{
 const scanner=make();scanner.running=true;scanner.state.lastScanAt=new Date().toISOString();
 scanner.status=()=>({
  dexscreener:{lastSuccess:new Date().toISOString(),error:null},
  geckoTerminal:{lastSuccess:null,error:'offline'},
  solanaRpc:{lastSuccess:null,error:'offline'},
  pumpPortal:{connected:false,lastMessageAt:null,lastError:'offline'},
  redditRss:{connected:false,lastSuccess:null,error:'offline'},
  bluesky:{connected:false,lastSuccess:null,lastError:'offline'},
  xSocial:{connected:false,lastSuccess:null,lastError:'X session unavailable',mode:'Recherche X facultative'}
 });
 const health=scanner.healthSummary();
 assert.equal(health.state,'healthy');
 assert.equal(health.checks.dexscreener.ok,true);
 assert.equal(health.checks.pumpPortal.ok,false);
 assert.equal(health.checks.reddit.ok,true);
 assert.equal(health.checks.reddit.disabled,true);
 assert.equal(health.checks.reddit.retired,true);
 assert.equal(health.checks.xSocial.ok,false);
 assert.equal(health.checks.xSocial.detail,'Recherche X facultative');
});

test('alerts require fresh market data and the complete elite quality profile',async()=>{
 const s=make(),now=Date.now();
 s.activeAlertThreshold=()=>({threshold:88});
 s.earlyBuyerExitIntel=()=>({alert:false,wallets:0,soldSharePct:0});
 const makeToken=(mint,at,overrides={})=>({
  mint,symbol:mint.toUpperCase(),pairAddress:'pair-'+mint,liquidityUsd:20000,fdv:300000,
  volume:{m5:200,h1:8000,h24:45000},txns:{m5:{buys:4,sells:1},h1:{buys:16,sells:4}},priceChange:{m5:3},
  marketObservedAt:new Date(at).toISOString(),marketFieldsObservedAt:{volume:new Date(at).toISOString(),volumeM5:new Date(at).toISOString(),priceChangeM5:new Date(at).toISOString(),volumeH1:new Date(at).toISOString(),volumeH24:new Date(at).toISOString(),txns:new Date(at).toISOString(),txnsH1:new Date(at).toISOString(),txnsH24:new Date(at).toISOString()},
  history:[{at}],security:{checkedAt:new Date(now-5*60_000).toISOString()},
  sellability:{status:'route_available',routeAvailable:true,requestedUsd:100,priceImpactPct:1,checkedAt:new Date(now-5*60_000).toISOString()},
  tradeIntel:{checkedAt:new Date(now-5*60_000).toISOString(),lastTradeAt:new Date(now-5*60_000).toISOString(),tradeCount:30,uniqueBuyers:12,uniqueSellers:8,buyVolumeUsd:1200,sellVolumeUsd:700,rpcConfirmedTradeCount:8,rpcConfirmedUniqueBuyers:12,rpcConfirmedUniqueSellers:8,rpcConfirmedBuyVolumeUsd:1200,rpcConfirmedSellVolumeUsd:700,rpcConfirmedVolumeCoverage:100,rpcConfirmedCheckedAt:new Date(now-5*60_000).toISOString(),rpcConfirmedLastTradeAt:new Date(now-5*60_000).toISOString()},
  analysis:{score:92,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,exitCapacityUsd:100,factors:{activity:90,momentum:82,market:90,liquidityQuality:90,executionQuality:85,security:95,demandQuality:78},flags:[]},
  ...overrides
 });
 s.state.tokens={
  fresh:makeToken('fresh',now-60_000),
  delayed:makeToken('delayed',now-8*60_000),
  stale:makeToken('stale',now-20*60_000,{analysis:{score:92,coverage:90,risk:'high',securityComprehensive:true,hardBlocked:true,factors:{security:95},flags:[{level:'critical',message:'critical flag'}]}})
 };
 await s.alerts();
 assert.equal(s.state.tokens.fresh.signalLevel,'opportunity');
 assert.equal(s.state.tokens.delayed.signalLevel,'watch');
 assert.equal(s.state.tokens.stale.signalLevel,'none');
 assert.deepEqual(s.state.alerts.map(x=>x.mint).sort(),['delayed','fresh']);
 assert.equal(s.state.alerts.find(x=>x.mint==='delayed').level,'watch');
});

test('an otherwise qualified opportunity stays off Telegram while security evidence is stale',async()=>{
 const scanner=make(),now=Date.now();
 scanner.activeAlertThreshold=()=>({threshold:80});
 scanner.earlyBuyerExitIntel=()=>({alert:false,wallets:0,soldSharePct:0});
 const mint='stale-security-candidate';
 scanner.state.tokens[mint]={
  mint,symbol:'STALE',pairAddress:'pool-stale',liquidityUsd:12000,fdv:240000,
  volume:{h1:1800},txns:{h1:{buys:12,sells:8}},
  history:[{at:now-30_000}],
  security:{checkedAt:new Date(now-120*60_000).toISOString()},
  tradeIntel:{checkedAt:new Date(now-5*60_000).toISOString()},
  analysis:{score:84,coverage:85,risk:'observations_only',securityComprehensive:false,hardBlocked:false,flags:[],factors:{activity:80,momentum:80,market:80,liquidityQuality:80,security:90}}
 };
 await scanner.alerts();
 assert.equal(scanner.state.tokens[mint].signalLevel,'watch');
 assert.equal(scanner.state.alerts.some(row=>row.mint===mint&&row.level==='opportunity'),false);
});

test('critical risk alerts do not broadcast junk tokens and only notify for tracked candidates',async()=>{
 const s=make(),now=Date.now();
 s.activeAlertThreshold=()=>({threshold:88});
 s.earlyBuyerExitIntel=()=>({alert:false,wallets:0,soldSharePct:0});
 const mint='crashing-junk';
 s.state.tokens[mint]={
  mint,symbol:'JUNK',pairAddress:'pool-junk',liquidityUsd:1650,fdv:2056,
  volume:{h1:1107},txns:{h1:{buys:2,sells:18}},history:[{at:now-30_000}],
  analysis:{score:71,coverage:75,risk:'high',securityComprehensive:false,hardBlocked:true,flags:[{level:'critical',message:'Crash'}]}
 };
 await s.alerts();
 assert.equal(s.state.tokens[mint].signalLevel,'none');
 assert.equal(s.state.alerts.length,0);
 s.state.watchlist.push(mint);
 await s.alerts();
 assert.equal(s.state.tokens[mint].signalLevel,'danger');
 assert.equal(s.state.alerts.length,1);
 assert.equal(s.state.alerts[0].level,'danger');
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

test('background tasks retry after a scan collision and clear retries on stop',async()=>{
 const scanner=make();
 const originalSetTimeout=global.setTimeout;
 const originalClearTimeout=global.clearTimeout;
 let scheduled=null,delay=null,called=0;
 global.setTimeout=(fn,ms)=>{scheduled=fn;delay=ms;return {unref(){}};};
 global.clearTimeout=()=>{};
 try{
  scanner.running=true;
  scanner.scanning=true;
  const result=await scanner.runBackgroundTask('social',async()=>{called++;},205);
  assert.equal(result.skipped,true);
  assert.equal(result.retryScheduled,true);
  assert.equal(delay,15000);
  assert.equal(called,0);
  scanner.scanning=false;
  const retry=scheduled;
  retry();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(called,1);
  assert.equal(scanner.backgroundRetryTimers.has('social'),false);
  scanner.queueBackgroundRetry('wallets',async()=>{},210,60000);
  assert.equal(scanner.backgroundRetryTimers.has('wallets'),true);
  scanner.stop();
  assert.equal(scanner.backgroundRetryTimers.size,0);
 }finally{
  global.setTimeout=originalSetTimeout;
  global.clearTimeout=originalClearTimeout;
  scanner.stop();
 }
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
 assert.equal(a.coverage,0,'l’ancien bonus d’ancienneté ne constitue pas une preuve');
 assert.equal(a.readiness,'awaiting_market');
 assert.equal(a.readinessLabel,'Pré-marché · pool absent');
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
 const token={pairAddress:'market-pool',txns:{h1:{buys:100,sells:10}},volume:{h1:10000,h24:50000},liquidityUsd:20000,fdv:100000,ageHours:1,history:[{at:1,liquidityUsd:15000,priceUsd:.01,buys1h:10,sells1h:10},{at:2,liquidityUsd:20000,priceUsd:.012,buys1h:100,sells1h:10}]};
 const a=s.score(token);
 assert.ok(a.coverage<70,'les facteurs disponibles ne doivent plus gonfler artificiellement la couverture');
 assert.equal(a.readiness,'partial');
 assert.equal(a.confidence,'low');
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


test('un token Token-2022 non audité ne reçoit pas le facteur sécurité complet',()=>{
 const s=make();
 const a=s.score({txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:10000,fdv:50000,ageHours:2,pairAddress:'token-2022-pool',security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:false,mintAuthorityActive:false,isInitialized:true,isToken2022:true,ownerConcentrationAvailable:true,top10HolderPercent:20}}});
 assert.equal(a.factors.security,undefined);
 assert.ok(a.flags.some(x=>x.code==='TOKEN_2022_REVIEW'));
 assert.equal(a.readiness,'partial');
});


test('les autorités vérifiées alimentent le facteur sécurité même si les propriétaires des holders sont inconnus',()=>{
 const s=make();
 const a=s.score({pairAddress:'pool',txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:10000,fdv:50000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:false,mintAuthorityActive:false,isInitialized:true,isToken2022:false,ownerConcentrationAvailable:false,top10HolderPercent:null}}});
 assert.equal(a.factors.security,100);
 assert.equal(a.securityComprehensive,false);
 assert.equal(a.readiness,'partial');
 assert.ok(a.evidenceGaps.some(x=>x.key==='holders'));
});

test('les données absentes d’une paire DexScreener ne remplacent pas les métriques déjà collectées',()=>{
 const s=make();
 const mint='So11111111111111111111111111111111111111112';
 s.state.tokens[mint]={mint,priceUsd:0.01,liquidityUsd:12000,fdv:60000,volume:{h1:3000,h24:15000},txns:{h1:{buys:20,sells:5}},history:[]};
 s.pair({chainId:'solana',baseToken:{address:mint,name:'Token'},pairAddress:'pair-new',priceUsd:null,liquidity:{usd:null},volume:{},txns:{}});
 const token=s.state.tokens[mint];
 assert.equal(token.priceUsd,0.01);
 assert.equal(token.liquidityUsd,12000);
 assert.equal(token.volume.h24,15000);
 assert.deepEqual(token.txns.h1,{buys:20,sells:5});
 assert.equal(token.history.length,0,'a stale retained price must not be timestamped as a fresh market observation');
});

test('un token pré-marché n’obtient aucun point de couverture lié à son âge',()=>{
 const s=make();
 const a=s.score({mint:'NewLaunch11111111111111111111111111111111',launchSource:'Pump.fun',pumpCreatedAt:new Date().toISOString(),launchAgeHours:0.02});
 assert.equal(a.coverage,0,'l’ancien bonus d’ancienneté ne constitue pas une preuve');
 assert.equal(a.readiness,'awaiting_market');
 assert.equal(a.readinessLabel,'Pré-marché · pool absent');
 assert.ok(a.readinessReason.includes('ne contribue ni au score ni à la couverture'));
 assert.ok(a.missingFactorReasons.some(x=>x.key==='market'&&x.reason==='aucun pool DEX relié'));
});

test('GeckoTerminal discovery coverage is exposed in the source status',()=>{
 const scanner=make();
 scanner.state.sources.geckoTerminal={ok:true,at:new Date().toISOString(),pools:78,uniqueTokens:64,pagesSucceeded:4,pagesAttempted:4,pagesConfigured:4,rateLimited:false};
 const status=scanner.status().geckoTerminal;
 assert.equal(status.pools,78);
 assert.equal(status.uniqueTokens,64);
 assert.equal(status.pagesSucceeded,4);
 assert.equal(status.pagesConfigured,4);
 assert.match(status.mode,/64 tokens distincts \/ 78 pools/);
 assert.match(status.mode,/4\/4 pages/);
});


test('GeckoTerminal status exposes the new trending discovery telemetry',()=>{
 const s=make();
 s.state.geckoTrendingLastAttemptAt='2026-11-23T19:00:00.000Z';
 s.state.geckoTrendingLastSuccessAt='2026-11-23T19:00:01.000Z';
 s.state.geckoTrendingLastCount=7;
 s.state.geckoTrendingLastError=null;
 s.state.sources.geckoTerminal={ok:true,at:'2026-11-23T19:00:02.000Z',pools:12,uniqueTokens:10,pagesSucceeded:4,pagesConfigured:4,trendingPools:0,trendingLastSuccessAt:s.state.geckoTrendingLastSuccessAt,trendingLastError:null};
 const status=s.status().geckoTerminal;
 assert.equal(status.trendingPools,7);
 assert.equal(status.trendingLastAttemptAt,s.state.geckoTrendingLastAttemptAt);
 assert.equal(status.trendingLastSuccessAt,s.state.geckoTrendingLastSuccessAt);
 assert.equal(status.trendingLastError,null);
 assert.match(status.mode,/tendance 1h : 7 pools/);
});

test('Telegram est déclaré configuré avant le premier canal et son état de connexion reste distinct',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-telegram-status-'));
 const bot={isRunning:()=>false};
 const scanner=new MemeScanner({dataFile:path.join(dir,'store.json'),bot});
 const status=scanner.status().telegram;
 assert.equal(status.configured,true,'le bot existe même si aucun canal ne lui est encore associé');
 assert.equal(status.connected,false,'le bot ne doit pas être déclaré connecté avant le démarrage du polling');
 assert.equal(status.channels,0);
 assert.equal(status.enabledChannels,0);
});


test('a memory-deferred scan does not masquerade as a completed scan',async()=>{
 const scanner=make();
 scanner.running=true;
 scanner.state.lastScanCompletedAt='2026-11-25T00:00:00.000Z';
 scanner.state.lastScanCompletedDurationMs=1234;
 const original=process.memoryUsage;
 try{
  process.memoryUsage=()=>({heapUsed:61*1048576,external:5*1048576,rss:810*1048576});
  const result=await scanner.scan();
  assert.equal(result.skipped,true);
  assert.equal(result.reason,'memory_budget');
  assert.equal(scanner.state.lastScanCompletedAt,'2026-11-25T00:00:00.000Z');
  assert.equal(scanner.state.lastScanCompletedDurationMs,1234);
 }finally{
  process.memoryUsage=original;
  scanner.stop();
 }
});

test('security memory guard does not consume the one-minute retry window',async()=>{
 const scanner=make();
 scanner.state.tokens=Object.fromEntries(Array.from({length:4},(_,i)=>['security-'+i,{mint:'security-'+i,pairAddress:'pair-'+i,liquidityUsd:10000}]));
 const original=process.memoryUsage;
 try{
  process.memoryUsage=()=>({heapUsed:61*1048576,external:5*1048576,rss:761*1048576});
  await scanner.securityLeaders();
  assert.equal(scanner.lastSecurity,0);
 }finally{process.memoryUsage=original;}
});

test('security refresh can run below the 700 MiB RSS guard',async()=>{
 const scanner=make();
 scanner.state.tokens=Object.fromEntries(Array.from({length:4},(_,i)=>['security-'+i,{mint:'security-'+i,pairAddress:'pair-'+i,liquidityUsd:10000}]));
 const original=process.memoryUsage,checked=[];
 scanner.inspectSecurity=async token=>{checked.push(token.mint);token.security={checkedAt:new Date().toISOString(),data:{}};};
 scanner.inspectExternalSecurity=async()=>null;
 try{
  process.memoryUsage=()=>({heapUsed:61*1048576,external:5*1048576,rss:690*1048576});
  await scanner.securityLeaders();
  assert.equal(checked.length,4);
  assert.ok(scanner.lastSecurity>0);
 }finally{process.memoryUsage=original;}
});

test('security leader rotation refreshes up to eight tokens every minute without parallelizing RPC work',async()=>{
 const scanner=make();
 const now=Date.now();
 scanner.state.tokens=Object.fromEntries(Array.from({length:8},(_,i)=>['security-'+i,{mint:'security-'+i,pairAddress:'pair-'+i,liquidityUsd:10000}]));
 const checked=[];
 scanner.inspectSecurity=async token=>{checked.push(token.mint);token.security={checkedAt:new Date().toISOString(),data:{}};};
 scanner.inspectExternalSecurity=async()=>null;
 scanner.lastSecurity=now-60_000-1;
 await scanner.securityLeaders();
 assert.equal(checked.length,8);
 scanner.lastSecurity=Date.now()-60_000-1;
 await scanner.securityLeaders();
 assert.equal(checked.length,8);
});


test('unrecognized mint owner programs cannot qualify the security score',()=>{
 const s=make();
 const a=s.score({txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:10000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{tokenProgram:'UnrecognizedMintProgram111111111111111111111',isToken2022:false,isInitialized:true,freezeAuthorityActive:false,mintAuthorityActive:false,ownerConcentrationAvailable:true,top10HolderPercent:20}}});
 assert.equal(Object.hasOwn(a.factors,'security'),false);
 assert.ok(a.flags.some(x=>x.code==='UNKNOWN_TOKEN_PROGRAM'));
});


test('DexScreener community takeover is recorded as discovery metadata, not a boost or safety signal',()=>{
 const s=make(),mint='So11111111111111111111111111111111111111112';
 s.upsert({chainId:'solana',tokenAddress:mint,claimDate:'2026-11-24T10:00:00.000Z',url:'https://dexscreener.com/solana/'+mint,description:'Community maintained token'},'community_takeover');
 const token=s.state.tokens[mint];
 assert.ok(token.sources.includes('community_takeover'));
 assert.equal(token.communityTakeover.claimDate,'2026-11-24T10:00:00.000Z');
 assert.equal(token.boosted,false);
 assert.equal(token.security,undefined);
});


test('une liquidité observée à zéro est historisée et déclenche le signal de chute',()=>{
 const scanner=make(),mint='ZeroLiquidityMint1111111111111111111111111111';
 scanner.state.tokens[mint]={mint,priceUsd:1,liquidityUsd:10000,fdv:50000,volume:{h1:5000,h24:20000},txns:{h1:{buys:20,sells:10}},history:[{at:Date.now()-60000,priceUsd:1,liquidityUsd:10000,buys1h:20,sells1h:10}]};
 scanner.pair({chainId:'solana',baseToken:{address:mint,name:'Zero Liquidity',symbol:'ZERO'},priceUsd:0.9,liquidity:{usd:0},fdv:50000,volume:{h1:100,h24:1000},txns:{h1:{buys:1,sells:20}}});
 const token=scanner.state.tokens[mint];
 assert.equal(token.history.length,2);
 assert.equal(token.history[1].liquidityUsd,0);
 const analysis=scanner.score(token);
 assert.equal(token.metrics.liquidityChangePct,-100);
 assert.ok(analysis.flags.some(flag=>flag.code==='LIQUIDITY_DROP'));
 assert.equal(analysis.hardBlocked,true);
});

test('le scanner limite les nouveaux tokens lorsque SQLite est indisponible sans supprimer les tokens existants',()=>{
 const scanner=make();
 scanner.archive.available=false;
 const existing='So11111111111111111111111111111111111111112';
 scanner.state.tokens=Object.fromEntries(Array.from({length:1199},(_,index)=>['ExistingMint'+index,{mint:'ExistingMint'+index,symbol:'OLD'}]));
 scanner.state.tokens[existing]={mint:existing,symbol:'OLD',sources:[]};
 scanner.ingestLaunch({mint:existing,name:'Updated Existing',symbol:'UPD',timestamp:Math.floor(Date.now()/1000)});
 const newMint='NewBoundedMint11111111111111111111111111111';
 scanner.ingestLaunch({mint:newMint,name:'New Token',symbol:'NEW',timestamp:Math.floor(Date.now()/1000)});
 assert.equal(scanner.state.tokens[existing].symbol,'UPD');
 assert.equal(scanner.state.tokens[newMint],undefined);
 assert.equal(Object.keys(scanner.state.tokens).length,1200);
});

test('un mouvement de soldes sans instruction DEX vérifiée reste non confirmé',async()=>{
 const scanner=make();
 const mint='CreatorToken2222222222222222222222222222222';
 const creator='CreatorWallet222222222222222222222222222222';
 scanner.state.tokens[mint]={mint,symbol:'TRANSFER',creator,creatorObservedAtLaunch:true,security:{data:{supply:'10000'}}};
 scanner.state.wallets=[{address:creator,label:'Creator'}];
 scanner.rpc=async method=>{
  if(method==='getSignaturesForAddress')return [{signature:'plain-transfer-signature'}];
  if(method==='getTransaction')return {
   slot:456,
   transaction:{message:{accountKeys:[creator],instructions:[
    {program:'system',parsed:{type:'transfer',info:{}}}
   ]}},
   meta:{fee:5000,preBalances:[1000000000],postBalances:[900000000],
    preTokenBalances:[{mint,owner:creator,uiTokenAmount:{amount:'1000',decimals:0}}],
    postTokenBalances:[{mint,owner:creator,uiTokenAmount:{amount:'500',decimals:0}}]}
  };
  throw new Error('unexpected RPC '+method);
 };
 scanner.save=()=>{};
 scanner.scoreAll=()=>{};
 await scanner.refreshWallets();
 const event=scanner.state.walletTrades[0];
 assert.equal(event.swapConfirmed,false);
 assert.equal(event.swapEvidenceStatus,'probable');
 assert.equal(event.flowType,'token_outflow_unconfirmed');
 assert.equal(event.quoteReceived,null);
 assert.equal(scanner.state.tokens[mint].creatorSaleEvents,undefined);
});

test('les opportunités Telegram sont limitées aux cinq meilleurs candidats sélectionnés',async()=>{
 const scanner=make(),now=Date.now();
 scanner.activeAlertThreshold=()=>({threshold:80});
 scanner.earlyBuyerExitIntel=()=>({alert:false,wallets:0,soldSharePct:0});
 scanner.selection=()=>({best:[{mint:'best-one'}]});
 const token=mint=>({
  mint,symbol:mint,pairAddress:'pair-'+mint,liquidityUsd:20000,fdv:300000,
  volume:{h1:8000},txns:{h1:{buys:16,sells:4}},history:[{at:now-30000}],
  security:{checkedAt:new Date(now-5*60000).toISOString()},
  tradeIntel:{checkedAt:new Date(now-5*60000).toISOString()},
  analysis:{score:92,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,flags:[],factors:{activity:90,market:90,liquidityQuality:90,security:95}}
 });
 scanner.state.tokens={'best-one':token('best-one'),'qualified-but-not-top-five':token('qualified-but-not-top-five')};
 await scanner.alerts();
 assert.equal(scanner.state.tokens['best-one'].signalLevel,'opportunity');
 assert.equal(scanner.state.tokens['qualified-but-not-top-five'].signalLevel,'watch');
 assert.equal(scanner.state.alerts.filter(row=>row.level==='opportunity').length,1);
 assert.equal(scanner.state.alerts.find(row=>row.mint==='qualified-but-not-top-five').level,'watch');
});


test('les candidats à surveiller restent internes et ne sont jamais publiés sur Telegram',async()=>{
 const scanner=make(),now=Date.now(),mint='So11111111111111111111111111111111111111112';
 const sent=[];
 scanner.activeAlertThreshold=()=>({threshold:80});
 scanner.selection=()=>({best:[]});
 scanner.earlyBuyerExitIntel=()=>({alert:false,wallets:0,soldSharePct:0});
 scanner.bot={api:{sendMessage:async(chatId,message,options)=>{sent.push({chatId,message,options});return {message_id:321};}}};
 scanner.state.telegramChannels=[{chatId:'-1001234567890',enabled:true}];
 scanner.state.tokens[mint]={
  mint,name:'Watch Token',symbol:'WATCH',pairAddress:'pool-watch',liquidityUsd:6000,fdv:50000,
  priceUsd:0.001,marketObservedAt:new Date(now).toISOString(),marketObservationSource:'dexscreener',
  volume:{h1:1000},txns:{h1:{buys:8,sells:4}},history:[{at:now,priceUsd:0.001,liquidityUsd:6000}],
  analysis:{score:73,coverage:60,risk:'medium',hardBlocked:false,flags:[],factors:{}}
 };
 scanner.refreshTelegramPerformance=async()=>({edited:0,pending:0});
 await scanner.alerts();
 assert.equal(scanner.state.tokens[mint].signalLevel,'watch');
 assert.equal(scanner.state.alerts.find(row=>row.mint===mint)?.level,'watch');
 assert.equal(sent.length,0,'watch candidates must never be sent to Telegram');
 assert.equal(scanner.state.telegramOutbox.length,0,'watch candidates must not enter the Telegram outbox');
});

test('une transaction multi-token ne partage pas artificiellement le même montant de cotation entre plusieurs actifs',async()=>{
 const scanner=make();
 const wallet='MultiAssetWallet111111111111111111111111111111';
 const mintA='MultiAssetTokenA1111111111111111111111111111';
 const mintB='MultiAssetTokenB1111111111111111111111111111';
 const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGkZwyTDt1v';
 scanner.state.wallets=[{address:wallet}];
 scanner.rpc=async method=>{
  if(method==='getSignaturesForAddress')return [{signature:'multi-asset-swap'}];
  if(method==='getTransaction')return {
   slot:789,
   transaction:{message:{accountKeys:[wallet],instructions:[{program:'jupiter',parsed:{type:'route'}}]}},
   meta:{fee:5000,preBalances:[1000000000],postBalances:[900000000],
    preTokenBalances:[
     {mint:mintA,owner:wallet,uiTokenAmount:{amount:'0',decimals:0}},
     {mint:mintB,owner:wallet,uiTokenAmount:{amount:'100',decimals:0}},
     {mint:usdc,owner:wallet,uiTokenAmount:{amount:'0',decimals:6}}
    ],
    postTokenBalances:[
     {mint:mintA,owner:wallet,uiTokenAmount:{amount:'50',decimals:0}},
     {mint:mintB,owner:wallet,uiTokenAmount:{amount:'150',decimals:0}},
     {mint:usdc,owner:wallet,uiTokenAmount:{amount:'0',decimals:6}}
    ]}
  };
  throw new Error('unexpected RPC '+method);
 };
 scanner.save=()=>{};
 scanner.scoreAll=()=>{};
 await scanner.refreshWallets();
 assert.equal(scanner.state.walletTrades.length,2);
 assert.ok(scanner.state.walletTrades.every(event=>event.swapConfirmed===false));
 assert.ok(scanner.state.walletTrades.every(event=>event.swapEvidenceStatus==='probable'));
 assert.ok(scanner.state.walletTrades.every(event=>event.mint!==usdc));
});


test('le statut expose la pression mémoire et le mode dégradé de l’archive',()=>{
 const scanner=make();
 scanner.archive.available=false;
 scanner.state.tokens=Object.fromEntries(Array.from({length:1200},(_,index)=>['tracked-'+index,{mint:'tracked-'+index}]));
 const status=scanner.status();
 assert.equal(status.runtimeMemory.archiveAvailable,false);
 assert.equal(status.runtimeMemory.trackedTokens,1200);
 assert.equal(status.runtimeMemory.newTokenDiscoveryPaused,true);
 assert.ok(Number.isFinite(status.runtimeMemory.current.rssMiB));
});


test('runtime memory diagnostics expose the current budget and last scanner guard decision',()=>{
 const scanner=make();
 scanner.state.sources.scannerMemory={ok:false,at:'2026-11-26T22:00:00.000Z',reason:'Scan différé',heapMiB:470,externalMiB:10,rssMiB:450,maxHeapMiB:460,maxExternalMiB:120,maxRssMiB:800};
 const memory=scanner.status().runtimeMemory;
 assert.equal(memory.scannerGuard.ok,false);
 assert.equal(memory.scannerGuard.heapMiB,470);
 assert.equal(memory.scannerGuard.maxHeapMiB,460);
 assert.ok(Number.isFinite(memory.current.rssMiB));
 assert.ok(Number.isFinite(memory.current.heapMiB));
});

test('merged social intelligence carries the newest successful source timestamp',()=>{
 const s=make();
 const oldAt='2026-11-24T10:00:00.000Z';
 const newAt='2026-11-24T10:05:00.000Z';
 const result=s.mergeSocialIntel({
  mint:'So11111111111111111111111111111111111111112',
  symbol:'SOL',
  name:'Solana',
  xIntel:{available:true,checkedAt:oldAt,posts:[],sentimentScore:null},
  telegramIntel:{available:true,checkedAt:newAt,posts:[],sentimentScore:null}
 });
 assert.equal(result.checkedAt,newAt);
 assert.equal(result.available,true);
});

test('DexScreener crée un snapshot pour un mint présent côté quote avec son prix USD normalisé',()=>{
 const scanner=make();
 const mint='QuoteSideMint11111111111111111111111111111';
 scanner.state.tokens[mint]={mint,sources:[],history:[],smartMoney:{hits:0,wallets:[]}};
 const created=scanner.pair({
  chainId:'solana',
  baseToken:{address:'So11111111111111111111111111111111111111112',name:'Wrapped SOL',symbol:'SOL'},
  quoteToken:{address:mint,name:'Quote Side Token',symbol:'QST'},
  pairAddress:'quote-side-pool',
  priceUsd:'200',
  priceNative:'1000',
  liquidity:{usd:50000},
  fdv:9000000,
  info:{socials:[{type:'twitter',url:'https://x.com/base-token'}],websites:[{url:'https://base-token.example'}],imageUrl:'https://example.com/base.png'},
  volume:{h1:12000,h24:80000},
  txns:{h1:{buys:30,sells:10}}
 },mint);
 const token=scanner.state.tokens[mint];
 assert.equal(created,true);
 assert.deepEqual(token.socials,[],'base-token socials must not be attributed to quote token');
 assert.deepEqual(token.websites,[]);
 assert.equal(token.imageUrl,undefined);
 assert.equal(token.symbol,'QST');
 assert.equal(token.priceUsd,0.2);
 assert.equal(token.liquidityUsd,50000);
 assert.equal(token.fdv,undefined,'base-token FDV must not be assigned to quote token');
 assert.equal(token.history.length,1);
 assert.equal(token.history[0].priceUsd,0.2);
 assert.equal(token.history[0].source,'dexscreener');
});

test('un mint côté quote sans priceNative ne reçoit pas le prix du base token comme snapshot',()=>{
 const scanner=make();
 const mint='QuoteWithoutNativePrice1111111111111111111';
 scanner.state.tokens[mint]={mint,sources:[],history:[],smartMoney:{hits:0,wallets:[]}};
 const created=scanner.pair({
  chainId:'solana',
  baseToken:{address:'So11111111111111111111111111111111111111112',name:'Wrapped SOL',symbol:'SOL'},
  quoteToken:{address:mint,name:'Quote Side Token',symbol:'QST'},
  pairAddress:'quote-side-pool-no-native',
  priceUsd:'200',
  liquidity:{usd:50000},
  volume:{h1:12000,h24:80000},
  txns:{h1:{buys:30,sells:10}}
 },mint);
 assert.equal(created,false);
 assert.equal(scanner.state.tokens[mint].history.length,0);
 assert.equal(scanner.state.tokens[mint].priceUsd,undefined);
});

test('les diagnostics RPC affichent les limites réellement utilisées par le scanner',()=>{
 const scanner=make();
 const mode=scanner.status().poolTradeRpc.mode;
 assert.match(mode,/10 pools par scan/);
 assert.match(mode,/16 transactions maximum par pool/);
 assert.match(mode,/160 lectures séquentielles/);
});
