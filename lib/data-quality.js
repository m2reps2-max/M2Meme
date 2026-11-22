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
  const tradeAt = token.tradeIntel?.checkedAt || null;
  const socialAt = token.socialIntel?.checkedAt || token.blueskyIntel?.checkedAt || null;
  const checks = [
    { key: 'market', label: 'Marché', weight: 25, available: Number(token.priceUsd) > 0 && Number(token.liquidityUsd) > 0 && Boolean(token.volume), detail: 'Prix, liquidité et volume' },
    { key: 'freshMarket', label: 'Fraîcheur marché', weight: 20, available: Boolean(lastSnapshot), freshnessMinutes: ageMinutes(lastSnapshot?.at, now), detail: 'Dernier snapshot de marché' },
    { key: 'security', label: 'Sécurité on-chain', weight: 20, available: Boolean(securityAt && token.security?.data), freshnessMinutes: ageMinutes(securityAt, now), detail: 'Contrôles RPC et détenteurs observés' },
    { key: 'transactions', label: 'Transactions', weight: 15, available: Boolean(tradeAt && token.tradeIntel), freshnessMinutes: ageMinutes(tradeAt, now), detail: 'Échantillon public de transactions du pool' },
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
    completenessPct: completeness, freshnessPct, quality,
    observedAt: lastSnapshot?.at ? new Date(lastSnapshot.at).toISOString() : null,
    sampleCounts: { marketSnapshots: history.length, forecasts: (token.forecasts || []).length, transactionSamples: token.tradeIntel?.tradeCount || 0, identifiedOwners: token.security?.data?.uniqueOwnerCount || 0 },
    checks, issues
  };
}

function dataQualitySummary() {
  const now = Date.now();
  const tokens = Object.values(this.state.tokens || {}).map(token => tokenDataQuality(token, now));
  const counts = { high: 0, medium: 0, low: 0 };
  for (const token of tokens) counts[token.quality]++;
  const averageCompletenessPct = tokens.length ? Math.round(tokens.reduce((sum, token) => sum + token.completenessPct, 0) / tokens.length) : null;
  const freshnessRows = tokens.filter(token => token.freshnessPct !== null);
  const averageFreshnessPct = freshnessRows.length ? Math.round(freshnessRows.reduce((sum, token) => sum + token.freshnessPct, 0) / freshnessRows.length) : null;
  const freshnessCoverageTokens = freshnessRows.length;
  const freshnessCoveragePct = tokens.length ? Number((freshnessCoverageTokens / tokens.length * 100).toFixed(1)) : null;
  return {
    summary: { tokens: tokens.length, ...counts, averageCompletenessPct, averageFreshnessPct, freshnessCoverageTokens, freshnessCoveragePct },
    tokens: tokens.sort((a, b) => a.completenessPct - b.completenessPct || (a.freshnessPct ?? -1) - (b.freshnessPct ?? -1)).slice(0, 250),
    method: 'La complétude mesure la présence des catégories de données; la fraîcheur mesure uniquement les catégories horodatées. Une donnée absente est inconnue, jamais interprétée comme un signal positif. Ces notes ne sont pas des probabilités de réussite.'
  };
}

module.exports = { tokenDataQuality, dataQualitySummary };
