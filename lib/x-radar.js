'use strict';

const { spawn } = require('node:child_process');

const BASE58_MINT = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
const DEFAULT_QUERIES = [
  '"pump.fun" OR pumpfun -filter:retweets',
  '"Solana memecoin" OR "Solana meme coin" -filter:retweets',
  '"CA:" Solana -filter:retweets'
];

function extractSolanaMints(text) {
  const found = new Set();
  for (const match of String(text || '').matchAll(BASE58_MINT)) found.add(match[0]);
  return [...found];
}

function normalizeXPosts(rows, now = Date.now()) {
  const seen = new Set();
  const posts = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = String(row?.text || '').trim().slice(0, 3000);
    const published = Date.parse(row?.publishedAt || '');
    const id = String(row?.id || row?.url || '');
    if (!text || !Number.isFinite(published) || published > now + 60000 || now - published > 86400000) continue;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    posts.push({
      id: id.slice(0, 80),
      text,
      title: text.slice(0, 240),
      link: /^https:\/\/x\.com\//.test(String(row?.url || '')) ? String(row.url).slice(0, 500) : null,
      publishedAt: new Date(published).toISOString(),
      source: 'X',
      author: String(row?.author || '').replace(/^@/, '').slice(0, 64),
      followers: Math.max(0, Number(row?.followers) || 0),
      likes: Math.max(0, Number(row?.likes) || 0),
      reposts: Math.max(0, Number(row?.reposts) || 0),
      replies: Math.max(0, Number(row?.replies) || 0),
      views: Math.max(0, Number(row?.views) || 0)
    });
  }
  return posts.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 60);
}

class XSocialRadar {
  constructor({ env = process.env, spawnImpl = spawn, timeoutMs = 45000 } = {}) {
    this.env = env;
    this.spawnImpl = spawnImpl;
    this.timeoutMs = timeoutMs;
    this.lastSuccessAt = null;
    this.lastAttemptAt = null;
    this.lastError = null;
    this.lastResult = null;
    this.inFlight = null;
  }

  queries() {
    const configured = String(this.env.X_SEARCH_QUERIES || '').split(/[;\n]/)
      .map(value => value.trim()).filter(Boolean).slice(0, 3).map(value => value.slice(0, 160));
    return configured.length ? configured : DEFAULT_QUERIES;
  }

  async search() {
    const cookies = String(this.env.X_COOKIES || '').trim();
    if (!cookies) return {
      available: false, configured: false, provider: 'X session personnelle via twscrape',
      checkedAt: new Date().toISOString(), error: 'X_COOKIES non configuré.', posts: [],
      mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0
    };
    if (!/(?:^|;\s*)auth_token=/.test(cookies) || !/(?:^|;\s*)ct0=/.test(cookies)) {
      return {
        available: false, configured: true, provider: 'X session personnelle via twscrape',
        checkedAt: new Date().toISOString(), error: 'Session X incomplète : auth_token et ct0 sont requis.',
        posts: [], mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0
      };
    }
    if (this.lastResult && Date.now() - Date.parse(this.lastResult.checkedAt) < 600000) return this.lastResult;
    if (this.inFlight) return this.inFlight;
    this.lastAttemptAt = new Date().toISOString();
    this.inFlight = this.runWorker(cookies).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  runWorker(cookies) {
    return new Promise(resolve => {
      const python = String(this.env.PYTHON_BIN || 'python3').trim() || 'python3';
      let child;
      try {
        const childEnv = {
          PATH: this.env.PATH || process.env.PATH || '',
          HOME: this.env.HOME || process.env.HOME || '',
          PYTHONPATH: this.env.PYTHONPATH || process.env.PYTHONPATH || '',
          VIRTUAL_ENV: this.env.VIRTUAL_ENV || process.env.VIRTUAL_ENV || '',
          PYTHONUNBUFFERED: '1'
        };
        child = this.spawnImpl(python, ['scripts/x_social_worker.py'], {
          cwd: process.cwd(), env: childEnv,
          stdio: ['pipe', 'pipe', 'ignore']
        });
      } catch (error) {
        return resolve(this.failure('Impossible de démarrer Python : ' + String(error.code || error.name || 'erreur').slice(0, 60)));
      }
      let stdout = '', settled = false, overflow = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(this.failure('Délai maximal de collecte X dépassé.'));
      }, this.timeoutMs);
      if (timer.unref) timer.unref();
      child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8');
        if (stdout.length > 512 * 1024) {
          overflow = true;
          child.kill('SIGKILL');
          finish(this.failure('Réponse X trop volumineuse, collecte interrompue.'));
        }
      });
      child.on('error', error => finish(this.failure(
        error.code === 'ENOENT' ? 'Python introuvable. Installe Python 3 et requirements-social.txt.' : 'Échec de démarrage du collecteur X.'
      )));
      child.on('close', code => {
        if (settled) return;
        if (overflow) return finish(this.failure('Réponse X trop volumineuse.'));
        let payload;
        try { payload = JSON.parse(stdout); }
        catch { return finish(this.failure(code === 127 ? 'Python ou twscrape indisponible.' : 'Réponse invalide du collecteur X.')); }
        if (code !== 0 || payload?.ok !== true) {
          const reason = String(payload?.error || 'Collecte X indisponible').slice(0, 140);
          return finish(this.failure(reason));
        }
        const posts = normalizeXPosts(payload.posts);
        const now = Date.now();
        const recent1h = posts.filter(post => now - Date.parse(post.publishedAt) <= 3600000);
        const authors = new Set(posts.map(post => post.author).filter(Boolean));
        const result = {
          available: true, configured: true, provider: 'X search · twscrape · session unique',
          checkedAt: new Date().toISOString(), queriesRun: Number(payload.queriesRun) || 0,
          posts, mentions1h: recent1h.length, mentions24h: posts.length,
          uniqueAuthors24h: authors.size,
          engagement24h: posts.reduce((sum, post) => sum + post.likes + post.reposts + post.replies, 0),
          sentimentScore: null, error: null
        };
        this.lastSuccessAt = result.checkedAt;
        this.lastError = null;
        this.lastResult = result;
        finish(result);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ cookies, queries: this.queries(), limitPerQuery: 15 }));
    });
  }

  failure(message) {
    this.lastError = String(message || 'Erreur X').slice(0, 160);
    return {
      available: false, configured: true, provider: 'X search · twscrape · session unique',
      checkedAt: new Date().toISOString(), error: this.lastError, posts: [],
      mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0
    };
  }

  status() {
    const configured = Boolean(String(this.env.X_COOKIES || '').trim());
    return {
      configured, connected: Boolean(this.lastSuccessAt && Date.now() - Date.parse(this.lastSuccessAt) < 3600000),
      mode: 'X search · twscrape · une session personnelle · 3 recherches maximum par cycle · sans rotation de comptes',
      lastAttempt: this.lastAttemptAt, lastSuccess: this.lastSuccessAt,
      lastError: this.lastError, cachedPosts: this.lastResult?.posts?.length || 0,
      cacheMinutes: 10, queriesPerCycle: this.queries().length
    };
  }
}

module.exports = { XSocialRadar, extractSolanaMints, normalizeXPosts, DEFAULT_QUERIES };
