'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, defaultScannerSettings, normalizeScannerSettings, applyScannerSettingsPatch } = require('../lib/scanner-settings');
const { freshState, normalizeState } = require('../lib/state-normalizer');

test('defaults to the elite profile with multiple independent quality thresholds', () => {
  const settings = defaultScannerSettings({});
  assert.equal(settings.preset, 'elite');
  assert.equal(settings.minScore, 80);
  assert.equal(settings.minLiquidityUsd, 5000);
  assert.equal(settings.minVolume1hUsd, 750);
  assert.equal(settings.minCoverage, 70);
  assert.equal(settings.minTransactions1h, 8);
  assert.equal(settings.minBuyRatioPct, 50);
  assert.equal(settings.maxFdvLiquidityRatio, 35);
  assert.equal(settings.requireComprehensiveSecurity, true);
  assert.equal(settings.requireExternalSecurity, false);
});

test('migrates the old untouched balanced default to elite without breaking custom thresholds', () => {
  const migrated = normalizeScannerSettings({ version: 1, preset: 'balanced', minScore: 78, minLiquidityUsd: 5000 });
  assert.equal(migrated.preset, 'elite');
  assert.equal(migrated.minScore, 80);
  assert.equal(migrated.minLiquidityUsd, 5000);
  const custom = normalizeScannerSettings({ version: 1, preset: 'custom', minScore: 83, minLiquidityUsd: 9000 });
  assert.equal(custom.preset, 'custom');
  assert.equal(custom.minScore, 83);
  assert.equal(custom.minLiquidityUsd, 9000);
});

test('environment overrides remain supported while all other quality gates stay strict', () => {
  const env = defaultScannerSettings({ ALERT_MIN_SCORE: '90', MIN_LIQUIDITY_USD: '20000' });
  assert.equal(env.minScore, 90);
  assert.equal(env.minLiquidityUsd, 20000);
  assert.equal(env.minVolume1hUsd, PRESETS.elite.minVolume1hUsd);
  assert.equal(env.preset, 'custom');
});

test('normalizes legacy or malformed saved settings without crashing startup', () => {
  const settings = normalizeScannerSettings({ version: 2, minScore: 120, minLiquidityUsd: -1, minCoverage: 110, publishRisks: false });
  assert.equal(settings.minScore, 95);
  assert.equal(settings.minLiquidityUsd, 500);
  assert.equal(settings.minCoverage, 100);
  assert.equal(settings.publishRisks, false);
  assert.equal(settings.publishOpportunities, true);
});

test('presets update every quality threshold together', () => {
  const settings = applyScannerSettingsPatch(defaultScannerSettings({}), { preset: 'balanced' });
  assert.deepEqual(
    Object.fromEntries(Object.keys(PRESETS.balanced).map(key => [key, settings[key]])),
    PRESETS.balanced
  );
  assert.equal(settings.preset, 'balanced');
});

test('manual thresholds switch the selected preset to custom', () => {
  const settings = applyScannerSettingsPatch(defaultScannerSettings({}), { minScore: 91, minLiquidityUsd: 25000, minVolume1hUsd: 8000 });
  assert.equal(settings.minScore, 91);
  assert.equal(settings.minLiquidityUsd, 25000);
  assert.equal(settings.minVolume1hUsd, 8000);
  assert.equal(settings.preset, 'custom');
});

test('complete holder security cannot be disabled for the best shortlist',()=>{
 const fromOld=normalizeScannerSettings({version:3,requireComprehensiveSecurity:false});
 assert.equal(fromOld.requireComprehensiveSecurity,true);
 const patched=applyScannerSettingsPatch(defaultScannerSettings({}),{requireComprehensiveSecurity:false});
 assert.equal(patched.requireComprehensiveSecurity,true);
});

test('publication toggles are independently configurable', () => {
  const settings = applyScannerSettingsPatch(defaultScannerSettings({}), { publishOpportunities: false, publishRisks: true });
  assert.equal(settings.publishOpportunities, false);
  assert.equal(settings.publishRisks, true);
});

test('rejects out-of-range values and non-boolean publication options', () => {
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { minScore: 49 }), /50 et 95/);
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { minLiquidityUsd: 499 }), /500 et 1 000 000/);
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { minCoverage: 49 }), /50 et 100/);
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { publishRisks: 'yes' }), /activées ou désactivées/);
  assert.throws(() => applyScannerSettingsPatch(defaultScannerSettings({}), { preset: 'wild' }), /profil valide/);
});

test('scanner settings survive the existing state normalization and persistence model', () => {
  const state = normalizeState(freshState());
  state.scannerSettings = applyScannerSettingsPatch(state.scannerSettings, { preset: 'large', publishRisks: false });
  const restored = normalizeState(state);
  assert.equal(restored.scannerSettings.preset, 'large');
  assert.equal(restored.scannerSettings.minScore, PRESETS.large.minScore);
  assert.equal(restored.scannerSettings.minLiquidityUsd, PRESETS.large.minLiquidityUsd);
  assert.equal(restored.scannerSettings.minVolume1hUsd, PRESETS.large.minVolume1hUsd);
  assert.equal(restored.scannerSettings.publishRisks, false);
});

test('external provider verification remains optional after loading old saved settings',()=>{
 assert.equal(normalizeScannerSettings({version:3,minScore:80}).requireExternalSecurity,false);
 assert.equal(normalizeState({...freshState(),scannerSettings:{version:3,minScore:80}}).scannerSettings.requireExternalSecurity,false);
});
