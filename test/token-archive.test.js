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
  assert.equal(compact.forecasts.length, 8);
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
    assert.equal(archive.takeForScan(2, 900000).length, 0);
    assert.equal(archive.removeMany([rows[0].mint]), 1);
    assert.equal(archive.summary().tokens, 5);
  } finally {
    archive.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
