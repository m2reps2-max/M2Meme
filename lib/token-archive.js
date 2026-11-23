'use strict';

const fs = require('node:fs');
const path = require('node:path');

function compactToken(token) {
  const value = { ...token };
  value.history = Array.isArray(token.history) ? token.history.slice(-5) : [];
  value.forecasts = Array.isArray(token.forecasts) ? token.forecasts.slice(-8) : [];
  if (value.smartMoney && Array.isArray(value.smartMoney.wallets)) value.smartMoney = { ...value.smartMoney, wallets: value.smartMoney.wallets.slice(-12) };
  for (const key of ['creatorOutflows', 'creatorSaleEvents', 'earlyWalletOutflows']) if (Array.isArray(value[key])) value[key] = value[key].slice(-8);
  if (Array.isArray(value.links)) value.links = value.links.slice(0, 12);
  if (Array.isArray(value.sources)) value.sources = value.sources.slice(0, 20);
  if (value.socialIntel && Array.isArray(value.socialIntel.posts)) value.socialIntel = { ...value.socialIntel, posts: value.socialIntel.posts.slice(-5) };
  return value;
}

class TokenArchive {
  constructor({ file, maxTokens = 50000 } = {}) {
    this.file = file || path.join(process.cwd(), 'data', 'tokens.archive.sqlite');
    this.maxTokens = Math.max(1000, Math.min(250000, Number(maxTokens) || 50000));
    this.db = null;
    this.available = false;
    this.lastError = null;
    try {
      const { DatabaseSync } = require('node:sqlite');
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(this.file);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=FILE; PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA busy_timeout=1500; PRAGMA wal_autocheckpoint=1000;');
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS archived_tokens (' +
        'mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, updated_at TEXT NOT NULL, first_seen_at TEXT, ' +
        'score REAL NOT NULL DEFAULT 0, liquidity REAL NOT NULL DEFAULT 0, last_scanned_at TEXT, payload TEXT NOT NULL);' +
        'CREATE INDEX IF NOT EXISTS idx_archived_score ON archived_tokens(score DESC, updated_at ASC);' +
        'CREATE INDEX IF NOT EXISTS idx_archived_updated ON archived_tokens(updated_at DESC);' +
        'CREATE INDEX IF NOT EXISTS idx_archived_name ON archived_tokens(name);' +
        'CREATE INDEX IF NOT EXISTS idx_archived_symbol ON archived_tokens(symbol);' +\n        'CREATE INDEX IF NOT EXISTS idx_archived_scan ON archived_tokens(score DESC, updated_at ASC, last_scanned_at);'
      );
      this.putStatement = this.db.prepare(
        'INSERT INTO archived_tokens(mint,name,symbol,updated_at,first_seen_at,score,liquidity,payload) VALUES(?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(mint) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,updated_at=excluded.updated_at,' +
        'first_seen_at=excluded.first_seen_at,score=excluded.score,liquidity=excluded.liquidity,payload=excluded.payload'
      );
      this.getStatement = this.db.prepare('SELECT payload FROM archived_tokens WHERE mint=?');
      this.deleteStatement = this.db.prepare('DELETE FROM archived_tokens WHERE mint=?');
      this.available = true;
    } catch (error) {
      this.lastError = String(error.message || error).slice(0, 180);
      if (this.db) { try { this.db.close(); } catch {} }
      this.db = null;
    }
  }

  putMany(tokens) {
    if (!this.available || !Array.isArray(tokens) || !tokens.length) return 0;
    let stored = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const token of tokens) {
        if (!token || typeof token.mint !== 'string' || !token.mint) continue;
        const compact = compactToken(token);
        this.putStatement.run(
          token.mint, String(token.name || '').slice(0, 120), String(token.symbol || '').slice(0, 40),
          String(token.updatedAt || new Date().toISOString()), String(token.firstSeenAt || ''),
          Number(token.analysis && token.analysis.score) || 0, Number(token.liquidityUsd) || 0, JSON.stringify(compact)
        );
        stored++;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.lastError = String(error.message || error).slice(0, 180);
      throw error;
    }
    this.prune();
    return stored;
  }

  get(mint) {
    if (!this.available || !mint) return null;
    try {
      const row = this.getStatement.get(String(mint));
      return row ? JSON.parse(row.payload) : null;
    } catch (error) {
      this.lastError = String(error.message || error).slice(0, 180);
      return null;
    }
  }

  takeForScan(limit = 20, cooldownMs = 900000) {
    if (!this.available) return [];
    const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const cutoff = new Date(Date.now() - Math.max(60000, Number(cooldownMs) || 900000)).toISOString();
    const now = new Date().toISOString();
    try {
      const rows = this.db.prepare(
        'SELECT mint,payload FROM archived_tokens WHERE last_scanned_at IS NULL OR last_scanned_at < ? ' +
        'ORDER BY score DESC, updated_at ASC LIMIT ?'
      ).all(cutoff, boundedLimit);
      if (!rows.length) return [];
      const update = this.db.prepare('UPDATE archived_tokens SET last_scanned_at=? WHERE mint=?');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of rows) update.run(now, row.mint);
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      const tokens = [];
      for (const row of rows) {
        try { const token = JSON.parse(row.payload); if (token && typeof token.mint === 'string') tokens.push(token); } catch {}
      }
      return tokens;
    } catch (error) {
      this.lastError = String(error.message || error).slice(0, 180);
      return [];
    }
  }

  removeMany(mints) {
    if (!this.available || !Array.isArray(mints) || !mints.length) return 0;
    this.db.exec('BEGIN IMMEDIATE');
    let removed = 0;
    try {
      for (const mint of mints) removed += Number(this.deleteStatement.run(String(mint)).changes) || 0;
      this.db.exec('COMMIT');
      return removed;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.lastError = String(error.message || error).slice(0, 180);
      throw error;
    }
  }

  prune() {
    if (!this.available) return;
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM archived_tokens').get().count) || 0;
    if (count <= this.maxTokens) return;
    this.db.prepare(
      'DELETE FROM archived_tokens WHERE mint IN (' +
      'SELECT mint FROM archived_tokens ORDER BY updated_at DESC LIMIT -1 OFFSET ?)'
    ).run(this.maxTokens);
  }

  summary() {
    if (!this.available) return { available: false, tokens: 0, maxTokens: this.maxTokens, error: this.lastError || 'SQLite indisponible' };
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS count, MIN(updated_at) AS oldest, MAX(updated_at) AS newest FROM archived_tokens').get();
      let fileBytes = 0;
      try { fileBytes = fs.statSync(this.file).size; } catch {}
      return { available: true, tokens: Number(row.count) || 0, maxTokens: this.maxTokens, oldestUpdatedAt: row.oldest || null, newestUpdatedAt: row.newest || null, fileBytes, error: this.lastError };
    } catch (error) {
      this.lastError = String(error.message || error).slice(0, 180);
      return { available: false, tokens: 0, maxTokens: this.maxTokens, error: this.lastError };
    }
  }

  close() {
    if (!this.db) return;
    try { this.db.close(); } catch {}
    this.db = null;
    this.available = false;
  }
}

module.exports = { TokenArchive, compactToken };
