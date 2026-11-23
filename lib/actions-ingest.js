'use strict';

function constantTimeEqual(expected, supplied) {
  if (typeof expected !== 'string' || typeof supplied !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && a.length > 0 && require('node:crypto').timingSafeEqual(a, b);
}

function validateHistoricalPayload(payload, allowedSymbols) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Invalid payload' };
  if (payload.schemaVersion !== 1) return { ok: false, error: 'Unsupported schema version' };
  if (!payload.historicalBenchmarks || typeof payload.historicalBenchmarks !== 'object' || Array.isArray(payload.historicalBenchmarks)) {
    return { ok: false, error: 'Missing historical benchmark map' };
  }
  const entries = Object.entries(payload.historicalBenchmarks);
  if (!entries.length || entries.length > allowedSymbols.size) return { ok: false, error: 'Invalid benchmark count' };
  for (const [symbol, row] of entries) {
    if (!allowedSymbols.has(symbol) || !row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: 'Unknown or invalid benchmark entry' };
    }
    if (row.symbol !== symbol) return { ok: false, error: 'Benchmark symbol mismatch' };
    if (row.completed === true) {
      if (!Number.isFinite(row.terminalReturnPct) || !Number.isFinite(row.maxDrawdownPct) ||
          !Array.isArray(row.signals) || row.signals.length > 180) {
        return { ok: false, error: 'Invalid completed benchmark metrics' };
      }
    } else if (typeof row.error !== 'string' || row.error.length > 300) {
      return { ok: false, error: 'Invalid incomplete benchmark entry' };
    }
  }
  return { ok: true };
}

const ADAPTIVE_FEATURES = ['activity','momentum','market','liquidityQuality','security','earlyBuyerSignal','walletReputationSignal','timing'];
const ADAPTIVE_HORIZONS = ['15m','1h','6h','24h','7d'];
function validAdaptiveMetric(row) {
  return Boolean(row && Number.isInteger(row.tokens) && row.tokens >= 0 && row.tokens <= 250000 &&
    ['averageReturnPct','grossAverageReturnPct','medianReturnPct'].every(key => row[key] === null || (Number.isFinite(row[key]) && row[key] >= -1000 && row[key] <= 1000)) &&
    ['positive15Pct','loss20Pct'].every(key => row[key] === null || (Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 100)));
}
function validAdaptiveModel(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model) ||
      !['insufficient_sample','not_validated','validated'].includes(model.status) ||
      typeof model.enabled !== 'boolean' ||
      !Number.isInteger(model.observations) || model.observations < 0 || model.observations > 250000 ||
      !Number.isInteger(model.trainingTokens) || model.trainingTokens < 0 || model.trainingTokens > 250000 ||
      !Number.isInteger(model.validationTokens) || model.validationTokens < 0 || model.validationTokens > 250000 ||
      model.trainingTokens + model.validationTokens > 250000 ||
      !Array.isArray(model.features) || model.features.length > ADAPTIVE_FEATURES.length ||
      typeof model.reason !== 'string' || model.reason.length > 500 ||
      typeof model.limitations !== 'string' || model.limitations.length > 2000) return false;
  const seen = new Set();
  for (const row of model.features) {
    if (!row || !ADAPTIVE_FEATURES.includes(row.key) || seen.has(row.key) ||
        !Number.isFinite(row.correlation) || row.correlation < -1 || row.correlation > 1 ||
        !Number.isInteger(row.samples) || row.samples < 0 || row.samples > 250000 ||
        !Number.isFinite(row.weight) || row.weight < -1 || row.weight > 1) return false;
    seen.add(row.key);
  }
  for (const [field,min,max] of [['coefficients',-1,1],['means',0,100],['stds',0,100]]) {
    if (model[field] === undefined) continue;
    if (!model[field] || typeof model[field] !== 'object' || Array.isArray(model[field]) ||
        Object.entries(model[field]).some(([key,value]) => !ADAPTIVE_FEATURES.includes(key) || !Number.isFinite(value) || value < min || value > max)) return false;
  }
  if (model.holdout !== null) {
    const holdout = model.holdout;
    if (!holdout || typeof holdout !== 'object' || Array.isArray(holdout) ||
        !['top','staticScoreTop','randomSameSize','all'].every(key => validAdaptiveMetric(holdout[key])) ||
        !Number.isInteger(holdout.selectedTokens) || holdout.selectedTokens < 0 || holdout.selectedTokens > 250000 ||
        !Number.isInteger(holdout.comparisonSampleSize) || holdout.comparisonSampleSize < holdout.selectedTokens || holdout.comparisonSampleSize > 250000 ||
        !['upliftVsStaticPctPoints','upliftVsRandomPctPoints'].every(key => holdout[key] === null || (Number.isFinite(holdout[key]) && holdout[key] >= -2000 && holdout[key] <= 2000))) return false;
    if (!holdout.horizons || typeof holdout.horizons !== 'object' || Array.isArray(holdout.horizons) ||
        ADAPTIVE_HORIZONS.some(key => {
          const row = holdout.horizons[key];
          return !row || !validAdaptiveMetric(row.top) || !validAdaptiveMetric(row.staticScoreTop) ||
            !validAdaptiveMetric(row.randomSameSize) ||
            !Number.isInteger(row.comparisonSampleSize) || row.comparisonSampleSize < row.top.tokens || row.comparisonSampleSize > 250000 ||
            !['upliftVsStaticPctPoints','upliftVsRandomPctPoints'].every(field => row[field] === null || (Number.isFinite(row[field]) && row[field] >= -2000 && row[field] <= 2000));
        }) || Object.keys(holdout.horizons).some(key => !ADAPTIVE_HORIZONS.includes(key))) return false;
  }
  if (model.enabled && (model.status !== 'validated' || model.observations < 250 ||
      model.trainingTokens < 200 || model.validationTokens < 50 || !model.holdout ||
      model.holdout.selectedTokens < 15 || model.holdout.upliftVsStaticPctPoints < 5 ||
      model.holdout.upliftVsRandomPctPoints < 5)) return false;
  if (model.evaluation !== undefined && (!model.evaluation || model.evaluation.returnBasis !== 'net_simulated' ||
      model.evaluation.entrySlippagePct !== 0.5 || model.evaluation.exitSlippagePct !== 0.5 ||
      model.evaluation.feePerSidePct !== 0.3 || model.evaluation.minimumObservations !== 250 ||
      model.evaluation.minimumTraining !== 200 || model.evaluation.minimumValidation !== 50 ||
      model.evaluation.minimumTopSample !== 15)) return false;
  return true;
}

function validateArchiveLearningPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.schemaVersion !== 1) {
    return { ok: false, error: 'Invalid archive learning schema' };
  }
  if (!Number.isFinite(Date.parse(payload.generatedAt || ''))) return { ok: false, error: 'Invalid archive learning timestamp' };
  const summary = payload.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return { ok: false, error: 'Missing archive learning summary' };
  for (const key of ['archiveTokensScanned', 'tokensWithForecasts', 'uniqueResolvedTokens1h']) {
    if (!Number.isInteger(summary[key]) || summary[key] < 0 || summary[key] > 250000) {
      return { ok: false, error: 'Invalid archive learning count: ' + key };
    }
  }
  if (!Number.isInteger(summary.forecasts) || summary.forecasts < 0 || summary.forecasts > 2000000) {
    return { ok: false, error: 'Invalid archive forecast count' };
  }
  const allowedHorizons = ['15m', '1h', '6h', '24h', '7d'];
  const validateMetric = (row, maxCount = 2000000) => Boolean(row &&
    Number.isInteger(row.resolved) && row.resolved >= 0 && row.resolved <= maxCount &&
    [row.averageReturnPct, row.positive15Pct, row.loss20Pct].every(value =>
      value === null || (Number.isFinite(value) && value >= -10000 && value <= 10000)));
  const horizons = summary.horizons;
  if (!horizons || typeof horizons !== 'object' || Array.isArray(horizons) ||
      allowedHorizons.some(key => !validateMetric(horizons[key])) ||
      Object.keys(horizons).some(key => !allowedHorizons.includes(key))) {
    return { ok: false, error: 'Invalid archive learning horizons' };
  }
  const allowedBands = ['0-44', '45-64', '65-79', '80-100'];
  const bands = summary.scoreBands;
  if (!bands || typeof bands !== 'object' || Array.isArray(bands) ||
      allowedBands.some(key => !validateMetric(bands[key])) ||
      Object.keys(bands).some(key => !allowedBands.includes(key))) {
    return { ok: false, error: 'Invalid archive score bands' };
  }
  const sources = summary.bySource;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources) || Object.keys(sources).length > 30) {
    return { ok: false, error: 'Invalid archive source aggregates' };
  }
  for (const [source, row] of Object.entries(sources)) {
    if (!source || source.length > 80 || !validateMetric(row)) return { ok: false, error: 'Invalid archive source metric' };
  }
  if (summary.adaptiveModel !== undefined && !validAdaptiveModel(summary.adaptiveModel)) return { ok: false, error: 'Invalid archive adaptive model' };
  const walk = summary.walkForward;
  if (!walk || typeof walk !== 'object' || Array.isArray(walk) ||
      !Number.isInteger(walk.trainingTokens) || !Number.isInteger(walk.validationTokens) ||
      walk.trainingTokens < 0 || walk.validationTokens < 0 ||
      walk.trainingTokens + walk.validationTokens > 250000 ||
      !validateMetric(walk.validation, 250000)) {
    return { ok: false, error: 'Invalid archive walk-forward summary' };
  }
  if (typeof summary.limitations !== 'string' || summary.limitations.length > 2000) {
    return { ok: false, error: 'Invalid archive learning limitations' };
  }
  return { ok: true };
}

function mergeHistoricalBenchmarks(existing, incoming, now = Date.now()) {
  const merged = { ...(existing || {}) };
  for (const [symbol, row] of Object.entries(incoming || {})) {
    const previous = merged[symbol];
    const previousFresh = previous?.completed === true &&
      Number.isFinite(Date.parse(previous.fetchedAt || '')) &&
      now - Date.parse(previous.fetchedAt) < 7 * 86400000;
    if (row.completed === true || !previousFresh) merged[symbol] = row;
  }
  return merged;
}

module.exports = { constantTimeEqual, validateHistoricalPayload, validateArchiveLearningPayload, mergeHistoricalBenchmarks, validAdaptiveModel };
