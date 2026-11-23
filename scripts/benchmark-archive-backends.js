'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { TokenArchive, compactToken } = require('../lib/token-archive');

const MiB = 1024 * 1024;
const count = Math.max(1000, Math.min(250000, Number(process.env.MEME_ARCHIVE_BENCH_COUNT) || 50000));
const batchSize = 250;

function memorySnapshot() {
  const usage = process.memoryUsage();
  const maxRss = process.resourceUsage().maxRSS;
  return {
    heapMiB: usage.heapUsed / MiB,
    externalMiB: usage.external / MiB,
    rssMiB: usage.rss / MiB,
    maxRssMiB: process.platform === 'darwin' ? maxRss / MiB : maxRss / 1024
  };
}

function createToken(i) {
  const mint = 'bench_mint_' + String(i).padStart(9, '0');
  return {
    mint,
    name: 'Benchmark token ' + i,
    symbol: 'B' + (i % 10000),
    updatedAt: new Date(1700000000000 + i * 1000).toISOString(),
    firstSeenAt: new Date(1699900000000 + i * 1000).toISOString(),
    liquidityUsd: 1000 + (i % 100000),
    analysis: { score: i % 100, factors: { activity: 20, momentum: 18, market: 12, liquidity: 14, security: 13 } },
    history: Array.from({ length: 8 }, (_, n) => ({ at: 1700000000000 + i * 1000 + n, price: 0.00001 * (n + 1), volume: 1000 + n * 25 })),
    forecasts: Array.from({ length: 12 }, (_, n) => ({ at: 1700000000000 + n * 60000, horizon: n, expected: n * 1.5 })),
    smartMoney: { hits: 3, wallets: Array.from({ length: 16 }, (_, n) => 'wallet_' + ((i + n) % 20000)) },
    creatorOutflows: Array.from({ length: 10 }, (_, n) => ({ at: n, amount: n * 0.1 })),
    links: ['https://example.com/token/' + i],
    sources: ['dexscreener', 'geckoterminal', 'helius']
  };
}

async function generateFixture(file) {
  const output = fs.createWriteStream(file, { mode: 0o600 });
  for (let i = 0; i < count; i++) {
    if (!output.write(JSON.stringify(createToken(i)) + '\n')) {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          output.off('drain', onDrain);
          output.off('error', onError);
        };
        const onDrain = () => { cleanup(); resolve(); };
        const onError = error => { cleanup(); reject(error); };
        output.once('drain', onDrain);
        output.once('error', onError);
      });
    }
  }
  await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
}

async function readBatches(file, callback) {
  const input = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let batch = [];
  for await (const line of lines) {
    if (!line) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= batchSize) {
      await callback(batch);
      batch = [];
    }
  }
  if (batch.length) await callback(batch);
}

async function runWorker(adapter, fixture, dbDir) {
  const before = memorySnapshot();
  let peak = { ...before };
  const sample = () => {
    const now = memorySnapshot();
    peak.heapMiB = Math.max(peak.heapMiB, now.heapMiB);
    peak.externalMiB = Math.max(peak.externalMiB, now.externalMiB);
    peak.rssMiB = Math.max(peak.rssMiB, now.rssMiB);
    peak.maxRssMiB = Math.max(peak.maxRssMiB, now.maxRssMiB);
  };
  const started = performance.now();
  let stored = 0;
  let read = 0;
  let checksum = 0;
  let db;
  let archive;

  if (adapter === 'sqlite') {
    archive = new TokenArchive({ file: path.join(dbDir, 'tokens.sqlite'), maxTokens: count + 1000 });
    if (!archive.available) throw new Error('Production SQLite archive unavailable: ' + archive.lastError);
  } else if (adapter === 'lmdb') {
    const { open } = require('lmdb');
    db = open(path.join(dbDir, 'lmdb'), {
      compression: true,
      mapSize: 512 * 1024 * 1024,
      maxReaders: 32
    });
  } else {
    throw new Error('Unknown adapter: ' + adapter);
  }

  const writeStarted = performance.now();
  await readBatches(fixture, async batch => {
    if (adapter === 'sqlite') {
      stored += archive.putMany(batch);
    } else {
      const writes = batch.map(token => db.put(token.mint, compactToken(token)));
      await Promise.all(writes);
      stored += batch.length;
    }
    sample();
  });
  const writeMs = performance.now() - writeStarted;
  sample();

  const readStarted = performance.now();
  if (adapter === 'sqlite') {
    const statement = archive.db.prepare('SELECT payload FROM archived_tokens ORDER BY mint');
    for (const row of statement.iterate()) {
      const token = JSON.parse(row.payload);
      checksum += token.analysis.score;
      read++;
      if (read % 512 === 0) sample();
    }
  } else {
    for (const row of db.getRange({ start: 'bench_mint_', end: 'bench_mint_\uffff' })) {
      checksum += row.value.analysis.score;
      read++;
      if (read % 512 === 0) sample();
    }
  }
  const scanMs = performance.now() - readStarted;
  sample();

  const randomStarted = performance.now();
  const randomReads = Math.min(1000, count);
  for (let i = 0; i < randomReads; i++) {
    const index = (i * 7919) % count;
    const key = 'bench_mint_' + String(index).padStart(9, '0');
    const token = adapter === 'sqlite' ? archive.get(key) : db.get(key);
    if (token) checksum += token.analysis.score;
    if (i % 128 === 0) sample();
  }
  const randomReadMs = performance.now() - randomStarted;
  sample();

  if (archive) archive.close();
  if (db) await db.close();

  const result = {
    adapter,
    count,
    stored,
    scanned: read,
    randomReads,
    checksum,
    writeMs: Math.round(writeMs),
    scanMs: Math.round(scanMs),
    randomReadMs: Math.round(randomReadMs),
    totalMs: Math.round(performance.now() - started),
    baseline: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, Number(value.toFixed(1))])),
    peak: Object.fromEntries(Object.entries(peak).map(([key, value]) => [key, Number(value.toFixed(1))])),
    dbBytes: directoryBytes(dbDir)
  };
  process.stdout.write(JSON.stringify(result) + '\n');
}

function directoryBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directoryBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

function runParent() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-radar-archive-bench-'));
  const fixture = path.join(root, 'fixture.jsonl');
  const results = [];
  try {
    console.log('[archive-bench] generating ' + count.toLocaleString('en-US') + ' deterministic records');
    return generateFixture(fixture).then(() => {
      for (const adapter of ['sqlite', 'lmdb']) {
        const dbDir = path.join(root, adapter);
        fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
        console.log('[archive-bench] running ' + adapter);
        const child = spawnSync(process.execPath, [__filename, '--worker', adapter, fixture, dbDir], {
          encoding: 'utf8',
          env: process.env,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 10 * 60 * 1000
        });
        if (child.status !== 0) {
          throw new Error(adapter + ' benchmark failed: ' + (child.stderr || child.stdout || 'exit ' + child.status).slice(-4000));
        }
        const line = child.stdout.trim().split('\n').at(-1);
        const result = JSON.parse(line);
        if (result.stored !== count || result.scanned !== count || result.checksum <= 0) {
          throw new Error(adapter + ' benchmark produced incomplete data: ' + JSON.stringify(result));
        }
        results.push(result);
      }
      const sqlite = results.find(result => result.adapter === 'sqlite');
      const lmdb = results.find(result => result.adapter === 'lmdb');
      const report = {
        generatedAt: new Date().toISOString(),
        node: process.version,
        platform: process.platform + '/' + process.arch,
        count,
        batchSize,
        results,
        comparison: {
          lmdbVsSqlitePeakRssPercent: Number((((lmdb.peak.maxRssMiB / sqlite.peak.maxRssMiB) - 1) * 100).toFixed(1)),
          lmdbVsSqliteTotalTimePercent: Number((((lmdb.totalMs / sqlite.totalMs) - 1) * 100).toFixed(1)),
          lmdbVsSqliteDatabaseSizePercent: Number((((lmdb.dbBytes / sqlite.dbBytes) - 1) * 100).toFixed(1))
        },
        note: 'Isolated child processes, same deterministic JSONL fixture, same token compaction policy. Results are workload- and runner-specific, not a FadeHost guarantee.'
      };
      const outputDir = path.join(process.cwd(), 'artifacts');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'archive-backend-benchmark.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
      const markdown = [
        '# MEME RADAR archive backend benchmark',
        '',
        '- Generated: ' + report.generatedAt,
        '- Runtime: ' + report.node + ' (' + report.platform + ')',
        '- Records: ' + count.toLocaleString('en-US'),
        '',
        '| Backend | Peak RSS (MiB) | Peak heap (MiB) | Write (ms) | Full scan (ms) | Random reads (ms) | DB size (MiB) |',
        '|---|---:|---:|---:|---:|---:|---:|',
        ...results.map(result => '| ' + result.adapter + ' | ' + result.peak.maxRssMiB + ' | ' + result.peak.heapMiB + ' | ' + result.writeMs + ' | ' + result.scanMs + ' | ' + result.randomReadMs + ' | ' + (result.dbBytes / MiB).toFixed(2) + ' |'),
        '',
        'LMDB vs SQLite: peak RSS ' + report.comparison.lmdbVsSqlitePeakRssPercent + '%, total time ' + report.comparison.lmdbVsSqliteTotalTimePercent + '%, database size ' + report.comparison.lmdbVsSqliteDatabaseSizePercent + '%.',
        '',
        report.note
      ].join('\n');
      fs.writeFileSync(path.join(outputDir, 'archive-backend-benchmark.md'), markdown + '\n', { mode: 0o600 });
      console.log(markdown);
      console.log('[archive-bench] report saved to artifacts/archive-backend-benchmark.json');
    }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[2] === '--worker') {
  runWorker(process.argv[3], process.argv[4], process.argv[5]).catch(error => {
    console.error('[archive-bench] worker failed:', error.stack || error.message);
    process.exitCode = 1;
  });
} else {
  runParent().catch(error => {
    console.error('[archive-bench] failed:', error.stack || error.message);
    process.exitCode = 1;
  });
}
