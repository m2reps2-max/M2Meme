'use strict';

const MIN_SECURITY_REFRESH_AGE_MS = 10 * 60 * 1000;

function rankSecurityCandidates(tokens, now = Date.now(), limit = 4) {
  const rows = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!token?.mint || !(token.pairAddress || token.geckoPoolAddress)) continue;
    const retryAt = Date.parse(token.securityRetryAt || '');
    if (Number.isFinite(retryAt) && retryAt > now) continue;
    const checkedAt = Date.parse(token.security?.checkedAt || '');
    const ageMs = Number.isFinite(checkedAt) && checkedAt <= now ? Math.max(0, now - checkedAt) : Infinity;
    if (ageMs <= MIN_SECURITY_REFRESH_AGE_MS) continue;
    const score = Number(token.analysis?.score);
    const normalizedScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
    const ageHours = Number.isFinite(ageMs) ? ageMs / 3600000 : 0;
    // Prioritize the strongest candidates first. A modest age bonus preserves
    // fairness among similar scores without letting thousands of uninspected,
    // low-score tokens block fresh evidence for the current best candidates.
    const ageBonus = Number.isFinite(ageMs)
      ? Math.min(15, 4 + Math.max(0, ageHours - 1) * 0.5)
      : 20;
    const launchBonus = token.launchSource ? 3 : 0;
    // Keep fresh security evidence flowing to viable near-threshold candidates.
    // Very high scores on already blocked/unknown-risk tokens must not monopolize
    // the tiny per-scan inspection budget ahead of candidates that could publish.
    const risk = token.analysis?.risk;
    const riskPenalty = token.analysis?.hardBlocked === true ? 50 : risk === 'high' ? 30 : risk === 'unknown' ? 20 : 0;
    rows.push({ token, priority: normalizedScore * 0.85 + ageBonus + launchBonus - riskPenalty, checkedAt: Number.isFinite(checkedAt) ? checkedAt : 0 });
  }
  rows.sort((a, b) => b.priority - a.priority || a.checkedAt - b.checkedAt
    || (Number(b.token.liquidityUsd) || 0) - (Number(a.token.liquidityUsd) || 0)
    || String(a.token.mint).localeCompare(String(b.token.mint)));
  const count = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 4;
  return rows.slice(0, count).map(row => row.token);
}

module.exports = { MIN_SECURITY_REFRESH_AGE_MS, rankSecurityCandidates };
