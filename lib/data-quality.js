'use strict';

const time = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
};
const ageMinutes = (value, now) => {
  const at = time(value);
  return at === null || at > now + 60000 ? null : Math.max(0, (now - at) / 60000);
};

function tokenDataQuality(token, now = Date.now()) {
  const history = Array.isArray(token.history) ? token.history : [];
  const lastSnapshot = history.at(-1) || null;
  const securityAt = token.security?.checkedAt || null;
  const marketObservedAt=token.marketObservedAt||lastSnapshot?.at||null;
  const marketVolumeAt=token.marketFieldsObservedAt?.volume||null;
  const marketTransactionsAt=token.marketFieldsObservedAt?.txns||null;
  const marketVolumeAge=ageMinutes(marketVolumeAt,now);
  const tradeAt = token.tradeIntel?.rpcConfirmedCheckedAt || token.tradeIntel?.checkedAt || null;
  const rpcTradeCount=Number(token.tradeIntel?.rpcConfirmedTradeCount)||0;
  const socialAt = token.socialIntel?.checkedAt || token.xIntel?.checkedAt || token.nostrIntel?.checkedAt || token.telegramIntel?.checkedAt || token.blueskyIntel?.checkedAt || null;
  const hasMarketVolume = token.volume?.h24 !== null && token.volume?.h24 !== undefined && Number.isFinite(Number(token.volume.h24)) && marketVolumeAge !== null && marketVolumeAge <= 15;
  const checks = [
    { key: 'market', label: 'Marché', weight: 25, available: Number(token.priceUsd) > 0 && Number(token.liquidityUsd) > 0 && hasMarketVolume, detail: 'Prix, liquidité et au moins une mesure de volume numérique' },
    { key: 'freshMarket', label: 'Fraîcheur marché', weight: 20, available: Boolean(marketObservedAt), freshnessMinutes: ageMinutes(marketObservedAt, now), detail: 'Dernière observation réelle prix/liquidité' },
    { key: 'security', label: 'Autorités du token', weight: 10, available: Boolean(securityAt && typeof token.security?.data?.freezeAuthorityActive === 'boolean' && typeof token.security?.data?.mintAuthorityActive === 'boolean'), freshnessMinutes: ageMinutes(securityAt, now), detail: 'Mint authority et freeze authority' },
    { key: 'holders', label: 'Concentration des détenteurs', weight: 10, available: Boolean(securityAt && token.security?.data?.ownerConcentrationAvailable === true && token.security?.data?.top10HolderPercent !== null && Number.isFinite(Number(token.security.data.top10HolderPercent))), freshnessMinutes: ageMinutes(securityAt, now), detail: 'Propriétaires identifiés sur les 20 plus gros comptes observés' },
    { key: 'transactions', label: 'Transactions', weight: 15, available: Boolean(tradeAt && token.tradeIntel && rpcTradeCount >= 5), freshnessMinutes: ageMinutes(tradeAt, now), detail: 'Swaps du pool confirmés par RPC Helius et propriétaires signataires identifiés' },
    { key: 'social', label: 'Social', weight: 10, available: Boolean(socialAt || token.socialIntel?.available || token.blueskyIntel?.available), freshnessMinutes: ageMinutes(socialAt, now), detail: 'Mentions publiques observées' },
    { key: 'launch', label: 'Provenance lancement', weight: 10, available: Boolean(token.launchSource || token.geckoPoolAddress || token.pairAddress || token.firstSeenAt), detail: 'Source et ancienneté de découverte' }
  ];
  let completeness = 0, freshness = 0, freshnessWeight = 0;
  for (const check of checks) {
    if (check.available) completeness += check.weight;
    if (check.available && check.freshnessMinutes !== undefined && check.freshnessMinutes !== null) {
      freshnessWeight += check.weight;
      freshness += check.weight * (check.freshnessMinutes <= 2 ? 1 : check.freshnessMinutes <= 15 ? 0.7 : check.freshnessMinutes <= 60 ? 0.35 : 0);
    }
  }
  const freshnessPct = freshnessWeight ? Math.round(freshness / freshnessWeight * 100) : null;
  const issues = [];
  for (const check of checks) {
    if (!check.available) issues.push({ key: check.key, severity: 'missing', message: check.label + ' : données non disponibles' });
    else if (check.freshnessMinutes !== undefined && check.freshnessMinutes === null) issues.push({ key: check.key, severity: 'unknown_timestamp', message: check.label + ' : horodatage absent ou invalide' });
    else if (check.freshnessMinutes !== undefined && check.freshnessMinutes > 15) issues.push({ key: check.key, severity: 'stale', message: check.label + ' : données anciennes' });
  }
  const quality = completeness >= 80 && freshnessPct !== null && freshnessPct >= 70 ? 'high' : completeness >= 50 ? 'medium' : 'low';
  return {
    mint: token.mint, symbol: token.symbol || '—', name: token.name || 'Token',
    readiness: !(token.pairAddress || token.geckoPoolAddress) ? 'awaiting_market' : Number(token.analysis?.coverage || 0) >= 70 ? 'complete' : Number(token.analysis?.coverage || 0) >= 45 ? 'partial' : 'insufficient_data',
    completenessPct: completeness, freshnessPct, quality,
    observedAt: lastSnapshot?.at ? new Date(lastSnapshot.at).toISOString() : null,
    sampleCounts: { marketSnapshots: history.length, forecasts: (token.forecasts || []).length, transactionSamples: Math.max(Number(token.tradeIntel?.tradeCount)||0,rpcTradeCount), verifiedPoolSwaps: rpcTradeCount, rpcDistinctBuyers: Number(token.tradeIntel?.rpcConfirmedUniqueBuyers)||0, marketVolumeObservedAt:marketVolumeAt, marketTransactionsObservedAt:marketTransactionsAt, identifiedOwners: token.security?.data?.uniqueOwnerCount || 0 },
    checks, issues
  };
}

function dataQualitySummary(now = Date.now()) {
  const tokens = Object.values(this.state.tokens || {}).map(token => tokenDataQuality(token, now));
  const counts = { high: 0, medium: 0, low: 0 };
  const readinessCounts = { awaiting_market: 0, insufficient_data: 0, partial: 0, complete: 0 };
  for (const token of tokens) { counts[token.quality]++; readinessCounts[token.readiness] = (readinessCounts[token.readiness] || 0) + 1; }
  const sourceNames = { dexscreener: 'DexScreener', geckoTerminal: 'GeckoTerminal', solanaRpc: 'Solana RPC', poolTradeRpc:'Swaps de pools Helius', pumpPortal: 'PumpPortal', redditRss: 'Reddit', bluesky: 'Bluesky', nostr: 'Nostr', telegramSocial: 'Telegram social', xSocial: 'X social' };
  const liveSources = typeof this.status === 'function' ? this.status() : {};
  const sourceDiagnostics = Object.entries(sourceNames).map(([key, label]) => { const source = liveSources[key] || this.state.sources?.[key]; const connected = source?.connected === true || source?.ok === true; const error = source?.error || source?.lastError || null; return { key, label, status: connected ? (error ? 'degraded' : 'connected') : error ? 'degraded' : 'pending', lastSuccess: source?.lastSuccess || source?.at || null, error }; });
  const averageCompletenessPct = tokens.length ? Math.round(tokens.reduce((sum, token) => sum + token.completenessPct, 0) / tokens.length) : null;
  const freshnessRows = tokens.filter(token => token.freshnessPct !== null);
  const averageFreshnessPct = freshnessRows.length ? Math.round(freshnessRows.reduce((sum, token) => sum + token.freshnessPct, 0) / freshnessRows.length) : null;
  const freshnessCoverageTokens = freshnessRows.length;
  const freshnessCoveragePct = tokens.length ? Number((freshnessCoverageTokens / tokens.length * 100).toFixed(1)) : null;
  return {
    summary: { tokens: tokens.length, ...counts, readinessCounts, degradedSources: sourceDiagnostics.filter(source => source.status === 'degraded').length, pendingSources: sourceDiagnostics.filter(source => source.status === 'pending').length, averageCompletenessPct, averageFreshnessPct, freshnessCoverageTokens, freshnessCoveragePct },
    sources: sourceDiagnostics,
    tokens: tokens.sort((a, b) => a.completenessPct - b.completenessPct || (a.freshnessPct ?? -1) - (b.freshnessPct ?? -1)).slice(0, 250),
    method: 'La complétude mesure la présence des catégories de données; la fraîcheur mesure uniquement les catégories horodatées. Une donnée absente est inconnue, jamais interprétée comme un signal positif. Ces notes ne sont pas des probabilités de réussite.'
  };
}

module.exports = { tokenDataQuality, dataQualitySummary };
