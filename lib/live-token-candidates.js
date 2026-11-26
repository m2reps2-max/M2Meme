'use strict';

function resolveLiveTokenCandidates(candidates, tokens) {
  if (!Array.isArray(candidates) || !tokens || typeof tokens !== 'object') return [];
  const resolved = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const mint = typeof candidate === 'string' ? candidate : candidate?.mint;
    if (typeof mint !== 'string' || !mint || seen.has(mint)) continue;
    const token = tokens[mint];
    if (!token || typeof token !== 'object') continue;
    seen.add(mint);
    resolved.push(token);
  }
  return resolved;
}

module.exports = { resolveLiveTokenCandidates };
