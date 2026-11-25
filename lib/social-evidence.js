'use strict';

const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9$]+/g, ' ').trim();
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));

function classifyTokenMention(text, token) {
  const body = String(text || '');
  const mint = String(token?.mint || '');
  if (BASE58_MINT.test(mint) && body.includes(mint)) return 'mint';
  const symbol = String(token?.symbol || '').replace(/^\$/, '').trim();
  const validSymbol = /^[a-z0-9]{3,15}$/i.test(symbol);
  if (validSymbol) {
    const escaped = escapeRegExp(symbol);
    if (new RegExp('(^|[^a-z0-9])\\$' + escaped + '($|[^a-z0-9])', 'i').test(body)) return 'cashtag';
  }
  const name = String(token?.name || '').trim();
  if (name.length >= 6 && new RegExp('(^|[^a-z0-9])' + escapeRegExp(name).replace(/ /g, '\\s+') + '($|[^a-z0-9])', 'i').test(body)) return 'name';
  if (validSymbol && new RegExp('(^|[^a-z0-9])' + escapeRegExp(symbol) + '($|[^a-z0-9])', 'i').test(body)) return 'ticker';
  return 'none';
}

function isPromotionalPost(post, network) {
  if (network !== 'telegram') return false;
  if (post?.channelType === 'promotional') return true;
  return /(?:calls?|gems?|moonshots?|pumps?|signals?|trending|100x)/i.test(String(post?.channel || ''));
}

function sourceKey(post, fallback = '') {
  const value = String(post?.source || fallback || 'unknown').toLowerCase();
  if (value.includes('bluesky')) return 'bluesky';
  if (value.includes('nostr')) return 'nostr';
  if (value.includes('telegram')) return 'telegram';
  if (value.includes('reddit') || value.startsWith('r/')) return 'reddit';
  if (value === 'x' || value.includes('twitter')) return 'x';
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
    unique.set(key, {
      post, text, timestamp, network, match, fingerprint,
      promotional: isPromotionalPost(post, network)
    });
  }

  const rows = [...unique.values()];
  const authors = new Set(), authors1h = new Set(), authors6h = new Set();
  const channels = new Set(), channels1h = new Set(), sources = new Set();
  const fingerprints = new Set();
  let duplicates = 0, weakMatches = 0, exactMatches = 0;
  let mentions15m = 0, mentions1h = 0, mentionsPrevious1h = 0, mentions6h = 0;
  let nonPromotionalMentions1h = 0, nonPromotionalMentions24h = 0;
  let promotionalPosts = 0, engagement = 0;
  const authorCounts = new Map(), channelCounts = new Map();

  for (const row of rows) {
    const age = now - row.timestamp;
    if (age <= 15 * 60000) mentions15m++;
    if (age <= 3600000) mentions1h++;
    else if (age <= 2 * 3600000) mentionsPrevious1h++;
    if (age <= 6 * 3600000) mentions6h++;
    if (row.match === 'ticker') weakMatches++;
    else exactMatches++;
    if (row.fingerprint) {
      if (fingerprints.has(row.fingerprint)) duplicates++;
      else fingerprints.add(row.fingerprint);
    }
    if (row.promotional) {
      promotionalPosts++;
      continue;
    }

    sources.add(row.network);
    nonPromotionalMentions24h++;
    if (age <= 3600000) nonPromotionalMentions1h++;
    const author = String(row.post.author || '').trim().toLowerCase();
    const channel = String(row.post.channel || '').trim().toLowerCase();
    if (row.network === 'telegram') {
      if (channel) {
        const key = 'telegram:' + channel;
        channels.add(key);
        channelCounts.set(key, (channelCounts.get(key) || 0) + 1);
        if (age <= 3600000) channels1h.add(key);
      }
    } else if (author) {
      const key = row.network + ':' + author;
      authors.add(key);
      authorCounts.set(key, (authorCounts.get(key) || 0) + 1);
      if (age <= 6 * 3600000) authors6h.add(key);
      if (age <= 3600000) authors1h.add(key);
    }
    engagement += Math.min(1000000, Math.max(0, Number(row.post.likes) || 0))
      + Math.min(1000000, Math.max(0, Number(row.post.reposts ?? row.post.retweets) || 0))
      + Math.min(1000000, Math.max(0, Number(row.post.replies) || 0));
  }

  const sample = rows.length;
  const nonPromotional = sample - promotionalPosts;
  const independentEntities24h = authors.size + channels.size;
  const duplicateSharePct = sample ? Number((duplicates / sample * 100).toFixed(1)) : 0;
  const weakMatchSharePct = sample ? Number((weakMatches / sample * 100).toFixed(1)) : 0;
  const exactMatchSharePct = sample ? Number((exactMatches / sample * 100).toFixed(1)) : 0;
  const accelerationRatio = Number((mentions1h / Math.max(1, mentionsPrevious1h)).toFixed(2));
  const hourlyBaseline = mentions6h / 6;
  const accelerating = mentions1h >= 2 && mentions1h > hourlyBaseline * 1.5
    && (mentionsPrevious1h === 0 || accelerationRatio >= 1.25);
  const engagementScore = Math.min(100, Math.log10(engagement + 1) * 20);
  const socialMomentumScore = Math.round(clamp(
    24 + Math.min(mentions1h, 8) * 4.5
    + Math.min(independentEntities24h, 8) * 3.5
    + Math.min(sources.size, 4) * 4
    + (accelerating ? 12 : 0)
    + engagementScore * 0.08
    - Math.min(18, duplicateSharePct * 0.24)
    - Math.min(16, weakMatchSharePct * 0.16)
    - (nonPromotional < 2 ? 12 : 0)
  ));
  const authorConcentrationPct = authorCounts.size
    ? Number((Math.max(...authorCounts.values()) / Math.max(1, [...authorCounts.values()].reduce((a, b) => a + b, 0)) * 100).toFixed(1))
    : 0;
  const channelConcentrationPct = channelCounts.size
    ? Number((Math.max(...channelCounts.values()) / Math.max(1, [...channelCounts.values()].reduce((a, b) => a + b, 0)) * 100).toFixed(1))
    : 0;

  return {
    sampledPosts24h: sample,
    nonPromotionalPosts24h: nonPromotional,
    sampledMentions15m: mentions15m,
    sampledMentions1h: mentions1h,
    sampledMentionsPrevious1h: mentionsPrevious1h,
    sampledMentions6h: mentions6h,
    nonPromotionalMentions1h,
    nonPromotionalMentions24h,
    promotionalPosts24h: promotionalPosts,
    uniqueAuthors24h: authors.size,
    uniqueAuthors6h: authors6h.size,
    uniqueAuthors1h: authors1h.size,
    uniqueChannels24h: channels.size,
    uniqueChannels1h: channels1h.size,
    uniqueSources24h: sources.size,
    independentEntities24h,
    duplicateTexts: duplicates,
    duplicateSharePct,
    weakTickerMatches: weakMatches,
    weakMatchSharePct,
    exactMatchSharePct,
    identityConfidence: !sample ? 'unavailable' : weakMatchSharePct >= 50 ? 'low' : exactMatchSharePct >= 70 ? 'good' : 'medium',
    accelerationRatio,
    accelerating,
    authorConcentrationPct,
    channelConcentrationPct,
    engagement24h: engagement,
    engagementScore: Number(engagementScore.toFixed(1)),
    socialMomentumScore,
    confidence: sample >= 6 && independentEntities24h >= 4 && exactMatchSharePct >= 70 && duplicateSharePct < 40
      ? 'limited_sample' : sample >= 3 && independentEntities24h >= 3 && exactMatchSharePct >= 70 && duplicateSharePct < 50
        ? 'early_signal' : 'small_sample',
    limitations: 'Les métriques décrivent uniquement les publications publiques collectées. Les auteurs sont dédupliqués par réseau, les canaux Telegram séparément. Les abonnés et interactions ne prouvent ni audience réelle ni intention d’achat; les tickers seuls restent ambigus.'
  };
}

module.exports = { classifyTokenMention, analyzeSocialEvidence, isPromotionalPost };
