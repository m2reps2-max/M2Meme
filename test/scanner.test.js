'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {MemeScanner}=require('../lib/scanner');
function make(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-test-'));return new MemeScanner({dataFile:path.join(dir,'store.json')});}
test('score ne compte que les facteurs réellement disponibles',()=>{const s=make();const a=s.score({txns:{h1:{buys:70,sells:30}},volume:{h1:25000,h24:120000},liquidityUsd:45000,ageHours:3});assert.equal(a.coverage,75);assert.ok(a.score>=0&&a.score<=100);assert.equal(a.confidence,'high');});
test('une freeze authority active bloque le token',()=>{const s=make();const a=s.score({txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:10000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:true,mintAuthorityActive:false,top10HolderPercent:30}}});assert.equal(a.hardBlocked,true);assert.equal(a.risk,'high');});
test('les données sociales et wallet inconnues ne sont pas inventées',()=>{const s=make();const a=s.score({txns:{h1:{buys:1,sells:1}},volume:{h1:1,h24:2},liquidityUsd:100,ageHours:1,smartMoney:{hits:0,wallets:[]}});assert.equal(Object.hasOwn(a.factors,'social'),false);assert.equal(Object.hasOwn(a.factors,'smartMoney'),false);assert.equal(Object.hasOwn(a.factors,'narrative'),false);});
test('watchlist valide et déduplique les adresses',()=>{const s=make(),mint='So11111111111111111111111111111111111111112';assert.equal(s.addWatch(mint).length,1);assert.equal(s.addWatch(mint).length,1);assert.throws(()=>s.addWatch('invalid'),/invalide/);assert.equal(s.removeWatch(mint).length,0);});
test('wallets sont ajoutés et retirés proprement',()=>{const s=make(),wallet='So11111111111111111111111111111111111111112';assert.equal(s.addWallet(wallet,'Référence')[0].label,'Référence');assert.equal(s.removeWallet(wallet).length,0);});

test('le score expose les signaux de momentum et la qualité de liquidité',()=>{const s=make();const t={txns:{h1:{buys:80,sells:20}},volume:{h1:12000,h24:90000},liquidityUsd:30000,fdv:300000,ageHours:1,history:[{at:1,liquidityUsd:25000,priceUsd:0.00001,buys1h:30,sells1h:20},{at:2,liquidityUsd:30000,priceUsd:0.000012,buys1h:80,sells1h:20}]};const a=s.score(t);assert.ok(a.factors.activity>=0);assert.ok(a.factors.momentum>=0);assert.ok(a.factors.liquidityQuality>=0);assert.equal(a.factors.buyRatio,80);assert.equal(t.metrics.fdvToLiquidity,10);});
test('une forte baisse de liquidité est signalée',()=>{const s=make();const t={txns:{h1:{buys:20,sells:10}},volume:{h1:5000,h24:20000},liquidityUsd:7000,fdv:50000,ageHours:2,history:[{at:1,liquidityUsd:10000,priceUsd:1,buys1h:10,sells1h:5},{at:2,liquidityUsd:7000,priceUsd:.8,buys1h:20,sells1h:10}]};const a=s.score(t);assert.ok(a.flags.some(x=>x.code==='LIQUIDITY_DROP'));assert.equal(a.hardBlocked,true);});

test('une concentration extrême sur un seul wallet est signalée',()=>{
 const s=make();
 const a=s.score({txns:{h1:{buys:30,sells:10}},volume:{h1:8000,h24:30000},liquidityUsd:12000,ageHours:2,security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:false,mintAuthorityActive:false,top10HolderPercent:42,top1OwnerPercent:38,top5OwnerPercent:61}}});
 assert.ok(a.flags.some(x=>x.code==='TOP1_WALLET_CONCENTRATION'&&x.level==='critical'));
 assert.ok(a.flags.some(x=>x.code==='TOP5_WALLET_CONCENTRATION'));
});

test('un lancement Pump.fun conserve le créateur et son horodatage',()=>{
 const scanner=make();
 const mint='So11111111111111111111111111111111111111112';
 scanner.ingestLaunch({mint,name:'Early Cat',symbol:'ECAT',traderPublicKey:'CreatorWallet111111111111111111111111111111',timestamp:Math.floor(Date.now()/1000),initialBuy:1.25,marketCapSol:30,signature:'sig'});
 const token=scanner.state.tokens[mint];
 assert.equal(token.launchSource,'Pump.fun');
 assert.equal(token.creator,'CreatorWallet111111111111111111111111111111');
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
