'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { COINS, runHistoricalBenchmark, getHistoricalBenchmark } = require('../lib/historical-benchmark');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const scanner = { state: { historicalBenchmarks: {} }, save() {} };
  let attempts = 0;
  const maxAttempts = COINS.length + 2;

  while (attempts < maxAttempts) {
    attempts++;
    const result = await runHistoricalBenchmark.call(scanner);
    if (result.done) break;
    if (result.error) {
      console.warn('[historical-actions] incomplete', result.symbol, result.error);
      // The benchmark module applies a two-minute retry delay to failed tokens.
      // Keep this run bounded; the next scheduled/manual run retries them.
    } else if (result.benchmark) {
      console.log('[historical-actions] completed', result.benchmark.symbol,
        result.progress + '/' + result.total);
    }
    await sleep(250);
  }

  const summary = getHistoricalBenchmark.call(scanner);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    historicalBenchmarks: scanner.state.historicalBenchmarks,
    summary: {
      completed: summary.completed,
      total: summary.total,
      failed: Object.values(scanner.state.historicalBenchmarks).filter(x => !x.completed).length
    }
  };

  const outputPath = path.join(process.cwd(), 'artifacts', 'historical-benchmark.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { mode: 0o600 });
  console.log('[historical-actions] report', output.summary);

  const ingestUrl = process.env.MEME_RADAR_INGEST_URL;
  const token = process.env.MEME_RADAR_ACTIONS_TOKEN;
  if (!ingestUrl || !token) {
    console.warn('[historical-actions] dashboard import skipped: configure MEME_RADAR_INGEST_URL and MEME_RADAR_ACTIONS_TOKEN GitHub repository secrets.');
    return;
  }
  const parsed = new URL(ingestUrl);
  if (parsed.protocol !== 'https:') throw new Error('MEME_RADAR_INGEST_URL must use HTTPS.');
  if (token.length < 32) throw new Error('MEME_RADAR_ACTIONS_TOKEN must contain at least 32 characters.');

  const response = await fetch(parsed, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(output),
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error('Dashboard import failed with HTTP ' + response.status + ': ' + body.slice(0, 300));
  console.log('[historical-actions] dashboard import succeeded:', body.slice(0, 300));
}

main().catch(error => {
  console.error('[historical-actions] fatal:', error.stack || error.message);
  process.exitCode = 1;
});
