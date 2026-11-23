'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, defaultScannerSettings, normalizeScannerSettings, applyScannerSettingsPatch } = require('../lib/scanner-settings');

test('defaults to balanced settings while preserving existing environment defaults', () => {
  assert.deepEqual(defaultScannerSettings({}), { version: 1, preset: 'balanced', minScore: 78, minLiquidityUsd: 5000, publishOpportunities: true, publishRisks: true });
  const env = defaultScannerSettings({ ALERT_MIN_SCORE: '82', MIN_LIQUIDITY_USD: '9000' });
  assert.equal(env.minScore, 82);
  assert.equal(env.minLiquidityUsd, 9000);
  assert.equal(env.preset, 'custom');
});

test('normalizes legacy or malformed saved settings without crashing startup', () => {
  const settings = normalizeScannerSettings({ minScore: 120, minLiquidityUsd: -1, publishRisks: false });
  assert.equal(settings.minScore, 95);
  assert.equal(settings.minLiquidityUsd, 500);
  assert.equal(settings.publishRisks, false);
  assert.equal(settings.publishOpportunities, true);
});

test('presets update score and liquidity together', () => {
  const settings = applyScannerSettingsPatch(defaultScannerSettings({}), { preset: 'prudent' });
  assert.equal(settings.minScore, PRESETS.prudent.minScore);
  assert.equal(settings.minLiquidityUsd, PRESETS.prudent.minLiquidityUsd);
  assert.equal(settings.preset, 'prudent');
});

test('manual thresholds switch the selected preset to custom', () => {
  const settings = applyScannerSettingsPatch(defaultScannerSettings({}), { minScore: 83, minLiquidityUsd: 7500 });
  assert.equal(settings.minScore, 83);
  assert.equal(settings.minLiquidityUsd, 7500);
  assert.equal(settings.preset, 'custom');
});

test('publication toggles are independently configurable', () => {
  const settings = applyScannerSettingsPatch(defaultScannerSettings({}), { publishOpportunities: false, publishRisks: true });
  assert.equal(settings.publishOpportunities, false);
  assert.equal(settings.publishRisks, true);
});

test('rejects out-of-range values and non-boolean publication options', () => {
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { minScore: 49 }), /50 et 95/);
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { minLiquidityUsd: 499 }), /500 et 1 000 000/);
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { publishRisks: 'yes' }), /activées ou désactivées/);
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { preset: 'wild' }), /profil valide/);
});
