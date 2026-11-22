'use strict';

const WebSocket = require('ws');
const POSITIVE = new Set(['bullish','moon','mooning','pump','pumping','breakout','gem','send','sending','strong','buy','bought','early','viral','growth','surge','surging','100x']);
const NEGATIVE = new Set(['rug','rugpull','scam','dump','dumping','dead','sell','selling','exit','drained','honeypot','fake','fraud','bearish','collapse','rekt','avoid']);
const escape = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchesToken(content, token) {
  const text = String(content || '').toLowerCase();
  const symbol = String(token?.symbol || '').replace(/^\$/, '').trim().toLowerCase();
  const name = String(token?.name || '').trim().toLowerCase();
  const symbolMatch = symbol.length >= 3 && new RegExp('(?:^|[^a-z0-9])\\$?' + escape(symbol) + '(?:$|[^a-z0-9])', 'i').test(text);
  const nameMatch = name.length >= 5 && text.includes(name);
  return symbolMatch || nameMatch;
}

function sentiment(content) {
  const words = String(content || '').toLowerCase().match(/[a-z0-9$]+/g) || [];
  let positive = 0, negative = 0;
  for (const word of words) { if (POSITIVE.has(word)) positive++; if (NEGATIVE.has(word)) negative++; }
  return positive + negative ? Math.round(50 + (positive - negative) / (positive + negative) * 50) : null;
}

function summarizeEvents(events, token, now = Date.now()) {
  const unique = new Map();
  for (const event of events || []) {
    if (!event || event.kind !== 1 || !event.pubkey || !Number.isFinite(Number(event.created_at))) continue;
    const createdAt = Number(event.created_at) * 1000;
    if (createdAt > now + 60000 || now - createdAt > 86400000 || !matchesToken(event.content, token)) continue;
    unique.set(event.id || event.pubkey + ':' + event.created_at + ':' + event.content, {
      text: String(event.content || '').slice(0, 240),
      author: String(event.pubkey),
      createdAt: new Date(createdAt).toISOString(),
      source: 'Nostr',
      link: event.id ? 'https://njump.me/' + encodeURIComponent(event.id) : null
    });
  }
  const posts = [...unique.values()].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const recent1h = posts.filter(x => now - Date.parse(x.createdAt) <= 3600000);
  const authors = new Set(posts.map(x => x.author));
  const scores = posts.map(x => sentiment(x.text)).filter(x => x !== null);
  return {
    available: true,
    provider: 'Nostr public relay (NIP-50 search)',
    checkedAt: new Date(now).toISOString(),
    mentions1h: recent1h.length,
    mentions24h: posts.length,
    uniqueAuthors24h: authors.size,
    sentimentScore: scores.length ? Math.round(scores.reduce((sum,x) => sum + x, 0) / scores.length) : null,
    posts: posts.slice(0, 8)
  };
}

class NostrRadar {
  constructor({ WebSocketImpl = WebSocket, relay = 'wss://relay.nostr.band', timeoutMs = 7000 } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.relay = relay;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
    this.lastSuccessAt = null;
    this.lastError = null;
    this.lastAttemptAt = null;
  }

  async searchToken(token) {
    const mint = String(token?.mint || '');
    if (!mint) return { available: false, error: 'Mint absent', mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0, sentimentScore: null, posts: [] };
    const cached = this.cache.get(mint);
    if (cached && Date.now() - Date.parse(cached.checkedAt || 0) < 1800000) return cached;
    const symbol = String(token.symbol || '').replace(/^\$/, '').trim();
    const name = String(token.name || '').trim();
    const query = symbol.length >= 3 ? '$' + symbol : name;
    if (!query || query.length < 3) return { available: false, provider: 'Nostr', error: 'Symbole ou nom trop court pour une recherche fiable', checkedAt: new Date().toISOString(), mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0, sentimentScore: null, posts: [] };
    this.lastAttemptAt = new Date().toISOString();
    const subId = 'meme-radar-' + mint.slice(0, 12) + '-' + Date.now().toString(36);
    try {
      const events = await new Promise((resolve, reject) => {
        const socket = new this.WebSocketImpl(this.relay);
        const found = [];
        let settled = false;
        const finish = (error = null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { if (socket.readyState === 1) socket.send(JSON.stringify(['CLOSE', subId])); } catch {}
          try { socket.close(); } catch {}
          error ? reject(error) : resolve(found);
        };
        const timer = setTimeout(() => finish(found.length ? null : new Error('Délai dépassé sur le relais Nostr')), this.timeoutMs);
        socket.on('open', () => {
          const since = Math.floor((Date.now() - 86400000) / 1000);
          socket.send(JSON.stringify(['REQ', subId, { search: query, kinds: [1], since, limit: 50 }]));
        });
        socket.on('message', raw => {
          let message;
          try { message = JSON.parse(String(raw)); } catch { return; }
          if (!Array.isArray(message) || message[1] !== subId) return;
          if (message[0] === 'EVENT' && message[2] && found.length < 50) found.push(message[2]);
          if (message[0] === 'EOSE') finish();
          if (message[0] === 'CLOSED') finish(new Error(String(message[2] || 'Recherche Nostr refusée')));
        });
        socket.on('error', error => finish(error));
        socket.on('close', () => { if (!settled) finish(found.length ? null : new Error('Connexion au relais Nostr interrompue')); });
      });
      const result = summarizeEvents(events, token);
      this.cache.set(mint, result);
      this.lastSuccessAt = result.checkedAt;
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = String(error.message || error).slice(0, 180);
      return { available: false, provider: 'Nostr public relay', error: this.lastError, checkedAt: new Date().toISOString(), mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0, sentimentScore: null, posts: [] };
    }
  }

  status() {
    return { configured: true, connected: Boolean(this.lastSuccessAt && Date.now() - Date.parse(this.lastSuccessAt) < 1800000), mode: 'Nostr public relay · NIP-50 search · sans clé', relay: this.relay, lastAttempt: this.lastAttemptAt, lastSuccess: this.lastSuccessAt, lastError: this.lastError, cachedTokens: this.cache.size, cacheMinutes: 30 };
  }
}

module.exports = { NostrRadar, matchesToken, sentiment, summarizeEvents };
