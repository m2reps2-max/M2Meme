'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scannerPublicationDiagnostics } = require('../lib/publication-diagnostics');

const NOW = Date.now();
function makeToken(overrides = {}) {
  return {
    mint: 'mint-1', symbol: 'BAD',
    pairAddress: 'pool-1', liquidityUsd: 1200, fdv: 100000,
    volume: { h1: 200 }, txns: { h1: { buys: 2, sells: 8 } },
    history: [{ at: new Date(NOW - 8 * 60_000).toISOString() }],
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

test('diagnostics identify Telegram delivery configuration blockers', () => {
  const token = makeToken({
    liquidityUsd: 20000, fdv: 200000, volume: { h1: 8000 },
    txns: { h1: { buys: 16, sells: 4 } },
    history: [{ at: new Date(NOW - 30_000).toISOString() }],
    security: { checkedAt: new Date(NOW - 60_000).toISOString() },
    tradeIntel: { checkedAt: new Date(NOW - 60_000).toISOString() },
    analysis: { score: 90, coverage: 90, risk: 'observations_only', securityComprehensive: true, hardBlocked: false, flags: [], factors: { activity: 80, momentum: 80, market: 80, liquidityQuality: 80, security: 90 } }
  });
  const instance = scanner([token]);
  const result = scannerPublicationDiagnostics.call(instance);
  assert.equal(result.discovery.qualityPass, 1);
  assert.equal(result.discovery.opportunityEligible, 1);
  assert.match(result.diagnosis, /bot Telegram/i);
});


test('diagnostics count DexScreener-only candidates as publication eligible without Gecko trade IDs',()=>{
 const token=makeToken({
  liquidityUsd:20000,fdv:200000,volume:{h1:8000},txns:{h1:{buys:16,sells:4}},
  history:[{at:new Date(NOW-30_000).toISOString()}],
  security:{checkedAt:new Date(NOW-60_000).toISOString()},
  analysis:{score:90,coverage:90,risk:'observations_only',securityComprehensive:true,hardBlocked:false,flags:[],factors:{activity:80,momentum:80,market:80,liquidityQuality:80,security:90}}
 });
 const instance=scanner([token]);
 instance.state.scannerSettings.requireComprehensiveSecurity=false;
 const result=scannerPublicationDiagnostics.call(instance);
 assert.equal(result.discovery.qualityPass,1);
 assert.equal(result.discovery.opportunityEligible,1);
 assert.equal(result.discovery.evidenceFallbackDexScreener,1);
});
