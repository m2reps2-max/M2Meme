'use strict';

const fs = require('node:fs');
const path = require('node:path');

function compactToken(token) {
  const value = { ...token };
  value.history = Array.isArray(token.history) ? token.history.slice(-5) : [];
  const forecasts = Array.isArray(token.forecasts) ? token.forecasts : [];
  const storedFirst = token.firstForecast || null;
  const firstForecast = forecasts.find(row => storedFirst && ((row?.id && row.id === storedFirst.id) || row?.at === storedFirst.at)) || storedFirst || forecasts[0] || null;
  const recentForecasts = forecasts.slice(-8);
  value.firstForecast = firstForecast;
  value.forecasts = firstForecast
    ? [firstForecast, ...recentForecasts.filter(row => row !== firstForecast && !(firstForecast.id && row?.id === firstForecast.id) && !(firstForecast.at !== undefined && row?.at === firstForecast.at))].slice(0, 9)
    : recentForecasts;
  if (value.smartMoney && Array.isArray(value.smartMoney.wallets)) value.smartMoney = { ...value.smartMoney, wallets: value.smartMoney.wallets.slice(-12) };
  for (const key of ['creatorOutflows', 'creatorSaleEvents', 'earlyWalletOutflows']) if (Array.isArray(value[key])) value[key] = value[key].slice(-8);
  if (Array.isArray(value.links)) value.links = value.links.slice(0, 12);
  if (Array.isArray(value.sources)) value.sources = value.sources.slice(0, 20);
  if (value.socialIntel && Array.isArray(value.socialIntel.posts)) value.socialIntel = { ...value.socialIntel, posts: value.socialIntel.posts.slice(-5) };
  return value;
}

class TokenArchive {
  constructor({ file, maxTokens = 100000 } = {}) {
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
        'CREATE INDEX IF NOT EXISTS idx_archived_symbol ON archived_tokens(symbol);' +
        'CREATE INDEX IF NOT EXISTS idx_archived_scan ON archived_tokens(last_scanned_at, score DESC, updated_at ASC);'
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

  disable(error) {
    this.lastError = String(error?.message || error || 'SQLite indisponible').slice(0, 180);
    this.available = false;
    const db = this.db;
    this.db = null;
    if (db) { try { db.close(); } catch {} }
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
      this.disable(error);
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
      this.disable(error);
      return null;
    }
  }

  getMany(mints) {
    if (!this.available || !Array.isArray(mints) || !mints.length) return [];
    const tokens = [];
    try {
      for (const mint of mints.slice(0, 50)) {
        const row = this.getStatement.get(String(mint));
        if (!row) continue;
        try {
          const token = JSON.parse(row.payload);
          if (token && token.mint === String(mint)) tokens.push(token);
        } catch {}
      }
      return tokens;
    } catch (error) {
      this.disable(error);
      return tokens;
    }
  }

  selectForScan(limit = 20, cooldownMs = 900000) {
    if (!this.available) return [];
    const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const cutoff = new Date(Date.now() - Math.max(60000, Number(cooldownMs) || 900000)).toISOString();
    try {
      const unscanned = this.db.prepare(
        'SELECT mint FROM archived_tokens WHERE last_scanned_at IS NULL ORDER BY score DESC, updated_at ASC LIMIT ?'
      ).all(boundedLimit).map(row => row.mint);
      const stale = unscanned.length < boundedLimit
        ? this.db.prepare(
          'SELECT mint FROM archived_tokens WHERE last_scanned_at < ? ORDER BY last_scanned_at ASC, score DESC, updated_at ASC LIMIT ?'
        ).all(cutoff, boundedLimit - unscanned.length).map(row => row.mint)
        : [];
      return this.getMany([...unscanned, ...stale]);
    } catch (error) {
      this.disable(error);
      return [];
    }
  }

  markScanned(mints, at = new Date().toISOString()) {
    if (!this.available || !Array.isArray(mints) || !mints.length) return 0;
    const update = this.db.prepare('UPDATE archived_tokens SET last_scanned_at=? WHERE mint=?');
    this.db.exec('BEGIN IMMEDIATE');
    let marked = 0;
    try {
      for (const mint of mints.slice(0, 50)) marked += Number(update.run(String(at), String(mint)).changes) || 0;
      this.db.exec('COMMIT');
      return marked;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.disable(error);
      throw error;
    }
  }

  takeForScan(limit = 20, cooldownMs = 900000) {
    const tokens = this.selectForScan(limit, cooldownMs);
    if (tokens.length) this.markScanned(tokens.map(token => token.mint));
    return tokens;
  }

  forecastPage(afterMint = '', limit = 200) {
    if (!this.available) return { items: [], nextCursor: null, scanned: 0, done: true, error: this.lastError || 'SQLite indisponible' };
    const cursor = String(afterMint || '').slice(0, 64);
    const boundedLimit = Math.max(1, Math.min(250, Number(limit) || 200));
    try {
      let rows;
      let jsonExtract = true;
      try {
        rows = this.db.prepare(
          "SELECT mint,json_extract(payload,'$.forecasts') AS forecasts FROM archived_tokens WHERE mint > ? ORDER BY mint ASC LIMIT ?"
        ).all(cursor, boundedLimit);
      } catch {
        jsonExtract = false;
        rows = this.db.prepare(
          'SELECT mint,payload FROM archived_tokens WHERE mint > ? ORDER BY mint ASC LIMIT ?'
        ).all(cursor, boundedLimit);
      }
      const items = [];
      for (const row of rows) {
        try {
          let forecasts = jsonExtract ? row.forecasts : JSON.parse(row.payload).forecasts;
          if (typeof forecasts === 'string') forecasts = JSON.parse(forecasts);
          if (Array.isArray(forecasts) && forecasts.length) {
            items.push({ mint: row.mint, forecasts: forecasts.slice(0, 9) });
          }
        } catch {}
      }
      return {
        items,
        nextCursor: rows.length ? rows[rows.length - 1].mint : null,
        scanned: rows.length,
        done: rows.length < boundedLimit
      };
    } catch (error) {
      this.disable(error);
      return { items: [], nextCursor: null, scanned: 0, done: true, error: this.lastError };
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
      this.disable(error);
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
