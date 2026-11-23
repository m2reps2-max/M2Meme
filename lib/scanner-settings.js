'use strict';

const PRESETS = Object.freeze({
  prudent: Object.freeze({ minScore: 85, minLiquidityUsd: 10000 }),
  balanced: Object.freeze({ minScore: 78, minLiquidityUsd: 5000 }),
  large: Object.freeze({ minScore: 70, minLiquidityUsd: 2500 })
});

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function defaultScannerSettings(env = process.env) {
  const minScore = boundedInteger(env.ALERT_MIN_SCORE, 78, 50, 95);
  const minLiquidityUsd = boundedInteger(env.MIN_LIQUIDITY_USD, 5000, 500, 1000000);
  const preset = Object.entries(PRESETS).find(([, value]) => value.minScore === minScore && value.minLiquidityUsd === minLiquidityUsd)?.[0] || 'custom';
  return { version: 1, preset, minScore, minLiquidityUsd, publishOpportunities: true, publishRisks: true };
}

function identifyPreset(minScore, minLiquidityUsd) {
  return Object.entries(PRESETS).find(([, value]) => value.minScore === minScore && value.minLiquidityUsd === minLiquidityUsd)?.[0] || 'custom';
}

function normalizeScannerSettings(input, env = process.env) {
  const defaults = defaultScannerSettings(env);
  const row = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const minScore = boundedInteger(row.minScore, defaults.minScore, 50, 95);
  const minLiquidityUsd = boundedInteger(row.minLiquidityUsd, defaults.minLiquidityUsd, 500, 1000000);
  return {
    version: 1,
    preset: identifyPreset(minScore, minLiquidityUsd),
    minScore,
    minLiquidityUsd,
    publishOpportunities: row.publishOpportunities !== false,
    publishRisks: row.publishRisks !== false
  };
}

function applyScannerSettingsPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Réglages invalides.');
  const next = normalizeScannerSettings(current);
  if (Object.prototype.hasOwnProperty.call(patch, 'preset')) {
    const preset = String(patch.preset || '');
    if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) throw new Error('Choisis un profil valide.');
    next.preset = preset;
    next.minScore = PRESETS[preset].minScore;
    next.minLiquidityUsd = PRESETS[preset].minLiquidityUsd;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'minScore')) {
    const value = Number(patch.minScore);
    if (!Number.isInteger(value) || value < 50 || value > 95) throw new Error('Le score minimum doit être compris entre 50 et 95.');
    next.minScore = value;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'minLiquidityUsd')) {
    const value = Number(patch.minLiquidityUsd);
    if (!Number.isInteger(value) || value < 500 || value > 1000000) throw new Error('La liquidité minimale doit être comprise entre 500 et 1 000 000 $.');
    next.minLiquidityUsd = value;
  }
  for (const key of ['publishOpportunities', 'publishRisks']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      if (typeof patch[key] !== 'boolean') throw new Error('Les options de publication doivent être activées ou désactivées.');
      next[key] = patch[key];
    }
  }
  next.preset = identifyPreset(next.minScore, next.minLiquidityUsd);
  return next;
}

module.exports = { PRESETS, defaultScannerSettings, normalizeScannerSettings, applyScannerSettingsPatch };
