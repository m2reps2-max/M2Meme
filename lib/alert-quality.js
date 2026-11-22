'use strict';

function assessAlertFreshness(token, now = Date.now()) {
  const history = Array.isArray(token?.history) ? token.history : [];
  const snapshot = history.at(-1);
  if (!snapshot || snapshot.at === undefined || snapshot.at === null) {
    return { status: 'unknown', ageMinutes: null, observedAt: null };
  }
  const at = typeof snapshot.at === 'number' ? snapshot.at : Date.parse(snapshot.at);
  if (!Number.isFinite(at) || at > now + 60000) {
    return { status: 'unknown', ageMinutes: null, observedAt: null };
  }
  const ageMinutes = Math.max(0, (now - at) / 60000);
  return {
    status: ageMinutes <= 5 ? 'fresh' : ageMinutes <= 15 ? 'delayed' : 'stale',
    ageMinutes: Number(ageMinutes.toFixed(1)),
    observedAt: new Date(at).toISOString()
  };
}

function qualifyAlertLevel(token, proposedLevel, score, now = Date.now()) {
  const freshness = assessAlertFreshness(token, now);
  if (proposedLevel === 'none') return { level: 'none', freshness, reason: null };
  if (freshness.status === 'fresh') return { level: proposedLevel, freshness, reason: null };
  if (freshness.status === 'delayed' && Number(score) >= 60) {
    return {
      level: 'watch',
      freshness,
      reason: 'Signal dégradé : dernier snapshot marché il y a ' + freshness.ageMinutes + ' min. Confirmation nécessaire; aucune alerte Telegram.'
    };
  }
  return {
    level: 'none',
    freshness,
    reason: freshness.status === 'unknown'
      ? 'Signal ignoré : aucun snapshot marché horodaté disponible.'
      : 'Signal ignoré : dernier snapshot marché trop ancien (' + freshness.ageMinutes + ' min).'
  };
}

module.exports = { assessAlertFreshness, qualifyAlertLevel };
