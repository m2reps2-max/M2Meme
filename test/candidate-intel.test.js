'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateTradeIntel,evaluateSocialIntel,evaluateCandidateIntel}=require('../lib/candidate-intel');
const {MemeScanner}=require('../lib/scanner');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

test('trade intelligence rewards broad buying but penalizes concentration and sell pressure',()=>{
  const healthy=evaluateTradeIntel({tradeCount:40,buyVolumeUsd:8000,sellVolumeUsd:2000,uniqueBuyers:18,top5BuyerSharePct:35,sameBlockBuyerClusters:0,earlyWindow:{complete:true,uniqueBuyers:8},buys:30,sells:10});
  const risky=evaluateTradeIntel({tradeCount:40,buyVolumeUsd:2000,sellVolumeUsd:8000,uniqueBuyers:3,top5BuyerSharePct:90,sameBlockBuyerClusters:2,earlyWindow:{complete:false,uniqueBuyers:0},buys:10,sells:30});
  assert.ok(healthy.score>risky.score);
  assert.ok(healthy.score<=100&&risky.score>=0);
});

test('social intelligence remains unavailable when no public observations exist',()=>{
  assert.equal(evaluateSocialIntel(null).score,null);
  assert.equal(evaluateSocialIntel({available:true,mentions1h:0,mentions24h:0,uniqueAuthors24h:0,sentimentScore:null}).score,null);
  const result=evaluateSocialIntel({available:true,mentions1h:4,mentions24h:8,uniqueAuthors24h:6,sentimentScore:70});
  assert.ok(result.score>50);
});

test('candidate intelligence changes ranking only modestly and does not fake data coverage',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-intel-'));
  const scanner=new MemeScanner({dataFile:path.join(dir,'store.json')});
  const token={txns:{h1:{buys:70,sells:30}},volume:{h1:25000,h24:120000},liquidityUsd:45000,ageHours:3,tradeIntel:{tradeCount:40,buyVolumeUsd:8000,sellVolumeUsd:2000,uniqueBuyers:18,top5BuyerSharePct:35,sameBlockBuyerClusters:0,earlyWindow:{complete:true,uniqueBuyers:8},buys:30,sells:10},socialIntel:{available:true,mentions1h:4,mentions24h:8,uniqueAuthors24h:6,sentimentScore:70}};
  const result=scanner.score(token);
  assert.equal(result.coverage,40);
  assert.ok(Math.abs(result.score-result.baseScore)<=6);
  assert.ok(result.factors.tradeQuality>80);
  assert.equal(result.candidateIntel.socialQuality>50,true);
  assert.equal(Object.hasOwn(result.factors,'social'),false,'les agrégats sociaux non vérifiés ne doivent pas augmenter la couverture');
});

test('social scoring rewards independent authors, channels and network spread', () => {
  const result = evaluateSocialIntel({
    available: true, mentions1h: 6, mentions24h: 12,
    uniqueAuthors24h: 5, uniqueChannels24h: 3, uniqueSources24h: 3,
    sentimentScore: 60, duplicateTexts: 0
  });
  assert.ok(result.score > 65);
  assert.ok(result.reasons.some(reason => reason.includes('Propagation')));
});

test('social scoring flags repeated public snippets without claiming proof', () => {
  const result = evaluateSocialIntel({
    available: true, mentions1h: 5, mentions24h: 8,
    uniqueAuthors24h: 1, uniqueChannels24h: 1, uniqueSources24h: 1,
    sentimentScore: 50, duplicateTexts: 4
  });
  assert.ok(result.reasons.some(reason => reason.includes('possible amplification')));
  assert.ok(result.reasons.some(reason => reason.includes('concentrées')));
});

test('verified multi-network social evidence has a bounded, material ranking influence',()=>{
  const token={socialIntel:{available:true,mentions1h:8,mentions24h:20,uniqueAuthors24h:10,uniqueChannels24h:4,uniqueSources24h:3,sentimentScore:75,evidence:{sampledPosts24h:12,uniqueAuthors24h:10,uniqueChannels24h:4,uniqueSources24h:3,duplicateSharePct:0,weakMatchSharePct:0}}};
  const result=evaluateCandidateIntel(token);
  assert.ok(result.socialQuality>=75);
  assert.equal(result.adjustment,0,'la preuve sociale est intégrée comme facteur pondéré, pas comptée deux fois dans un bonus');
  assert.ok(result.socialConfidence==='limited_sample');
});

test('same-slot Smart Money clusters add a bounded warning and modest score penalty',()=>{
  const baseline=evaluateCandidateIntel({walletReputation:{sameSlotClusteredWallets:0}});
  const clustered=evaluateCandidateIntel({walletReputation:{sameSlotClusteredWallets:2}});
  assert.equal(clustered.adjustment,-4);
  assert.ok(clustered.flags.some(flag=>flag.code==='SMART_MONEY_SLOT_CLUSTER'));
  assert.ok(clustered.reasons.some(reason=>reason.includes('même slot')));
  assert.equal(baseline.flags.some(flag=>flag.code==='SMART_MONEY_SLOT_CLUSTER'),false);
});


test('verified social evidence has a material but bounded influence on the ranking score',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-social-weight-'));
  const scanner=new MemeScanner({dataFile:path.join(dir,'store.json')});
  const base={mint:'social-weight-token',pairAddress:'pool',liquidityUsd:25000,fdv:250000,priceUsd:0.001,ageHours:2,volume:{h1:9000,h24:80000},txns:{h1:{buys:24,sells:6}},history:[{at:Date.now()-120000,buys1h:8,sells1h:3,liquidityUsd:24000,priceUsd:0.0009},{at:Date.now()-60000,buys1h:12,sells1h:4,liquidityUsd:24500,priceUsd:0.00095}],security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:false,mintAuthorityActive:false,isInitialized:true,isToken2022:false,ownerConcentrationAvailable:true,top10HolderPercent:20}}};
  const social={available:true,mentions1h:10,mentions24h:25,uniqueAuthors24h:12,uniqueChannels24h:4,uniqueSources24h:3,sentimentScore:70,evidence:{sampledPosts24h:18,uniqueAuthors24h:12,uniqueChannels24h:4,uniqueSources24h:3,duplicateSharePct:0,weakMatchSharePct:0}};
  const without=scanner.score({...base});
  const withSocial=scanner.score({...base,socialIntel:social});
  assert.ok(withSocial.factors.social>=75);
  assert.ok(withSocial.score>=0&&withSocial.score<=100,'ranking remains bounded when social evidence is included');
  assert.equal(withSocial.coverage,without.coverage,'social evidence must not inflate core data coverage');
  const weakEvidence={...social,mentions1h:0,mentions24h:10,uniqueAuthors24h:5,uniqueChannels24h:3,uniqueSources24h:2,sentimentScore:40,evidence:{...social.evidence,sampledPosts24h:12,uniqueAuthors24h:5,uniqueChannels24h:3,uniqueSources24h:2,duplicateSharePct:25,weakMatchSharePct:20}};
  const weaker=scanner.score({...base,socialIntel:weakEvidence});
  assert.ok(withSocial.score>weaker.score+3,'strong independent community evidence should outrank weak but still qualified evidence');
  const weakSocial=scanner.score({...base,socialIntel:{...social,evidence:{...social.evidence,sampledPosts24h:6,uniqueAuthors24h:2,uniqueChannels24h:1}}});
  assert.equal(Object.hasOwn(weakSocial.factors,'social'),false,'small social samples must not receive the full social weight');
});


test('social score weight requires cross-network authors or multiple independent Telegram channels',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-social-diversity-'));
 const scanner=new MemeScanner({dataFile:path.join(dir,'store.json')});
 const base={mint:'social-diversity-token',pairAddress:'pool',liquidityUsd:25000,fdv:250000,priceUsd:0.001,ageHours:2,volume:{h1:9000,h24:80000},txns:{h1:{buys:24,sells:6}},history:[{at:Date.now()-120000,buys1h:8,sells1h:3,liquidityUsd:24000,priceUsd:0.0009},{at:Date.now()-60000,buys1h:12,sells1h:4,liquidityUsd:24500,priceUsd:0.00095}],security:{checkedAt:new Date().toISOString(),data:{freezeAuthorityActive:false,mintAuthorityActive:false,isInitialized:true,isToken2022:false,ownerConcentrationAvailable:true,top10HolderPercent:20}}};
 const social={available:true,mentions1h:10,mentions24h:25,uniqueAuthors24h:12,uniqueChannels24h:1,uniqueSources24h:1,sentimentScore:70,evidence:{sampledPosts24h:18,uniqueAuthors24h:12,uniqueChannels24h:1,uniqueSources24h:1,duplicateSharePct:0,weakMatchSharePct:0}};
 const singleNetwork=scanner.score({...base,socialIntel:social});
 assert.equal(Object.hasOwn(singleNetwork.factors,'social'),false,'many authors on one network are not cross-network evidence');
 const crossNetwork=scanner.score({...base,socialIntel:{...social,uniqueSources24h:2,evidence:{...social.evidence,uniqueSources24h:2}}});
 assert.equal(crossNetwork.factors.social>=0,true);
 const telegramSpread=scanner.score({...base,socialIntel:{...social,uniqueChannels24h:3,evidence:{...social.evidence,uniqueChannels24h:3}}});
 assert.equal(telegramSpread.factors.social>=0,true);
});


test('social merge works without retired Reddit data and labels only connected sources',()=>{
  const scanner=Object.create(MemeScanner.prototype);
  const now=new Date().toISOString();
  const mint='So11111111111111111111111111111111111111112';
  const merged=scanner.mergeSocialIntel({mint,symbol:'MOON',telegramIntel:{available:true,provider:'Telegram public discovery',mentions1h:1,mentions24h:1,posts:[{source:'Telegram',channel:'solcommunitychat',channelType:'unverified',text:'Contract '+mint,publishedAt:now,link:'https://t.me/solcommunitychat/1'}]}});
  assert.equal(merged.available,true);
  assert.equal(Object.hasOwn(merged,'reddit'),false);
  assert.deepEqual(merged.providers,['Telegram public discovery']);
  assert.equal(merged.sentimentScore,null,'aggregate Telegram sentiment is not independently verifiable after promotional filtering');
});
