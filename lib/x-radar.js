'use strict';

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
    const published = Date.parse(row?.created_at || row?.publishedAt || '');
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
      reposts: Math.max(0, Number(row?.retweets ?? row?.reposts) || 0),
      replies: Math.max(0, Number(row?.replies) || 0),
      views: Math.max(0, Number(row?.views) || 0)
    });
  }
  return posts.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 60);
}

class XSocialRadar {
  constructor({ env = process.env, clientFactory = null } = {}) {
    this.env = env;
    this.clientFactory = clientFactory;
    this.client = null;
    this.clientPromise = null;
    this.lastSuccessAt = null;
    this.lastAttemptAt = null;
    this.lastError = null;
    this.lastResult = null;
    this.inFlight = null;
    this.queryCursor = 0;
    this.rateLimit = null;
  }

  queries() {
    const configured = String(this.env.X_SEARCH_QUERIES || '').split(/[;\n]/)
      .map(value => value.trim()).filter(Boolean).slice(0, 3).map(value => value.slice(0, 160));
    return configured.length ? configured : DEFAULT_QUERIES;
  }

  async getClient() {
    if (this.client) return this.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const authToken = String(this.env.X_AUTH_TOKEN || '').trim();
        const ct0 = String(this.env.X_CT0 || '').trim();
        if (!authToken || !ct0) throw new Error('X credentials missing');
        const factory = this.clientFactory || (async options => {
          const { XClient } = await import('x-agent-sdk');
          return new XClient(options);
        });
        this.client = await factory({
          authToken, ct0, retries: 1,
          sleep: async () => {},
          fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
          onRateLimit: info => { this.rateLimit = info; }
        });
        return this.client;
      })().catch(error => {
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }

  async search() {
    const authToken = String(this.env.X_AUTH_TOKEN || '').trim();
    const ct0 = String(this.env.X_CT0 || '').trim();
    if (!authToken || !ct0) return {
      available: false, configured: false, provider: 'X search · x-agent-sdk',
      checkedAt: new Date().toISOString(), error: 'X_AUTH_TOKEN et X_CT0 non configurés.',
      posts: [], mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0
    };
    if (this.lastResult && Date.now() - Date.parse(this.lastResult.checkedAt) < 600000) return this.lastResult;
    if (this.inFlight) return this.inFlight;
    this.lastAttemptAt = new Date().toISOString();
    this.inFlight = this.runSearch().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async runSearch() {
    try {
      const client = await this.getClient();
      const queries = this.queries();
      const query = queries[this.queryCursor % queries.length];
      this.queryCursor = (this.queryCursor + 1) % queries.length;
      const rows = await client.search(query, 20, 'Latest');
      const posts = normalizeXPosts(rows);
      const now = Date.now();
      const recent1h = posts.filter(post => now - Date.parse(post.publishedAt) <= 3600000);
      const authors = new Set(posts.map(post => post.author).filter(Boolean));
      const result = {
        available: true, configured: true, provider: 'X search · x-agent-sdk · session unique',
        checkedAt: new Date().toISOString(), query, queriesPerCycle: 1,
        posts, mentions1h: recent1h.length, mentions24h: posts.length,
        uniqueAuthors24h: authors.size,
        engagement24h: posts.reduce((sum, post) => sum + post.likes + post.reposts + post.replies, 0),
        sentimentScore: null, error: null, rateLimit: this.rateLimit
      };
      this.lastSuccessAt = result.checkedAt;
      this.lastError = null;
      this.lastResult = result;
      return result;
    } catch (error) {
      const code = Number(error?.code);
      return this.failure(code ? 'X search refusée ou limitée (code ' + code + ').' : 'X search indisponible (' + String(error?.name || 'erreur') + ').');
    }
  }

  failure(message) {
    this.lastError = String(message || 'Erreur X').slice(0, 160);
    return {
      available: false, configured: true, provider: 'X search · x-agent-sdk · session unique',
      checkedAt: new Date().toISOString(), error: this.lastError, posts: [],
      mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0, rateLimit: this.rateLimit
    };
  }

  status() {
    const configured = Boolean(String(this.env.X_AUTH_TOKEN || '').trim() && String(this.env.X_CT0 || '').trim());
    return {
      configured, connected: Boolean(this.lastSuccessAt && Date.now() - Date.parse(this.lastSuccessAt) < 3600000),
      mode: 'X search · x-agent-sdk · une session personnelle · 1 recherche par cycle social · rotation des 3 requêtes',
      lastAttempt: this.lastAttemptAt, lastSuccess: this.lastSuccessAt,
      lastError: this.lastError, cachedPosts: this.lastResult?.posts?.length || 0,
      cacheMinutes: 10, queriesPerCycle: 1, rateLimit: this.rateLimit
    };
  }
}

module.exports = { XSocialRadar, extractSolanaMints, normalizeXPosts, DEFAULT_QUERIES };
