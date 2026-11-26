'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {tokenDataQuality,dataQualitySummary}=require('../lib/data-quality');

test('data quality distinguishes missing data from strong signals',()=>{
 const result=tokenDataQuality({mint:'m',symbol:'T',history:[]},1000000);
 assert.equal(result.completenessPct,0);
 assert.equal(result.quality,'low');
 assert.ok(result.issues.some(x=>x.key==='security'&&x.severity==='missing'));
 assert.equal(result.freshnessPct,null,'sans horodatage exploitable, la fraîcheur est inconnue et non nulle');
});

test('fresh market and on-chain observations increase completeness and freshness',()=>{
 const now=2_000_000;
 const at=new Date(now-30000).toISOString();
 const token={mint:'m',priceUsd:1,liquidityUsd:10000,volume:{h1:100,h24:1000},marketObservedAt:at,marketFieldsObservedAt:{volume:at,volumeH1:at,volumeH24:at,txns:at,txnsH1:at,txnsH24:at},history:[{at:now-30000,priceUsd:1}],security:{checkedAt:at,data:{uniqueOwnerCount:10,freezeAuthorityActive:false,mintAuthorityActive:false,ownerConcentrationAvailable:true,top10HolderPercent:35}},tradeIntel:{checkedAt:at,rpcConfirmedCheckedAt:at,rpcConfirmedTradeCount:6,rpcConfirmedLastTradeAt:at,tradeCount:40},socialIntel:{available:true,checkedAt:at},launchSource:'pumpportal_new_token'};
 const result=tokenDataQuality(token,now);
 assert.equal(result.completenessPct,100,JSON.stringify(result.checks.map(x=>({key:x.key,available:x.available,weight:x.weight}))));
 assert.equal(result.freshnessPct,100);
 assert.equal(result.quality,'high');
});

test('summary reports tracked tokens and bounded quality categories',()=>{
 const result=dataQualitySummary.call({state:{tokens:{a:{mint:'a'},b:{mint:'b',history:[]}}}});
 assert.equal(result.summary.tokens,2);
 assert.equal(result.tokens.length,2);
 assert.equal(result.summary.low,2);
 assert.equal(result.summary.freshnessCoverageTokens,0);
 assert.equal(result.summary.freshnessCoveragePct,0);
 assert.equal(result.summary.averageFreshnessPct,null);
});

test('missing or future timestamps do not dilute average freshness or appear fresh',()=>{
 const now=5_000_000;
 const measured={mint:'measured',priceUsd:1,liquidityUsd:100,volume:{h1:1},marketObservedAt:now-60000,history:[{at:now-60000}],security:{checkedAt:new Date(now-60000).toISOString(),data:{freezeAuthorityActive:false,mintAuthorityActive:false,ownerConcentrationAvailable:true,top10HolderPercent:20}},launchSource:'pumpportal'};
 const unknown={mint:'unknown',history:[{priceUsd:1}],security:{data:{freezeAuthorityActive:false,mintAuthorityActive:false,ownerConcentrationAvailable:false,top10HolderPercent:null}}};
 const future={mint:'future',priceUsd:1,liquidityUsd:100,volume:{h1:1},history:[{at:now+3600000}],security:{checkedAt:new Date(now+3600000).toISOString(),data:{}}};
 const summary=dataQualitySummary.call({state:{tokens:{measured,unknown,future}}},now);
 assert.equal(summary.summary.freshnessCoverageTokens,1);
 assert.equal(summary.summary.freshnessCoveragePct,33.3);
 assert.equal(summary.summary.averageFreshnessPct,100);
 assert.equal(tokenDataQuality(future,now).freshnessPct,null);
 assert.ok(tokenDataQuality(unknown,now).issues.some(x=>x.severity==='unknown_timestamp'));
});


test('data quality reports readiness stages and degraded public sources separately',()=>{
 const summary=dataQualitySummary.call({state:{tokens:{launch:{mint:'launch'},pooled:{mint:'pooled',pairAddress:'pool',analysis:{coverage:35}},ready:{mint:'ready',pairAddress:'pool',analysis:{coverage:85}}},sources:{dexscreener:{ok:false,error:'HTTP 429'},geckoTerminal:{ok:true,at:new Date().toISOString()}}}},Date.now());
 assert.equal(summary.summary.readinessCounts.awaiting_market,1);
 assert.equal(summary.summary.readinessCounts.insufficient_data,1);
 assert.equal(summary.summary.readinessCounts.complete,1);
 assert.equal(summary.summary.degradedSources,1);
 assert.equal(summary.sources.find(x=>x.key==='dexscreener').status,'degraded');
 assert.equal(summary.sources.find(x=>x.key==='geckoTerminal').status,'connected');
});


test('un objet volume vide ne compte pas comme données de marché complètes',()=>{
 const result=tokenDataQuality({mint:'empty-volume',priceUsd:1,liquidityUsd:10000,volume:{},history:[]},1000000);
 assert.equal(result.checks.find(x=>x.key==='market').available,false);
});


test('un volume horaire seul ne valide pas la mesure de marché 24h requise par le score',()=>{
 const result=tokenDataQuality({mint:'hourly-only',priceUsd:1,liquidityUsd:10000,volume:{h1:500},history:[]},1000000);
 assert.equal(result.checks.find(x=>x.key==='market').available,false);
});


test('social freshness follows X, Nostr or Telegram observations and lists X source health',()=>{
 const now=9_000_000;
 const at=new Date(now-30000).toISOString();
 const xOnly={mint:'x-only',xIntel:{available:true,checkedAt:at,posts:[]},socialIntel:{available:true}};
 const result=tokenDataQuality(xOnly,now);
 const social=result.checks.find(row=>row.key==='social');
 assert.equal(social.available,true);
 assert.equal(social.freshnessMinutes,0.5);
 assert.ok(!result.issues.some(issue=>issue.key==='social'&&issue.severity==='unknown_timestamp'));
 const summary=dataQualitySummary.call({
  state:{tokens:{xOnly},sources:{}},
  status:()=>({xSocial:{connected:true,lastSuccess:at}})
 },now);
 assert.equal(summary.sources.find(row=>row.key==='xSocial').status,'connected');
});
