'use strict';
const { readTextLimited } = require('./http-body');

const FEEDS = [
  'https://www.reddit.com/r/solana/new/.rss',
  'https://www.reddit.com/r/memecoins/new/.rss',
  'https://www.reddit.com/r/pumpfun/new/.rss'
];
const POSITIVE = new Set(['bullish','moon','mooning','pump','pumping','breakout','gem','gems','send','sending','strong','buy','bought','early','viral','爆','bull','growth','surge','surging','x10','100x']);
const NEGATIVE = new Set(['rug','rugpull','scam','scammer','dump','dumping','dead','sell','selling','exit','liquidity','drained','honeypot','fake','fraud','bearish','collapse','rekt','avoid']);
const decode = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
function tag(block, name) {
  const match = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return match ? decode(match[1]) : '';
}
function parseFeed(xml, source) {
  const items = [];
  for (const block of String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const title = tag(block, 'title');
    const rawLink = tag(block, 'link');
    let link = '';
    try { const parsed = new URL(rawLink); if (parsed.protocol === 'https:' && ['reddit.com','www.reddit.com','old.reddit.com'].includes(parsed.hostname)) link = parsed.toString(); } catch {}
    const author = tag(block, 'author') || tag(block, 'dc:creator');
    const published = tag(block, 'pubDate');
    const text = (title + ' ' + tag(block, 'description')).slice(0, 2500);
    if (!title) continue;
    items.push({ title, text, link, author, publishedAt: Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null, source });
  }
  return items;
}
function sentiment(text) {
  const words = String(text || '').toLowerCase().match(/[a-z0-9$]+/g) || [];
  let positive = 0, negative = 0;
  for (const word of words) { if (POSITIVE.has(word)) positive++; if (NEGATIVE.has(word)) negative++; }
  return { positive, negative, score: positive + negative ? Math.round(100 * positive / (positive + negative)) : null };
}
class RedditRadar {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.items = [];
    this.lastSuccessAt = null;
    this.lastError = null;
    this.lastAttemptAt = null;
    this.refreshing = false;
    this.failureCount = 0;
    this.nextRetryAt = 0;
  }
  async refresh() {
    if (this.refreshing) return { skipped: true, reason: 'already_refreshing' };
    if (Date.now() < this.nextRetryAt) return { skipped: true, reason: 'backoff', retryAt: new Date(this.nextRetryAt).toISOString() };
    this.refreshing = true;
    this.lastAttemptAt = new Date().toISOString();
    try {
      const settled = await Promise.allSettled(FEEDS.map(async url => {
        const response = await this.fetchImpl(url, { headers: { accept: 'application/atom+xml, application/rss+xml, application/xml', 'user-agent': 'MEME-RADAR/2.2 (free public RSS reader)' }, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Reddit RSS HTTP ' + response.status);
        return parseFeed(await readTextLimited(response, 512 * 1024), url.includes('/r/solana/') ? 'r/solana' : url.includes('/r/memecoins/') ? 'r/memecoins' : 'r/pumpfun');
      }));
      const successes = settled.filter(x => x.status === 'fulfilled');
      if (!successes.length) throw new Error(settled.map(x => x.reason?.message).filter(Boolean).join('; ').slice(0, 180) || 'Flux RSS indisponibles');
      const merged = successes.flatMap(x => x.value);
      const unique = new Map();
      for (const item of merged) unique.set(item.link || item.title, item);
      this.items = [...unique.values()].sort((a,b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)).slice(0, 500);
      this.lastSuccessAt = new Date().toISOString();
      this.failureCount = 0;
      this.nextRetryAt = Date.now() + (successes.length < FEEDS.length ? 15 * 60 * 1000 : 5 * 60 * 1000);
      this.lastError = successes.length < FEEDS.length ? 'Flux partiels : ' + (FEEDS.length - successes.length) + ' source(s) indisponible(s)' : null;
      return { fetched: merged.length, retained: this.items.length, sourcesOk: successes.length, sourcesTotal: FEEDS.length };
    } catch (error) {
      this.lastError = String(error.message || error).slice(0, 180);
      this.failureCount++;
      const delay = Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * (2 ** Math.min(this.failureCount - 1, 5)));
      this.nextRetryAt = Date.now() + delay;
      throw error;
    } finally { this.refreshing = false; }
  }
  match(token) {
    const fresh = Boolean(this.lastSuccessAt && Date.now() - Date.parse(this.lastSuccessAt) < 60 * 60 * 1000);
    if (!fresh) return { available: false, mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0, sentimentScore: null, posts: [], error: this.lastError || 'Aucune collecte Reddit récente.' };
    const name = String(token.name || '').trim().toLowerCase();
    const symbol = String(token.symbol || '').trim().replace(/^\$/, '').toLowerCase();
    const terms = [name.length >= 4 ? name : '', symbol.length >= 3 ? symbol : ''].filter(Boolean);
    if (!terms.length) return { available: this.items.length > 0, mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0, sentimentScore: null, posts: [] };
    const now = Date.now(), matches = this.items.filter(item => {
      const haystack = (' ' + (item.title + ' ' + item.text).toLowerCase() + ' ');
      return terms.some(term => haystack.includes(term.includes(' ') ? term : ' ' + term + ' ') || haystack.includes('$' + term));
    });
    const recent1h = matches.filter(x => x.publishedAt && now - Date.parse(x.publishedAt) <= 3600000);
    const recent24h = matches.filter(x => x.publishedAt && now - Date.parse(x.publishedAt) <= 86400000);
    const authors = new Set(recent24h.map(x => x.author).filter(Boolean));
    const scores = recent24h.map(x => sentiment(x.text)).filter(x => x.score !== null);
    const sentimentScore = scores.length ? Math.round(scores.reduce((sum,x) => sum + x.score, 0) / scores.length) : null;
    return { available: true, mentions1h: recent1h.length, mentions24h: recent24h.length, uniqueAuthors24h: authors.size, sentimentScore, posts: recent24h.slice(0, 5).map(({title,link,publishedAt,source}) => ({title,link,publishedAt,source})) };
  }
  status() {
    const age = this.lastSuccessAt ? Date.now() - Date.parse(this.lastSuccessAt) : null;
    return { configured: true, connected: age !== null && age < 60 * 60 * 1000, mode: 'Reddit RSS historique · prise en charge annoncée arrêtée le 13 novembre 2026 · essais espacés sans clé', lastAttempt: this.lastAttemptAt, lastSuccess: this.lastSuccessAt, lastSuccessAgeMs: age, error: this.lastError, postsRetained: this.items.length, feeds: FEEDS.length, failureCount: this.failureCount, nextRetryAt: this.nextRetryAt ? new Date(this.nextRetryAt).toISOString() : null, retryBackoff: true };
  }
}
module.exports = { RedditRadar, parseFeed, sentiment };
