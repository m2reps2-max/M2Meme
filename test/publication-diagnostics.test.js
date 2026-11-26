'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scannerPublicationDiagnostics } = require('../lib/publication-diagnostics');

const NOW = Date.now();
function makeToken(overrides = {}) {
  const snapshotAt=overrides.history?.[0]?.at||new Date(NOW-8*60_000).toISOString();
  return {
    mint: 'mint-1', symbol: 'BAD',
    pairAddress: 'pool-1', liquidityUsd: 1200, fdv: 100000,
    volume: { h1: 200 }, txns: { h1: { buys: 2, sells: 8 } },
    marketObservedAt:snapshotAt,marketFieldsObservedAt:{volume:snapshotAt,txns:snapshotAt},
    history: [{ at: snapshotAt }],
    analysis: { score: 84, coverage: 70, risk: 'partial', hardBlocked: false, flags: [] },
    ...overrides
  };
}
function scanner(tokens, overrides = {}) {
  return {
    state: {
      tokens: Object.fromEntries(tokens.map(token => [token.mint, token])),
      scannerSettings: { preset: 'elite', minScore: 80, minLiquidityUsd: 15000, minVolume1hUsd: 5000, minCoverage: 85, minTransactions1h: 20, minBuyRatioPct: 55, maxFdvLiquidityRatio: 20, requireComprehensiveSecurity: true, publishOpportunities: true, publishRisks: true },
      telegramChannels: [], telegramOutbox: [], alerts: [], lastScanAt: new Date(NOW - 30_000).toISOString()
    },
    running: true, bot: null, lastAlertThreshold: { threshold: 80 },
    status: () => ({ dexscreener: { connected: true }, geckoTerminal: { connected: true }, pumpPortal: { connected: true }, launchpadDiscovery: { connected: true } }),
    ...overrides
  };
}

test('diagnostics explain strict Elite rejection and stale snapshots without weakening gates', () => {
  const instance = scanner([makeToken()]);
  const result = scannerPublicationDiagnostics.call(instance);
  assert.equal(result.settings.minScore, 80);
  assert.equal(result.discovery.linkedTokens, 1);
  assert.equal(result.discovery.staleOrUnknownMarket, 1);
  assert.ok(result.rejectionReasons.some(row => row.reason === 'Liquidité insuffisante'));
  assert.ok(result.mostBlockedCandidates[0].blockers.includes('Snapshot marché trop ancien'));
  assert.match(result.diagnosis, /snapshots marché/i);
});


test('diagnostics expose full scan completion and actual market refresh telemetry',()=>{
 const instance=scanner([makeToken()],{
  scanning:false,
  lastScanAttemptAt:'2026-11-25T04:50:00.000Z',
  lastScanSkipReason:null,
  scanRetryTimer:null,
  state:{
   ...scanner([makeToken()]).state,
   lastScanCompletedAt:'2026-11-25T04:51:00.000Z',
   lastScanCompletedDurationMs:65000,
   lastScanError:null
  },
  status:()=>({
   dexscreener:{connected:true},
   dexMarket:{ok:true,attemptedBatches:3,succeededBatches:3,pairs:40,snapshots:38,error:null},
   runtimeMemory:{current:{ok:true,rssMiB:241.2}}
  })
 });
 const result=scannerPublicationDiagnostics.call(instance);
 assert.equal(result.scan.lastScanCompletedAt,'2026-11-25T04:51:00.000Z');
 assert.equal(result.scan.lastScanCompletedDurationMs,65000);
 assert.equal(result.scan.dexMarket.snapshots,38);
 assert.equal(result.scan.runtimeMemory.current.rssMiB,241.2);
});

test('diagnostics distinguish discovery API health from actual DexScreener market refresh health',()=>{
 const instance=scanner([makeToken()]);
 instance.status=()=>({dexscreener:{connected:true},dexMarket:{ok:false,attemptedBatches:3,succeededBatches:0,pairs:0,snapshots:0,error:'HTTP 429'}});
 const result=scannerPublicationDiagnostics.call(instance);
 assert.equal(result.discovery.sourceStatus.dexscreener.connected,true);
 assert.equal(result.discovery.sourceStatus.dexMarket.ok,false);
 assert.equal(result.discovery.sourceStatus.dexMarket.error,'HTTP 429');
});

test('watch-only candidates are not misdiagnosed as Telegram delivery failures',()=>{
 const token=makeToken({
  liquidityUsd:20000,fdv:200000,volume:{h1:8000},txns:{h1:{buys:16,sells:4}},
  history:[{at:new Date(NOW-30_000).toISOString()}],
  analysis:{score:90,coverage:90,risk:'partial',hardBlocked:false,flags:[]}
 });
 const instance=scanner([token],{bot:{isRunning:()=>true}});
 instance.state.telegramChannels=[{id:'channel-1',enabled:true,chatId:'-1001234567890'}];
 const result=scannerPublicationDiagnostics.call(instance);
 assert.equal(result.discovery.watchEligible,1);
 assert.equal(result.discovery.qualityPass,0);
 assert.equal(result.discovery.opportunityEligible,0);
 assert.match(result.diagnosis,/contrôle on-chain de base/i);
 assert.doesNotMatch(result.diagnosis,/Telegram/i);
});

test('diagnostics identify Telegram delivery configuration blockers', () => {
  const token = makeToken({
    liquidityUsd: 20000, fdv: 200000, volume: { h1: 8000 },
    txns: { h1: { buys: 16, sells: 4 } },
    history: [{ at: new Date(NOW - 30_000).toISOString() }],
    security: { checkedAt: new Date(NOW - 60_000).toISOString() },
    sellability:{status:'route_available',routeAvailable:true,requestedUsd:100,priceImpactPct:1,checkedAt:new Date(NOW-60_000).toISOString()},
    tradeIntel: { checkedAt: new Date(NOW - 60_000).toISOString(), lastTradeAt: new Date(NOW - 60_000).toISOString(), tradeCount: 30, uniqueBuyers: 12, uniqueSellers: 8, buyVolumeUsd: 1200, sellVolumeUsd: 700, rpcConfirmedTradeCount:8, rpcConfirmedUniqueBuyers:12, rpcConfirmedUniqueSellers:8, rpcConfirmedBuyVolumeUsd:1200, rpcConfirmedSellVolumeUsd:700, rpcConfirmedVolumeCoverage:100, rpcConfirmedCheckedAt:new Date(NOW-60_000).toISOString(), rpcConfirmedLastTradeAt:new Date(NOW-60_000).toISOString() },
    analysis: { score: 90, coverage: 90, risk: 'observations_only', securityComprehensive: true, hardBlocked: false, exitCapacityUsd:100, flags: [], factors: { activity: 80, momentum: 80, market: 80, liquidityQuality: 80, executionQuality: 85, security: 90, demandQuality: 78 } }
  });
  const instance = scanner([token]);
  const result = scannerPublicationDiagnostics.call(instance);
  assert.equal(result.discovery.qualityPass, 1);
  assert.equal(result.discovery.opportunityEligible, 1);
  assert.match(result.diagnosis, /bot Telegram/i);
});


test('DexScreener-only transaction snapshots do not replace verified RPC buyer evidence',()=>{
 const token=makeToken({
  liquidityUsd:20000,fdv:200000,volume:{h1:8000},txns:{h1:{buys:16,sells:4}},
  history:[{at:new Date(NOW-30_000).toISOString()}],
  security:{checkedAt:new Date(NOW-60_000).toISOString()},
  sellability:{status:'route_available',routeAvailable:true,requestedUsd:100,priceImpactPct:1,checkedAt:new Date(NOW-60_000).toISOString()},
  analysis:{score:90,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,exitCapacityUsd:100,flags:[],factors:{activity:80,momentum:80,market:80,liquidityQuality:80,executionQuality:85,security:90,demandQuality:78}}
 });
 const instance=scanner([token]);
 instance.state.scannerSettings.requireComprehensiveSecurity=false;
 const result=scannerPublicationDiagnostics.call(instance);
 assert.equal(result.discovery.qualityPass,1);
 assert.equal(result.discovery.opportunityEligible,0);
 assert.equal(result.discovery.qualifiedButUnverifiedDemand,1);
 assert.equal(result.discovery.evidenceFallbackDexScreener,1);
});


test('diagnostics count exact best-selection factor gates instead of reporting false publication eligibility',()=>{
 const token=makeToken({
  liquidityUsd:20000,fdv:200000,volume:{h1:8000},txns:{h1:{buys:16,sells:4}},
  history:[{at:new Date(NOW-30_000).toISOString()}],
  security:{checkedAt:new Date(NOW-60_000).toISOString()},
  tradeIntel:{checkedAt:new Date(NOW-60_000).toISOString()},
  analysis:{score:90,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,flags:[],factors:{market:80,liquidityQuality:80,security:90}}
 });
 const result=scannerPublicationDiagnostics.call(scanner([token]));
 assert.equal(result.discovery.qualityPass,1);
 assert.equal(result.discovery.opportunityEligible,0);
 assert.equal(result.discovery.qualifiedButMissingFactors,1);
 assert.ok(result.mostBlockedCandidates[0].blockers.some(x=>x.includes('activité')));
 assert.ok(result.rejectionReasons.some(x=>x.reason.includes('activité')));
 assert.match(result.diagnosis,/facteur obligatoire/i);
});


test('disabled opportunity publication is diagnosed without blaming missing score factors',()=>{
 const token=makeToken({
  liquidityUsd:20000,fdv:200000,volume:{h1:8000},txns:{h1:{buys:16,sells:4}},
  history:[{at:new Date(NOW-30_000).toISOString()}],
  security:{checkedAt:new Date(NOW-60_000).toISOString()},
  tradeIntel:{checkedAt:new Date(NOW-60_000).toISOString()},
  analysis:{score:90,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,flags:[],factors:{market:80,liquidityQuality:80,security:90}}
 });
 const instance=scanner([token]);
 instance.state.scannerSettings.publishOpportunities=false;
 const result=scannerPublicationDiagnostics.call(instance);
 assert.equal(result.discovery.qualifiedButMissingFactors,0);
 assert.equal(result.rejectionReasons.some(row=>row.reason.includes('Facteurs requis incomplets')),false);
 assert.match(result.diagnosis,/publication des opportunités est désactivée/i);
});


test('diagnostics expose the first failing stage and keep the configured score floor', () => {
  const token = makeToken({
    liquidityUsd: 20000, fdv: 200000, volume: { h1: 8000 },
    txns: { h1: { buys: 16, sells: 4 } },
    history: [{ at: new Date(NOW - 30_000).toISOString() }],
    security: { checkedAt: new Date(NOW - 60_000).toISOString() },
    tradeIntel: { checkedAt: new Date(NOW - 60_000).toISOString() },
    analysis: { score: 79, coverage: 90, risk: 'observations_only', securityComprehensive: true, hardBlocked: false, flags: [], factors: { activity: 80, market: 80, liquidityQuality: 80, security: 90 } }
  });
  const result = scannerPublicationDiagnostics.call(scanner([token]));
  assert.equal(result.settings.minScore, 80);
  assert.equal(result.discovery.pipeline.poolLinked, 1);
  assert.equal(result.discovery.pipeline.score, 0);
  assert.equal(result.discovery.pipeline.coverage, 0);
  assert.ok(result.mostBlockedCandidates[0].blockers.includes('Score inférieur au seuil'));
});

test('qualified candidates with stale security are visible with the exact blocker', () => {
  const token = makeToken({
    liquidityUsd: 20000, fdv: 200000, volume: { h1: 8000 },
    txns: { h1: { buys: 16, sells: 4 } },
    history: [{ at: new Date(NOW - 30_000).toISOString() }],
    security: { checkedAt: new Date(NOW - 120 * 60_000).toISOString() },
    tradeIntel: { checkedAt: new Date(NOW - 60_000).toISOString() },
    analysis: { score: 90, coverage: 90, risk: 'observations_only', securityComprehensive: true, hardBlocked: false, flags: [], factors: { activity: 80, market: 80, liquidityQuality: 80, security: 90 } }
  });
  const result = scannerPublicationDiagnostics.call(scanner([token]));
  assert.equal(result.discovery.qualityPass, 1);
  assert.equal(result.discovery.qualifiedButStaleEvidence, 1);
  assert.equal(result.discovery.pipeline.marketFresh, 1);
  assert.equal(result.discovery.pipeline.securityFresh, 0);
  assert.ok(result.mostBlockedCandidates[0].blockers.some(reason => reason.includes('Contrôle de sécurité trop ancien')));
  assert.ok(result.rejectionReasons.some(row => row.reason === 'Contrôle de sécurité trop ancien'));
});


test('diagnostics expose a production build fingerprint and the actual configured score threshold',()=>{
 const result=scannerPublicationDiagnostics.call(scanner([makeToken()]));
 assert.equal(result.buildFingerprint,'m2meme-diagnostics-v3-20261125');
 assert.equal(result.publication.configuredThreshold,80);
});


test('diagnostics expose token-level security inspection evidence without exposing RPC credentials', () => {
  const token = makeToken({
    security: {
      checkedAt: new Date(NOW - 60_000).toISOString(),
      provider: 'Helius RPC',
      error: 'security object inspection error',
      data: {
        tokenProgram: 'unknown-program',
        isInitialized: true,
        isToken2022: false,
        mintAuthorityActive: true,
        freezeAuthorityActive: false,
        ownerConcentrationAvailable: false
      }
    },
    securityRetryAt: new Date(NOW + 60_000).toISOString(),
    securityCheckFailureCount: 2,
    analysis: { score: 90, coverage: 90, risk: 'partial', hardBlocked: false, flags: [] }
  });
  const result = scannerPublicationDiagnostics.call(scanner([token]));
  const inspection = result.mostBlockedCandidates[0].securityInspection;
  assert.equal(inspection.provider, 'Helius RPC');
  assert.equal(inspection.tokenProgramRecognized, false);
  assert.equal(inspection.isInitialized, true);
  assert.equal(inspection.mintAuthorityKnown, true);
  assert.equal(inspection.freezeAuthorityKnown, true);
  assert.equal(inspection.securityFactorAvailable, false);
  assert.equal(inspection.baseSecurityGatePassed, false);
  assert.equal(inspection.lastError, 'security object inspection error');
  assert.equal(inspection.failureCount, 2);
  assert.equal(JSON.stringify(inspection).includes('apiKey'), false);
});
