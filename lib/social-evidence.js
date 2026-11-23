'use strict';

const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9$]+/g, ' ').trim();
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function classifyTokenMention(text, token) {
  const body = String(text || '');
  const mint = String(token?.mint || '');
  if (BASE58_MINT.test(mint) && body.includes(mint)) return 'mint';
  const symbol = String(token?.symbol || '').replace(/^\$/, '').trim();
  if (/^[a-z0-9]{3,15}$/i.test(symbol)) {
    const escaped = escapeRegExp(symbol);
    if (new RegExp('(^|[^a-z0-9])\\$' + escaped + '($|[^a-z0-9])', 'i').test(body)) return 'cashtag';
    if (new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])', 'i').test(body)) return 'ticker';
  }
  const name = String(token?.name || '').trim();
  if (name.length >= 6 && new RegExp('(^|[^a-z0-9])' + escapeRegExp(name).replace(/\\ /g, '\\s+') + '($|[^a-z0-9])', 'i').test(body)) return 'name';
  return 'none';
}

function sourceKey(post, fallback = '') {
  const value = String(post?.source || fallback || 'unknown').toLowerCase();
  if (value.includes('bluesky')) return 'bluesky';
  if (value.includes('nostr')) return 'nostr';
  if (value.includes('telegram')) return 'telegram';
  if (value.includes('reddit') || value.startsWith('r/')) return 'reddit';
  return value.replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'unknown';
}

function analyzeSocialEvidence(posts, token, now = Date.now()) {
  const unique = new Map();
  for (const post of Array.isArray(posts) ? posts : []) {
    const text = String(post?.text || post?.title || '').slice(0, 3000);
    const timestamp = Date.parse(post?.publishedAt || '');
    if (!text || !Number.isFinite(timestamp) || timestamp > now + 60000 || now - timestamp > 86400000) continue;
    const match = classifyTokenMention(text, token);
    if (match === 'none') continue;
    const network = sourceKey(post);
    const link = String(post?.link || post?.uri || '');
    const fingerprint = normalize(text);
    const key = link || network + ':' + String(post?.author || post?.channel || '') + ':' + fingerprint;
    if (unique.has(key)) continue;
    unique.set(key, { post, text, timestamp, network, match, fingerprint });
  }
  const rows = [...unique.values()];
  const authors = new Set();
  const channels = new Set();
  const networks = new Set();
  const fingerprints = new Set();
  let duplicates = 0, weakMatches = 0, mentions1h = 0;
  for (const row of rows) {
    networks.add(row.network);
    if (row.timestamp >= now - 3600000) mentions1h++;
    const author = String(row.post.author || '').trim().toLowerCase();
    const channel = String(row.post.channel || '').trim().toLowerCase();
    if (row.network === 'telegram') {
      if (channel) channels.add('telegram:' + channel);
    } else if (author) {
      authors.add(row.network + ':' + author);
    }
    if (row.match === 'ticker') weakMatches++;
    if (row.fingerprint) {
      if (fingerprints.has(row.fingerprint)) duplicates++;
      else fingerprints.add(row.fingerprint);
    }
  }
  const sample = rows.length;
  return {
    sampledPosts24h: sample,
    sampledMentions1h: mentions1h,
    uniqueAuthors24h: authors.size,
    uniqueChannels24h: channels.size,
    uniqueSources24h: networks.size,
    duplicateTexts: duplicates,
    duplicateSharePct: sample ? Number((duplicates / sample * 100).toFixed(1)) : 0,
    weakTickerMatches: weakMatches,
    weakMatchSharePct: sample ? Number((weakMatches / sample * 100).toFixed(1)) : 0,
    identityConfidence: sample ? (weakMatches / sample >= 0.5 ? 'low' : 'observed') : 'unavailable',
    limitations: 'Auteurs et canaux sont comptés uniquement dans les publications échantillonnées et séparément par réseau. Les tickers seuls restent ambigus.'
  };
}

module.exports = { classifyTokenMention, analyzeSocialEvidence };
