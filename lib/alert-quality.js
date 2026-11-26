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
  'SMART_MONEY_SLOT_CLUSTER',
  // Uncertain/contextual warnings; hard numeric and security gates still apply.
  'SOCIAL_AUTHOR_CONCENTRATION',
  'ELITE_RECURRENT_CREATOR_FUNDER',
  'HIGH_FDV_LIQUIDITY',
  // These are explicitly uncertain or contextual observations, not proof of a
  // honeypot, malicious control, or coordinated dump. Keep them visible as
  // warnings, but do not let them veto every otherwise-qualified opportunity.
  'SELL_ROUTE_UNAVAILABLE',
  'TOP10_ACCOUNT_CONCENTRATION_UNVERIFIED',
  'CREATOR_SELL_OBSERVED',
  'EARLY_WALLET_SELL_CLUSTER',
  'ELITE_ORGANIC_DEMAND_SUSPECT',
  'TOKEN_2022_TRANSFER_HOOK',
  'TOKEN_2022_CONFIDENTIAL_TRANSFER',
  'EXTERNAL_SECURITY_UNVERIFIED',
  'EXTERNAL_SECURITY_RISK',
  'CREATOR_HISTORY_RISK',
  'SELL_ROUTE_HIGH_IMPACT'
]);

function hasBlockingOpportunityFlags(flags) {
  return (Array.isArray(flags) ? flags : []).some(flag =>
    flag?.level === 'critical' ||
    (flag?.level === 'warning' && !NON_BLOCKING_WARNING_CODES.has(String(flag.code || '')))
  );
}

function isOpportunityRiskAcceptable(analysis = {}) {
  const baseSecurityVerified = typeof analysis.factors?.security === 'number' && Number.isFinite(analysis.factors.security);
  const riskAccepted = analysis.risk === 'observations_only'
    || analysis.risk === 'medium'
    || (analysis.risk === 'partial' && baseSecurityVerified && (analysis.securityPublicationReady === true || analysis.securityComprehensive !== true));
  return analysis.hardBlocked !== true
    && baseSecurityVerified
    && riskAccepted
    && !hasBlockingOpportunityFlags(analysis.flags);
}

const MAX_STATIC_SECURITY_EVIDENCE_AGE_MINUTES = 24 * 60;
const MAX_DYNAMIC_SECURITY_EVIDENCE_AGE_MINUTES = 15;
const MAX_SECURITY_EVIDENCE_AGE_MINUTES = MAX_DYNAMIC_SECURITY_EVIDENCE_AGE_MINUTES;
const MAX_TRADE_EVIDENCE_AGE_MINUTES = 15;
const MAX_SELLABILITY_EVIDENCE_AGE_MINUTES = 10;

function evidenceAgeMinutes(value, now) {
  const at = Date.parse(value || '');
  return Number.isFinite(at) && at <= now + 60000 ? Math.max(0, (now - at) / 60000) : null;
}

function assessOpportunityEvidence(token, now = Date.now()) {
  const security = token?.security || {};
  const staticAt = security.staticCheckedAt || security.checkedAt;
  const dynamicAt = security.holderCheckedAt || security.data?.holderCheckedAt || security.checkedAt;
  const staticSecurityAgeMinutes = evidenceAgeMinutes(staticAt, now);
  const dynamicSecurityAgeMinutes = evidenceAgeMinutes(dynamicAt, now);
  const staticSecurityFresh = staticSecurityAgeMinutes !== null && staticSecurityAgeMinutes <= MAX_STATIC_SECURITY_EVIDENCE_AGE_MINUTES;
  const dynamicSecurityFresh = dynamicSecurityAgeMinutes !== null && dynamicSecurityAgeMinutes <= MAX_DYNAMIC_SECURITY_EVIDENCE_AGE_MINUTES;
  const securityFresh = staticSecurityFresh && dynamicSecurityFresh;
  const market = assessAlertFreshness(token, now);
  const buys = Number(token?.txns?.h1?.buys);
  const sells = Number(token?.txns?.h1?.sells);
  const hasMarketTransactions = (Number.isFinite(buys) ? buys : 0) + (Number.isFinite(sells) ? sells : 0) > 0;
  const tradeAgeMinutes = evidenceAgeMinutes(token?.tradeIntel?.checkedAt, now);
  const geckoTradeFresh = tradeAgeMinutes !== null && tradeAgeMinutes <= MAX_TRADE_EVIDENCE_AGE_MINUTES;
  const marketTradeFresh = market.status === 'fresh' && hasMarketTransactions;
  const transactionFresh = geckoTradeFresh || marketTradeFresh;
  return {
    eligible: securityFresh && transactionFresh,
    securityFresh,
    staticSecurityFresh,
    dynamicSecurityFresh,
    staticSecurityAgeMinutes: staticSecurityAgeMinutes === null ? null : Number(staticSecurityAgeMinutes.toFixed(1)),
    dynamicSecurityAgeMinutes: dynamicSecurityAgeMinutes === null ? null : Number(dynamicSecurityAgeMinutes.toFixed(1)),
    securityAgeMinutes: dynamicSecurityAgeMinutes === null ? null : Number(dynamicSecurityAgeMinutes.toFixed(1)),
    transactionFresh,
    transactionSource: geckoTradeFresh ? 'geckoterminal_trades' : marketTradeFresh ? 'dexscreener_snapshot' : 'unavailable',
    transactionAgeMinutes: geckoTradeFresh ? Number(tradeAgeMinutes.toFixed(1)) : marketTradeFresh ? market.ageMinutes : null,
    marketFresh: market.status === 'fresh'
  };
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
    [Number.isFinite(liquidity) && liquidity >= Number(settings.minLiquidityUsd ?? 5000), 'Liquidité insuffisante'],
    [Number.isFinite(volume1h) && volume1h >= Number(settings.minVolume1hUsd ?? 750), 'Volume 1h insuffisant'],
    [total >= Number(settings.minTransactions1h ?? 8), 'Activité transactionnelle insuffisante'],
    [buyRatioPct !== null && buyRatioPct >= Number(settings.minBuyRatioPct ?? 50), 'Pression acheteuse insuffisante'],
    [fdvLiquidityRatio !== null && fdvLiquidityRatio <= Number(settings.maxFdvLiquidityRatio ?? 35), 'Valorisation trop élevée par rapport à la liquidité'],
    [typeof analysis.factors?.security === 'number' && Number.isFinite(analysis.factors.security), 'Contrôle on-chain de base incomplet'],
    [analysis.hardBlocked !== true, 'Token bloqué par un contrôle de sécurité'],
    [isOpportunityRiskAcceptable(analysis), 'Risque ou sécurité non suffisamment maîtrisés'],
    [settings.requireComprehensiveSecurity !== true || analysis.securityComprehensive === true || analysis.securityPublicationReady === true, 'Échantillon de détenteurs insuffisant pour valider la sécurité'],
    [!hasBlockingOpportunityFlags(analysis.flags), 'Signal de risque encore présent']
  ];
  const tradeCheckedAt=Date.parse(token?.tradeIntel?.checkedAt||'');
  const tradeEvidenceFresh=Number.isFinite(tradeCheckedAt)&&tradeCheckedAt<=Date.now()+60000&&Date.now()-tradeCheckedAt<=MAX_TRADE_EVIDENCE_AGE_MINUTES*60000;
  const tradeSampleSize=Number(token?.tradeIntel?.tradeCount)||0;
  const uniqueBuyerValue=token?.tradeIntel?.uniqueBuyers;
  const uniqueBuyers=uniqueBuyerValue===null||uniqueBuyerValue===undefined?null:Number(uniqueBuyerValue);
  const buyValue=token?.tradeIntel?.buyVolumeUsd,sellValue=token?.tradeIntel?.sellVolumeUsd;
  const buyVolume=buyValue===null||buyValue===undefined?null:Number(buyValue),sellVolume=sellValue===null||sellValue===undefined?null:Number(sellValue);
  if(tradeEvidenceFresh&&tradeSampleSize>=20){
    if(uniqueBuyers!==null&&Number.isFinite(uniqueBuyers))checks.push([uniqueBuyers>=5,'Moins de cinq acheteurs distincts dans l’échantillon récent']);
    if(buyVolume!==null&&sellVolume!==null&&Number.isFinite(buyVolume)&&Number.isFinite(sellVolume))checks.push([buyVolume>=sellVolume*0.8,'Flux vendeur dominant dans l’échantillon récent']);
  }
  const sellabilityRows = [...(Array.isArray(token?.sellabilityChecks) ? token.sellabilityChecks : []), ...(token?.sellability ? [token.sellability] : [])];
  const latestSellabilityBySize = new Map();
  for (const row of sellabilityRows) {
    const size = Number(row?.requestedUsd || 100), prior = latestSellabilityBySize.get(size);
    if (!prior || Date.parse(row?.checkedAt || 0) >= Date.parse(prior?.checkedAt || 0)) latestSellabilityBySize.set(size, row);
  }
  const sellabilityFreshRows = [...latestSellabilityBySize.values()].filter(row => {
    const at = Date.parse(row?.checkedAt || '');
    return Number.isFinite(at) && at <= Date.now() + 60000 && Date.now() - at <= MAX_SELLABILITY_EVIDENCE_AGE_MINUTES * 60000;
  });
  const testedNotionalUsd = row => { const actual=Number(row?.inputAmountUsd); if(Number.isFinite(actual)&&actual>0)return actual; const requested=Number(row?.requestedUsd||100); return Number.isFinite(requested)&&requested>0?requested:0; };
  const lowNotionalExitFailure = sellabilityFreshRows.find(row => testedNotionalUsd(row) <= 100 && (row.status === 'no_route' || row.status === 'high_impact'));
  if (lowNotionalExitFailure?.status === 'no_route') checks.push([false, 'Aucune route de sortie Jupiter pour un test de 100 USD ou moins']);
  if (lowNotionalExitFailure?.status === 'high_impact') checks.push([false, 'Impact de prix trop élevé même sur un test de 100 USD ou moins']);
  const sellabilityAt = Date.parse(token?.sellability?.checkedAt || '');
  const sellabilityAge = Number.isFinite(sellabilityAt) ? Math.max(0, (Date.now() - sellabilityAt) / 60000) : null;
  const reasons = checks.filter(([passed]) => !passed).map(([, reason]) => reason);
  return {
    eligible: reasons.length === 0,
    reasons,
    warnings: (Array.isArray(analysis.flags) ? analysis.flags : [])
      .filter(flag => flag?.level === 'warning' && NON_BLOCKING_WARNING_CODES.has(String(flag.code || '')))
      .map(flag => String(flag.message || 'Point de vigilance détecté.').slice(0, 180))
      .slice(0, 3),
    metrics: {
      liquidityUsd: Number.isFinite(liquidity) ? liquidity : null,
      volume1hUsd: Number.isFinite(volume1h) ? volume1h : null,
      transactions1h: total,
      buyRatioPct: buyRatioPct === null ? null : Number(buyRatioPct.toFixed(1)),
      fdvLiquidityRatio: fdvLiquidityRatio === null ? null : Number(fdvLiquidityRatio.toFixed(2)),
      uniqueBuyers: token?.tradeIntel?.uniqueBuyers!==null&&token?.tradeIntel?.uniqueBuyers!==undefined&&Number.isFinite(Number(token.tradeIntel.uniqueBuyers)) ? Number(token.tradeIntel.uniqueBuyers) : null,
      netBuyVolumeUsd: token?.tradeIntel?.buyVolumeUsd!==null&&token?.tradeIntel?.buyVolumeUsd!==undefined&&token?.tradeIntel?.sellVolumeUsd!==null&&token?.tradeIntel?.sellVolumeUsd!==undefined&&Number.isFinite(Number(token.tradeIntel.buyVolumeUsd))&&Number.isFinite(Number(token.tradeIntel.sellVolumeUsd)) ? Number((Number(token.tradeIntel.buyVolumeUsd) - Number(token.tradeIntel.sellVolumeUsd)).toFixed(2)) : null,
      sellabilityAgeMinutes: sellabilityAge === null ? null : Number(sellabilityAge.toFixed(1))
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

module.exports = { assessAlertFreshness, assessOpportunityEvidence, MAX_STATIC_SECURITY_EVIDENCE_AGE_MINUTES, MAX_DYNAMIC_SECURITY_EVIDENCE_AGE_MINUTES, MAX_SECURITY_EVIDENCE_AGE_MINUTES, MAX_TRADE_EVIDENCE_AGE_MINUTES, MAX_SELLABILITY_EVIDENCE_AGE_MINUTES, qualifyAlertLevel, qualifyOpportunity, hasBlockingOpportunityFlags, isOpportunityRiskAcceptable };
