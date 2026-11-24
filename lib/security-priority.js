'use strict';

const MIN_SECURITY_REFRESH_AGE_MS = 60 * 60 * 1000;

function rankSecurityCandidates(tokens, now = Date.now(), limit = 4) {
  const rows = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!token?.mint || !(token.pairAddress || token.geckoPoolAddress)) continue;
    const checkedAt = Date.parse(token.security?.checkedAt || '');
    const ageMs = Number.isFinite(checkedAt) && checkedAt <= now ? Math.max(0, now - checkedAt) : Infinity;
    if (ageMs <= MIN_SECURITY_REFRESH_AGE_MS) continue;
    const score = Number(token.analysis?.score);
    const normalizedScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
    const ageHours = Number.isFinite(ageMs) ? ageMs / 3600000 : 12;
    // Strong candidates are checked first; the capped age bonus prevents starvation.
    const ageBonus = Number.isFinite(ageMs) ? Math.min(60, ageHours * 2.5) : 12;
    const launchBonus = token.launchSource ? 3 : 0;
    rows.push({ token, priority: normalizedScore * 0.85 + ageBonus + launchBonus, checkedAt: Number.isFinite(checkedAt) ? checkedAt : 0 });
  }
  rows.sort((a, b) => b.priority - a.priority || a.checkedAt - b.checkedAt
    || (Number(b.token.liquidityUsd) || 0) - (Number(a.token.liquidityUsd) || 0)
    || String(a.token.mint).localeCompare(String(b.token.mint)));
  const count = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 4;
  return rows.slice(0, count).map(row => row.token);
}

module.exports = { MIN_SECURITY_REFRESH_AGE_MS, rankSecurityCandidates };
