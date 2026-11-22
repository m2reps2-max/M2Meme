'use strict';

const CHANNEL_CACHE_MS = 15 * 60 * 1000;
const MAX_CHANNELS_PER_TOKEN = 3;
const decode = value => String(value || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } });

function stripHtml(value) {
  return decode(String(value || '').replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractPublicChannels(token) {
  const found = new Set();
  const add = value => {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 500) return;
    let url;
    try { url = new URL(raw.startsWith('www.') ? 'https://' + raw : raw); } catch { return; }
    if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase())) return;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 's') parts.shift();
    const username = parts[0] || '';
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) return;
    if (/^(joinchat|share|addstickers|proxy|s|iv|login)$/i.test(username) || username.startsWith('+')) return;
    found.add(username.toLowerCase());
  };
  const inspect = value => {
    if (typeof value === 'string') add(value);
    else if (value && typeof value === 'object') { add(value.url); add(value.link); add(value.href); }
  };
  for (const item of [...(Array.isArray(token?.socials) ? token.socials : []), ...(Array.isArray(token?.links) ? token.links : [])]) inspect(item);
  const description = String(token?.description || '');
  for (const match of description.matchAll(/https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/[^\s<>"')]+/gi)) add(match[0].replace(/[.,!?]+$/, ''));
  return [...found].slice(0, MAX_CHANNELS_PER_TOKEN);
}

function parseTelegramPage(html, channel, now = Date.now()) {
  const source = String(html || '');
  const starts = [...source.matchAll(/<div\b[^>]*\bdata-post=["']([^"']+)["'][^>]*>/gi)];
  const posts = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    const block = source.slice(start, end);
    const id = starts[i][1].split('/').pop();
    if (!/^\d+$/.test(id)) continue;
    const textMatch = block.match(/<div\b[^>]*class=["'][^"']*tgme_widget_message_text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const text = stripHtml(textMatch?.[1] || '');
    const timeMatch = block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i);
    const timestamp = timeMatch ? Date.parse(timeMatch[1]) : NaN;
    if (!text || !Number.isFinite(timestamp) || timestamp > now + 60000 || now - timestamp > 7 * 86400000) continue;
    posts.push({ id, channel: String(channel).toLowerCase(), text: text.slice(0, 3000), publishedAt: new Date(timestamp).toISOString(), link: 'https://t.me/' + encodeURIComponent(String(channel).toLowerCase()) + '/' + id, source: 'Telegram' });
  }
  const unique = new Map(posts.map(post => [post.link, post]));
  return [...unique.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function tokenMention(text, token) {
  const body = String(text || '').toLowerCase();
  const mint = String(token?.mint || '');
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) && body.includes(mint.toLowerCase())) return true;
  const symbol = String(token?.symbol || '').replace(/^\$/, '').trim();
  if (/^[a-z0-9]{4,15}$/i.test(symbol)) {
    const escaped = symbol.replace(/[.*+?^()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|[^a-z0-9])\\$?' + escaped + '($|[^a-z0-9])', 'i').test(body)) return true;
  }
  const name = String(token?.name || '').trim().toLowerCase();
  return name.length >= 6 && body.includes(name);
}

class TelegramRadar {
  constructor({ fetchImpl = fetch, cacheMs = CHANNEL_CACHE_MS } = {}) {
    this.fetchImpl = fetchImpl; this.cacheMs = cacheMs; this.channelCache = new Map();
    this.lastSuccessAt = null; this.lastError = null; this.lastAttemptAt = null; this.channelsFetched = 0;
  }
  async channelPosts(channel) {
    const cached = this.channelCache.get(channel);
    if (cached && Date.now() - cached.fetchedAt < this.cacheMs) return cached;
    const response = await this.fetchImpl('https://t.me/s/' + encodeURIComponent(channel), {
      headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; MEME-RADAR/2.3; public-channel-reader)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Telegram public channel HTTP ' + response.status);
    const html = await response.text();
    if (!/tgme_widget_message|tgme_channel_info|tgme_page/i.test(html)) throw new Error('Telegram public page structure not recognized');
    const entry = { fetchedAt: Date.now(), posts: parseTelegramPage(html, channel) };
    this.channelCache.set(channel, entry); this.channelsFetched++;
    this.lastSuccessAt = new Date(entry.fetchedAt).toISOString(); this.lastError = null;
    return entry;
  }
  async searchToken(token) {
    const channels = extractPublicChannels(token), checkedAt = new Date().toISOString();
    if (!channels.length) return { available: false, provider: 'Telegram public channels', checkedAt, error: 'Aucun canal Telegram public lié au token dans ses métadonnées.', mentions1h: 0, mentions24h: 0, uniqueAuthors24h: 0, uniqueChannels24h: 0, channelsScanned: 0, posts: [] };
    this.lastAttemptAt = checkedAt;
    const settled = [];
    for (const channel of channels) {
      try { const data = await this.channelPosts(channel); settled.push({ channel, posts: data.posts, ok: true }); }
      catch (error) { const message = String(error.message || error).slice(0, 160); settled.push({ channel, posts: [], ok: false, error: message }); this.lastError = message; }
    }
    const matches = settled.flatMap(row => row.posts.filter(post => tokenMention(post.text, token)).map(post => ({ ...post, channelOk: row.ok })));
    const now = Date.now(), recent1h = matches.filter(post => now - Date.parse(post.publishedAt) <= 3600000), recent24h = matches.filter(post => now - Date.parse(post.publishedAt) <= 86400000);
    const sourceChannels = [...new Set(recent24h.map(post => post.channel))], successfulChannels = settled.filter(row => row.ok).length;
    const result = {
      available: successfulChannels > 0, provider: 'Telegram public channel pages (t.me/s)', checkedAt: new Date().toISOString(),
      channels, channelsScanned: successfulChannels, channelsFailed: settled.length - successfulChannels,
      mentions1h: recent1h.length, mentions24h: recent24h.length, uniqueAuthors24h: 0, uniqueChannels24h: sourceChannels.length,
      sourceChannels, sentimentScore: null,
      posts: recent24h.slice(0, 8).map(({ id, channel, text, publishedAt, link, source }) => ({ id, channel, title: text.slice(0, 240), text: text.slice(0, 1000), publishedAt, link, source })),
      errors: settled.filter(row => !row.ok).map(row => ({ channel: row.channel, error: row.error }))
    };
    if (successfulChannels) this.lastSuccessAt = result.checkedAt;
    return result;
  }
  status() {
    const now = Date.now();
    for (const [channel, row] of this.channelCache) if (now - row.fetchedAt > this.cacheMs * 4) this.channelCache.delete(channel);
    return { configured: true, connected: Boolean(this.lastSuccessAt && now - Date.parse(this.lastSuccessAt) < 3600000),
      mode: 'Canaux publics liés aux métadonnées · pages t.me/s · sans clé ni compte',
      lastAttempt: this.lastAttemptAt, lastSuccess: this.lastSuccessAt, lastError: this.lastError,
      cachedChannels: this.channelCache.size, channelsFetched: this.channelsFetched, cacheMinutes: Math.round(this.cacheMs / 60000),
      limitations: 'Uniquement les canaux publics explicitement liés aux tokens; aucun groupe privé, aucune recherche globale Telegram.' };
  }
}

module.exports = { TelegramRadar, extractPublicChannels, parseTelegramPage, tokenMention };
