'use strict';

const PRESETS = Object.freeze({
  elite: Object.freeze({ minScore: 80, minLiquidityUsd: 5000, minVolume1hUsd: 750, minCoverage: 70, minTransactions1h: 8, minBuyRatioPct: 50, maxFdvLiquidityRatio: 35, requireComprehensiveSecurity: false }),
  prudent: Object.freeze({ minScore: 85, minLiquidityUsd: 7500, minVolume1hUsd: 1500, minCoverage: 75, minTransactions1h: 10, minBuyRatioPct: 52, maxFdvLiquidityRatio: 30, requireComprehensiveSecurity: false }),
  balanced: Object.freeze({ minScore: 82, minLiquidityUsd: 5000, minVolume1hUsd: 750, minCoverage: 70, minTransactions1h: 8, minBuyRatioPct: 50, maxFdvLiquidityRatio: 35, requireComprehensiveSecurity: false }),
  large: Object.freeze({ minScore: 76, minLiquidityUsd: 5000, minVolume1hUsd: 750, minCoverage: 70, minTransactions1h: 8, minBuyRatioPct: 48, maxFdvLiquidityRatio: 50, requireComprehensiveSecurity: true })
});

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function defaultScannerSettings(env = process.env) {
  const values = {
    minScore: boundedInteger(env.ALERT_MIN_SCORE, PRESETS.elite.minScore, 50, 95),
    minLiquidityUsd: boundedInteger(env.MIN_LIQUIDITY_USD, PRESETS.elite.minLiquidityUsd, 500, 1000000),
    minVolume1hUsd: boundedInteger(env.MIN_VOLUME_1H_USD, PRESETS.elite.minVolume1hUsd, 0, 1000000),
    minCoverage: boundedInteger(env.MIN_SCORE_COVERAGE, PRESETS.elite.minCoverage, 50, 100),
    minTransactions1h: boundedInteger(env.MIN_TXNS_1H, PRESETS.elite.minTransactions1h, 1, 1000),
    minBuyRatioPct: boundedInteger(env.MIN_BUY_RATIO_PCT, PRESETS.elite.minBuyRatioPct, 0, 100),
    maxFdvLiquidityRatio: boundedInteger(env.MAX_FDV_LIQUIDITY_RATIO, PRESETS.elite.maxFdvLiquidityRatio, 5, 200),
    requireComprehensiveSecurity: PRESETS.elite.requireComprehensiveSecurity
  };
  return { version: 3, preset: identifyPreset(values), ...values, publishOpportunities: true, publishRisks: true };
}

function identifyPreset(values) {
  return Object.entries(PRESETS).find(([, preset]) =>
    Object.keys(preset).every(key => values[key] === preset[key])
  )?.[0] || 'custom';
}

function normalizeScannerSettings(input, env = process.env) {
  const defaults = defaultScannerSettings(env);
  const row = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const version = Number(row.version || 1);
  const legacy = version < 2;
  const needsEliteGateMigration = version < 3
    && Number(row.minLiquidityUsd) === 15000
    && Number(row.minVolume1hUsd ?? 5000) === 5000
    && Number(row.minCoverage ?? 85) === 85
    && Number(row.minTransactions1h ?? 20) === 20
    && Number(row.minBuyRatioPct ?? 55) === 55
    && Number(row.maxFdvLiquidityRatio ?? 20) === 20
    && row.requireComprehensiveSecurity !== false;
  const legacyBalancedDefault = legacy && row.preset === 'balanced'
    && Number(row.minScore) === 78 && Number(row.minLiquidityUsd) === 5000;
  const legacyPreset = legacyBalancedDefault ? PRESETS.elite : PRESETS[row.preset] || defaults;
  const fallback = legacy ? legacyPreset : defaults;
  const values = {
    minScore: boundedInteger(legacyBalancedDefault ? undefined : row.minScore, fallback.minScore, 50, 95),
    minLiquidityUsd: boundedInteger(legacyBalancedDefault || needsEliteGateMigration ? undefined : row.minLiquidityUsd, fallback.minLiquidityUsd, 500, 1000000),
    minVolume1hUsd: boundedInteger(needsEliteGateMigration ? undefined : row.minVolume1hUsd, fallback.minVolume1hUsd, 0, 1000000),
    minCoverage: boundedInteger(needsEliteGateMigration ? undefined : row.minCoverage, fallback.minCoverage, 50, 100),
    minTransactions1h: boundedInteger(needsEliteGateMigration ? undefined : row.minTransactions1h, fallback.minTransactions1h, 1, 1000),
    minBuyRatioPct: boundedInteger(needsEliteGateMigration ? undefined : row.minBuyRatioPct, fallback.minBuyRatioPct, 0, 100),
    maxFdvLiquidityRatio: boundedInteger(needsEliteGateMigration ? undefined : row.maxFdvLiquidityRatio, fallback.maxFdvLiquidityRatio, 5, 200),
    requireComprehensiveSecurity: needsEliteGateMigration ? false : row.requireComprehensiveSecurity !== false
  };
  return {
    version: 3,
    preset: identifyPreset(values),
    ...values,
    publishOpportunities: row.publishOpportunities !== false,
    publishRisks: row.publishRisks !== false
  };
}

function applyScannerSettingsPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Réglages invalides.');
  const next = normalizeScannerSettings(current);
  if (Object.prototype.hasOwnProperty.call(patch, 'preset')) {
    const preset = String(patch.preset || '');
    if (preset === 'custom') next.preset = 'custom';
    else {
      if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) throw new Error('Choisis un profil valide.');
      Object.assign(next, PRESETS[preset]);
      next.preset = preset;
    }
  }
  const ranges = {
    minScore: [50, 95, 'Le score minimum doit être compris entre 50 et 95.'],
    minLiquidityUsd: [500, 1000000, 'La liquidité minimale doit être comprise entre 500 et 1 000 000 $.'],
    minVolume1hUsd: [0, 1000000, 'Le volume minimum 1h doit être compris entre 0 et 1 000 000 $.'],
    minCoverage: [50, 100, 'La couverture minimale doit être comprise entre 50 et 100 %.'],
    minTransactions1h: [1, 1000, 'Le nombre minimum de transactions 1h doit être compris entre 1 et 1 000.'],
    minBuyRatioPct: [0, 100, 'Le ratio acheteurs minimum doit être compris entre 0 et 100 %.'],
    maxFdvLiquidityRatio: [5, 200, 'Le ratio FDV/liquidité maximum doit être compris entre 5 et 200.']
  };
  for (const [key, [min, max, message]] of Object.entries(ranges)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = Number(patch[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(message);
    next[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'requireComprehensiveSecurity')) {
    if (typeof patch.requireComprehensiveSecurity !== 'boolean') throw new Error('Le contrôle de sécurité complet doit être activé ou désactivé.');
    next.requireComprehensiveSecurity = patch.requireComprehensiveSecurity;
  }
  for (const key of ['publishOpportunities', 'publishRisks']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      if (typeof patch[key] !== 'boolean') throw new Error('Les options de publication doivent être activées ou désactivées.');
      next[key] = patch[key];
    }
  }
  next.preset = identifyPreset(next);
  return next;
}

module.exports = { PRESETS, defaultScannerSettings, normalizeScannerSettings, applyScannerSettingsPatch };
