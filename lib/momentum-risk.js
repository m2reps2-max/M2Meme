'use strict';

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateMomentumRisk(token = {}) {
  const change = token.priceChange || {};
  const m5 = numberOrNull(change.m5);
  const h1 = numberOrNull(change.h1);
  const h24 = numberOrNull(change.h24);
  const buys = numberOrNull(token.txns?.m5?.buys);
  const sells = numberOrNull(token.txns?.m5?.sells);
  const total = (buys ?? 0) + (sells ?? 0);
  const buyRatio = total > 0 ? (buys ?? 0) / total : null;
  const volume5m = numberOrNull(token.volume?.m5);
  const volume1h = numberOrNull(token.volume?.h1);
  const relativeVolume5m = volume5m !== null && volume1h !== null && volume1h > 0
    ? volume5m / (volume1h / 12)
    : null;
  const flags = Array.isArray(token.analysis?.flags) ? token.analysis.flags : [];
  const creatorOrEarlySales = flags.some(flag =>
    ['CREATOR_SELL_OBSERVED', 'EARLY_WALLET_SELL_CLUSTER'].includes(String(flag?.code || ''))
  );

  // A large cumulative return is context, never a veto by itself.
  const extendedMove = (h1 !== null && h1 >= 80) || (h24 !== null && h24 >= 200);
  const earlyMomentum = m5 !== null && m5 >= 0 && m5 <= 15
    && total >= 8 && buyRatio !== null && buyRatio >= 0.58
    && relativeVolume5m !== null && relativeVolume5m >= 1.15;
  const accelerationWithoutConfirmation = m5 !== null && m5 >= 18
    && ((relativeVolume5m !== null && relativeVolume5m < 1.2)
      || (buyRatio !== null && buyRatio < 0.55));
  const profitTakingPressure = total >= 8 && sells !== null && buys !== null
    && sells >= Math.max(5, buys * 1.4);
  const pullback = h1 !== null && h1 >= 15 && m5 !== null && m5 <= -3;
  const exhaustion = (m5 !== null && m5 <= -8 && profitTakingPressure)
    || (m5 !== null && m5 <= -12 && relativeVolume5m !== null && relativeVolume5m < 0.6)
    || (creatorOrEarlySales && profitTakingPressure && m5 !== null && m5 < 0);
  // Only a confirmed, acute sell-off is a hard publication veto. +200% alone
  // can never reach this condition.
  const blockPublication = m5 !== null && m5 <= -18
    && total >= 10 && buys !== null && sells !== null
    && sells >= Math.max(8, buys * 1.5);

  let adjustment = 0;
  if (earlyMomentum) adjustment += 7;
  if (extendedMove) adjustment -= 3;
  if (accelerationWithoutConfirmation) adjustment -= 8;
  if (profitTakingPressure) adjustment -= 8;
  if (pullback) adjustment -= 3;
  if (exhaustion) adjustment -= 12;
  if (blockPublication) adjustment -= 25;
  adjustment = Math.max(-30, Math.min(10, adjustment));

  const signals = [];
  if (earlyMomentum) signals.push('Début de mouvement soutenu par les achats et le volume');
  if (extendedMove) signals.push('Hausse déjà avancée : potentiel restant à confirmer, pas d’exclusion automatique');
  if (accelerationWithoutConfirmation) signals.push('Accélération du prix insuffisamment confirmée par le volume ou les acheteurs');
  if (profitTakingPressure) signals.push('Pression de prises de bénéfices : les ventes récentes dominent');
  if (pullback) signals.push('Repli après une hausse : attendre de voir si les acheteurs reviennent');
  if (exhaustion) signals.push('Signes d’essoufflement détectés');
  if (blockPublication) signals.push('Vente brutale confirmée sur les dernières minutes : publication suspendue');
  if (!signals.length) signals.push('Pas de signal de momentum suffisamment documenté');

  const status = blockPublication ? 'selloff'
    : exhaustion ? 'exhaustion'
    : profitTakingPressure ? 'profit_taking'
    : pullback ? 'pullback'
    : accelerationWithoutConfirmation ? 'unconfirmed_acceleration'
    : extendedMove ? 'extended'
    : earlyMomentum ? 'early_momentum'
    : 'neutral';

  return {
    status,
    adjustment,
    blockPublication,
    metrics: {
      priceChange5mPct: m5,
      priceChange1hPct: h1,
      priceChange24hPct: h24,
      buys5m: buys,
      sells5m: sells,
      buyRatio5mPct: buyRatio === null ? null : Number((buyRatio * 100).toFixed(1)),
      relativeVolume5m: relativeVolume5m === null ? null : Number(relativeVolume5m.toFixed(2))
    },
    detectors: {
      earlyMomentum,
      extendedMove,
      accelerationWithoutConfirmation,
      profitTakingPressure,
      exhaustion,
      pullback
    },
    signals
  };
}

module.exports = { evaluateMomentumRisk };
