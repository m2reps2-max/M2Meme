'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HORIZONS = ['15m', '1h', '6h', '24h', '7d'];
const BANDS = [
  ['0-44', 0, 44],
  ['45-64', 45, 64],
  ['65-79', 65, 79],
  ['80-100', 80, 100]
];
const PAGE_SIZE = 200;
const MAX_ARCHIVE_ROWS = 250000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function bucket() {
  return { resolved: 0, sum: 0, positive: 0, losses: 0 };
}

function summarize(value) {
  return {
    resolved: value.resolved,
    averageReturnPct: value.resolved ? Number((value.sum / value.resolved).toFixed(2)) : null,
    positive15Pct: value.resolved ? Number((value.positive / value.resolved * 100).toFixed(1)) : null,
    loss20Pct: value.resolved ? Number((value.losses / value.resolved * 100).toFixed(1)) : null
  };
}

function add(bucketValue, outcome) {
  const ret = Number(outcome?.returnPct);
  if (!Number.isFinite(ret)) return false;
  bucketValue.resolved++;
  bucketValue.sum += ret;
  if (ret >= 15) bucketValue.positive++;
  if (ret <= -20 || ['loss', 'severe_loss', 'liquidity_stress', 'liquidity_collapse'].includes(outcome.label)) bucketValue.losses++;
  return true;
}

function firstSignalMetrics(rows) {
  const result = bucket();
  for (const row of rows) add(result, row.outcome);
  return summarize(result);
}

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: 'Bearer ' + token, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Archive endpoint HTTP ' + response.status + ': ' + text.slice(0, 300));
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error('Archive endpoint returned invalid JSON'); }
}

async function main() {
  const endpoint = process.env.MEME_RADAR_INGEST_URL;
  const token = process.env.MEME_RADAR_ACTIONS_TOKEN;
  if (!endpoint || !token || token.length < 32) throw new Error('Configure MEME_RADAR_INGEST_URL and a 32+ character MEME_RADAR_ACTIONS_TOKEN.');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error('MEME_RADAR_INGEST_URL must use HTTPS.');

  const horizonBuckets = Object.fromEntries(HORIZONS.map(key => [key, bucket()]));
  const scoreBuckets = Object.fromEntries(BANDS.map(([key]) => [key, bucket()]));
  const sourceBuckets = new Map();
  const firstByMint = new Map();
  let cursor = '';
  let archiveTokensScanned = 0;
  let tokensWithForecasts = 0;
  let forecasts = 0;
  let pages = 0;

  while (true) {
    if (pages >= Math.ceil(MAX_ARCHIVE_ROWS / PAGE_SIZE) + 1) throw new Error('Archive export exceeded the hard page limit.');
    const pageUrl = new URL(url);
    pageUrl.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) pageUrl.searchParams.set('cursor', cursor);
    const page = await requestJson(pageUrl, token);
    if (page.error) throw new Error(page.error);
    if (!Array.isArray(page.items) || !Number.isInteger(page.scanned) || page.scanned < 0 || page.scanned > PAGE_SIZE) {
      throw new Error('Invalid archive page response.');
    }
    if (page.scanned && (!page.nextCursor || page.nextCursor <= cursor)) throw new Error('Archive cursor did not advance.');
    archiveTokensScanned += page.scanned;
    if (archiveTokensScanned > MAX_ARCHIVE_ROWS) throw new Error('Archive export exceeded 250,000 rows.');
    pages++;

    for (const item of page.items) {
      if (!item || typeof item.mint !== 'string' || !Array.isArray(item.forecasts)) continue;
      if (item.forecasts.length) tokensWithForecasts++;
      let first = null;
      for (const forecast of item.forecasts.slice(-8)) {
        forecasts++;
        const score = Number(forecast.score);
        const hasScore = Number.isFinite(score);
        for (const horizon of HORIZONS) {
          const outcome = forecast.outcomes?.[horizon];
          if (!outcome || !add(horizonBuckets[horizon], outcome)) continue;
          if (horizon === '1h' && hasScore) {
            const band = BANDS.find(([, min, max]) => score >= min && score <= max)?.[0];
            if (band) add(scoreBuckets[band], outcome);
          }
        }
        const oneHour = forecast.outcomes?.['1h'];
        if (oneHour && Number.isFinite(Number(oneHour.returnPct))) {
          const source = String(forecast.source || 'Source inconnue').slice(0, 80);
          if (!sourceBuckets.has(source) && sourceBuckets.size < 30) sourceBuckets.set(source, bucket());
          if (sourceBuckets.has(source)) add(sourceBuckets.get(source), oneHour);
          const at = Number(forecast.at);
          if (Number.isFinite(at) && (!first || at < first.at)) first = { mint: item.mint, at, score: hasScore ? score : null, outcome: oneHour };
        }
      }
      if (first) {
        const previous = firstByMint.get(item.mint);
        if (!previous || first.at < previous.at) firstByMint.set(item.mint, first);
      }
    }

    console.log('[archive-learning] page ' + pages + ', scanned ' + archiveTokensScanned + ', tokens with forecasts ' + tokensWithForecasts);
    if (page.done) break;
    cursor = page.nextCursor;
    await sleep(80);
  }

  const firstSignals = [...firstByMint.values()].sort((a, b) => a.at - b.at);
  const splitAt = Math.floor(firstSignals.length * 0.8);
  const training = firstSignals.slice(0, splitAt);
  const validation = firstSignals.slice(splitAt);
  const summary = {
    archiveTokensScanned,
    tokensWithForecasts,
    forecasts,
    firstResolvedTokens: firstSignals.length,
    horizons: Object.fromEntries(HORIZONS.map(key => [key, summarize(horizonBuckets[key])])),
    scoreBands: Object.fromEntries(BANDS.map(([key]) => [key, summarize(scoreBuckets[key])])),
    bySource: Object.fromEntries([...sourceBuckets.entries()].map(([key, value]) => [key, summarize(value)])),
    walkForward: {
      method: 'Un premier résultat 1h résolu par mint, tri chronologique; 80% des tokens les plus anciens en entraînement descriptif, 20% les plus récents en validation descriptive. Aucun seuil n’est modifié automatiquement.',
      trainingTokens: training.length,
      validationTokens: validation.length,
      validation: firstSignalMetrics(validation)
    },
    limitations: 'Archive froide uniquement; les tokens actifs conservés dans le fichier principal ne sont pas inclus. Les prévisions historiques sont compactées à huit par token. Les observations ne sont pas des trades exécutés et ne modélisent ni frais, ni slippage, ni impact de marché, ni capacité réelle de sortie. Biais de sélection et de survivance possibles.'
  };
  const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), summary };
  const outputDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'archive-learning.json'), JSON.stringify(output, null, 2) + '\n', { mode: 0o600 });

  const response = await requestJson(url, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(output)
  });
  if (response.ok !== true) throw new Error('Dashboard archive learning import was not confirmed.');
  console.log('[archive-learning] imported', JSON.stringify({ ...summary, bySource: Object.keys(summary.bySource).length }));
}

main().catch(error => {
  console.error('[archive-learning] fatal:', error.stack || error.message);
  process.exitCode = 1;
});
