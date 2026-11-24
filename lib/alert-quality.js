'use strict';

function assessAlertFreshness(token, now = Date.now()) {
  const history = Array.isArray(token?.history) ? token.history : [];
  const snapshot = history.at(-1);
  if (!snapshot || snapshot.at === undefined || snapshot.at === null) return { status: 'unknown', ageMinutes: null, observedAt: null };
  const at = typeof snapshot.at === 'number' ? snapshot.at : Date.parse(snapshot.at);
  if (!Number.isFinite(at) || at > now + 60000) return { status: 'unknown', ageMinutes: null, observedAt: null };
  const ageMinutes = Math.max(0, (now - at) / 60000);
  return { status: ageMinutes <= 5 ? 'fresh' : ageMinutes <= 15 ? 'delayed' : 'stale', ageMinutes: Number(ageMinutes.toFixed(1)), observedAt: new Date(at).toISOString() };
}

const NON_BLOCKING_WARNING_CODES = new Set([
  'SAME_BLOCK_BUY_BURST',
  'BUNDLE_LIKE_BURST',
  'SMART_MONEY_SLOT_CLUSTER'
]);

function hasBlockingOpportunityFlags(flags) {
  return (Array.isArray(flags) ? flags : []).some(flag =>
    flag?.level === 'critical' ||
    (flag?.level === 'warning' && !NON_BLOCKING_WARNING_CODES.has(String(flag.code || '')))
  );
}

function isOpportunityRiskAcceptable(analysis = {}) {
  const baseSecurityVerified = Number.isFinite(Number(analysis.factors?.security));
  const riskAccepted = analysis.risk === 'observations_only'
    || analysis.risk === 'medium'
    || (analysis.risk === 'partial' && baseSecurityVerified && analysis.securityComprehensive !== true);
  return analysis.hardBlocked !== true
    && baseSecurityVerified
    && riskAccepted
    && !hasBlockingOpportunityFlags(analysis.flags);
}

function qualifyOpportunity(token, settings = {}) {
  const analysis = token?.analysis || {};
  const txns = token?.txns?.h1 || {};
  const buys = Number(txns.buys);
  const sells = Number(txns.sells);
  const total = (Number.isFinite(buys) ? buys : 0) + (Number.isFinite(sells) ? sells : 0);
  const liquidity = Number(token?.liquidityUsd);
  const volume1h = Number(token?.volume?.h1);
  const fdv = Number(token?.fdv ?? token?.marketCap);
  const buyRatioPct = total > 0 ? (Number.isFinite(buys) ? buys : 0) / total * 100 : null;
  const fdvLiquidityRatio = liquidity > 0 && Number.isFinite(fdv) && fdv > 0 ? fdv / liquidity : null;
  const checks = [
    [Boolean(token?.pairAddress || token?.geckoPoolAddress), 'Pool DEX introuvable'],
    [Number.isFinite(Number(analysis.score)) && Number(analysis.score) >= Number(settings.minScore ?? 80), 'Score inférieur au seuil'],
    [Number.isFinite(Number(analysis.coverage)) && Number(analysis.coverage) >= Number(settings.minCoverage ?? 70), 'Couverture des facteurs insuffisante'],
    [Number.isFinite(liquidity) && liquidity >= Number(settings.minLiquidityUsd ?? 5000), 'Liquidité insuffisante'],
    [Number.isFinite(volume1h) && volume1h >= Number(settings.minVolume1hUsd ?? 750), 'Volume 1h insuffisant'],
    [total >= Number(settings.minTransactions1h ?? 8), 'Activité transactionnelle insuffisante'],
    [buyRatioPct !== null && buyRatioPct >= Number(settings.minBuyRatioPct ?? 50), 'Pression acheteuse insuffisante'],
    [fdvLiquidityRatio !== null && fdvLiquidityRatio <= Number(settings.maxFdvLiquidityRatio ?? 35), 'Valorisation trop élevée par rapport à la liquidité'],
    [Number.isFinite(Number(analysis.factors?.security)), 'Contrôle on-chain de base incomplet'],
    [analysis.hardBlocked !== true, 'Token bloqué par un contrôle de sécurité'],
    [isOpportunityRiskAcceptable(analysis), 'Risque ou sécurité non suffisamment maîtrisés'],
    [settings.requireComprehensiveSecurity === false || analysis.securityComprehensive === true, 'Analyse des détenteurs incomplète'],
    [!hasBlockingOpportunityFlags(analysis.flags), 'Signal de risque encore présent']
  ];
  const reasons = checks.filter(([passed]) => !passed).map(([, reason]) => reason);
  return {
    eligible: reasons.length === 0,
    reasons,
    metrics: {
      liquidityUsd: Number.isFinite(liquidity) ? liquidity : null,
      volume1hUsd: Number.isFinite(volume1h) ? volume1h : null,
      transactions1h: total,
      buyRatioPct: buyRatioPct === null ? null : Number(buyRatioPct.toFixed(1)),
      fdvLiquidityRatio: fdvLiquidityRatio === null ? null : Number(fdvLiquidityRatio.toFixed(2))
    }
  };
}

function qualifyAlertLevel(token, proposedLevel, score, now = Date.now()) {
  const freshness = assessAlertFreshness(token, now);
  if (proposedLevel === 'none') return { level: 'none', freshness, reason: null };
  if (freshness.status === 'fresh') return { level: proposedLevel, freshness, reason: null };
  if (freshness.status === 'delayed' && Number(score) >= 60) {
    return { level: 'watch', freshness, reason: 'Signal dégradé : dernier snapshot marché il y a ' + freshness.ageMinutes + ' min. Confirmation nécessaire; aucune alerte Telegram.' };
  }
  return {
    level: 'none',
    freshness,
    reason: freshness.status === 'unknown' ? 'Signal ignoré : aucun snapshot marché horodaté disponible.' : 'Signal ignoré : dernier snapshot marché trop ancien (' + freshness.ageMinutes + ' min).'
  };
}

module.exports = { assessAlertFreshness, qualifyAlertLevel, qualifyOpportunity, hasBlockingOpportunityFlags, isOpportunityRiskAcceptable };
