'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TokenArchive, compactToken } = require('../lib/token-archive');

let sqliteAvailable = true;
try { require('node:sqlite'); } catch { sqliteAvailable = false; }

test('compactToken bounds cold historical arrays without mutating the hot token', () => {
  const token = {
    mint: 'Mint111111111111111111111111111111111',
    history: Array.from({ length: 20 }, (_, i) => ({ at: i })),
    forecasts: Array.from({ length: 30 }, (_, i) => ({ at: i })),
    smartMoney: { wallets: Array.from({ length: 20 }, (_, i) => 'wallet-' + i) }
  };
  const compact = compactToken(token);
  assert.equal(compact.history.length, 5);
  assert.equal(compact.forecasts.length, 9);
  assert.equal(compact.forecasts[0].at, 0, 'the first observation remains available for unbiased first-detection analysis');
  assert.equal(compact.forecasts.at(-1).at, 29);
  assert.equal(compact.smartMoney.wallets.length, 12);
  assert.equal(token.history.length, 20);
  assert.equal(token.forecasts.length, 30);
});

test('SQLite archive stores cold tokens, restores them in bounded batches and reports counts', { skip: !sqliteAvailable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-radar-archive-'));
  const file = path.join(dir, 'tokens.sqlite');
  const archive = new TokenArchive({ file, maxTokens: 1000 });
  try {
    assert.equal(archive.available, true);
    const rows = Array.from({ length: 6 }, (_, i) => ({
      mint: 'Mint' + String(i).padStart(36, '1'),
      name: 'Token ' + i,
      symbol: 'T' + i,
      updatedAt: new Date(Date.now() - i * 1000).toISOString(),
      firstSeenAt: new Date(Date.now() - i * 1000).toISOString(),
      liquidityUsd: 1000 + i,
      analysis: { score: 90 - i },
      history: [{ at: i }]
    }));
    assert.equal(archive.putMany(rows), 6);
    assert.equal(archive.summary().tokens, 6);
    assert.equal(archive.get(rows[0].mint).name, 'Token 0');
    const batch = archive.takeForScan(2, 900000);
    assert.equal(batch.length, 2);
    assert.equal(batch[0].mint, rows[0].mint);
    const nextBatch = archive.takeForScan(2, 900000);
    assert.equal(nextBatch.length, 2);
    assert.equal(new Set([...batch, ...nextBatch].map(token => token.mint)).size, 4);
    assert.equal(archive.removeMany([rows[0].mint]), 1);
    assert.equal(archive.summary().tokens, 5);
  } finally {
    archive.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('archive scan candidates are not marked until the caller confirms the refresh', { skip: !sqliteAvailable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-radar-archive-lease-'));
  const archive = new TokenArchive({ file: path.join(dir, 'tokens.sqlite'), maxTokens: 1000 });
  try {
    const token = { mint: 'LeaseMint11111111111111111111111111111111', updatedAt: new Date().toISOString(), analysis: { score: 88 } };
    archive.putMany([token]);
    assert.equal(archive.selectForScan(5, 900000).length, 1);
    assert.equal(archive.selectForScan(5, 900000).length, 1, 'unconfirmed candidates remain retryable');
    assert.equal(archive.markScanned([token.mint]), 1);
    assert.equal(archive.selectForScan(5, 900000).length, 0, 'confirmed candidates respect the cooldown');
    assert.equal(archive.getMany([token.mint])[0].mint, token.mint);
  } finally {
    archive.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('stale archive scans rotate by oldest last scan before score priority', { skip: !sqliteAvailable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-radar-archive-fairness-'));
  const archive = new TokenArchive({ file: path.join(dir, 'tokens.sqlite'), maxTokens: 1000 });
  try {
    const now = Date.now();
    const tokens = [
      { mint: 'FairMintOld111111111111111111111111111111', updatedAt: new Date(now).toISOString(), analysis: { score: 20 } },
      { mint: 'FairMintRecent1111111111111111111111111111', updatedAt: new Date(now).toISOString(), analysis: { score: 99 } },
      { mint: 'FairMintMiddle111111111111111111111111111', updatedAt: new Date(now).toISOString(), analysis: { score: 80 } }
    ];
    archive.putMany(tokens);
    archive.markScanned([tokens[0].mint], new Date(now - 180000).toISOString());
    archive.markScanned([tokens[1].mint], new Date(now - 60000).toISOString());
    archive.markScanned([tokens[2].mint], new Date(now - 120000).toISOString());
    const selected = archive.selectForScan(1, 60000);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].mint, tokens[0].mint, 'the oldest scan is revisited first even when its score is lower');
  } finally {
    archive.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold archive forecast export uses bounded keyset pages and returns only compact forecasts', { skip: !sqliteAvailable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-radar-archive-export-'));
  const archive = new TokenArchive({ file: path.join(dir, 'tokens.sqlite'), maxTokens: 1000 });
  try {
    const rows = ['ExportMintA111111111111111111111111111111', 'ExportMintB111111111111111111111111111111', 'ExportMintC111111111111111111111111111111'].map((mint, index) => ({
      mint,
      updatedAt: new Date(Date.now() - index * 1000).toISOString(),
      forecasts: Array.from({ length: 12 }, (_, forecastIndex) => ({ at: forecastIndex, score: 70 + index, outcomes: { '1h': { returnPct: 20, label: 'win' } } }))
    }));
    archive.putMany(rows);
    const first = archive.forecastPage('', 2);
    assert.equal(first.scanned, 2);
    assert.equal(first.done, false);
    assert.equal(first.items.length, 2);
    assert.equal(first.items[0].forecasts.length, 9);
    assert.equal(first.items[0].forecasts[0].at, 0, 'archive export must retain the first forecast');
    assert.equal(first.items[0].forecasts.at(-1).at, 11, 'archive export must also retain the latest forecasts');
    const second = archive.forecastPage(first.nextCursor, 2);
    assert.equal(second.scanned, 1);
    assert.equal(second.done, true);
    assert.equal(second.items.length, 1);
  } finally {
    archive.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compact archive retains an immutable first forecast after the hot rolling window advances', () => {
  const firstForecast = { id: 'first', at: 1, outcomes: { '1h': { returnPct: 12 } } };
  const token = { mint: 'FirstForecastMint1111111111111111111111111', firstForecast, forecasts: Array.from({ length: 30 }, (_, i) => ({ id: 'f' + i, at: 100 + i })) };
  const compact = compactToken(token);
  assert.equal(compact.forecasts[0].id, 'first');
  assert.equal(compact.forecasts[0].outcomes['1h'].returnPct, 12);
  assert.equal(compact.forecasts.length, 9);
});


test('archive permanently switches to degraded mode after a SQLite write failure', { skip: !sqliteAvailable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-radar-archive-failure-'));
  const archive = new TokenArchive({ file: path.join(dir, 'tokens.sqlite'), maxTokens: 1000 });
  try {
    assert.equal(archive.available, true);
    archive.db.close();
    assert.throws(() => archive.putMany([{ mint: 'FailureMint111111111111111111111111111111', updatedAt: new Date().toISOString() }]));
    assert.equal(archive.available, false);
    assert.equal(archive.db, null);
    assert.match(archive.lastError, /database|closed|not open/i);
    assert.equal(archive.selectForScan(10).length, 0);
  } finally {
    archive.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
