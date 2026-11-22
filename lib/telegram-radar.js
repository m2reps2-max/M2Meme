'use strict';

const CHANNEL_CACHE_MS = 15 * 60 * 1000;
const MAX_CHANNELS_PER_TOKEN = 3;
const DISCOVERY_SEEDS = ["solearlytrending","solwhaletrending","soltrenchtrending","spydefi","arcanegems","KOLscope","kolscreener","WizardScan","trending","mad_apes_gambles","hayzonn","Celtic10inarow","lenvies","idrawlineTG","moonzymemecoin","lizzytrades","sadcatgamble","unipcsjournal","memecoinwhalespump","marcellcooks","FORTUNEX100CALLZ","BossmanCallsOfficial","mars100xcryptocalls","PowsGemCalls","spidersjournal","CHINAGEMOFCCCN","trenchwithtrav","Mrbigbagcalls","lowtaxsolana","ProfitsPlays","mad_apes_call","Crypto_KingCall","marine_CryptoCalls","ryoshigamble","missorplays","realIndexSignal","solsticesmoonshots","TheUnipcs_Official","eezzyjournal","J7tradingjournal","LionCALL","robogems","christophersalpha","sugarydick","QwertysQuants","eunicalls","DegenSeals","SIGNALCALLS","TonMarketPulse","icospeaksnews"];
const MAX_DISCOVERY_CHANNELS = 50;
const DISCOVERY_BATCH_SIZE = 8;
const DISCOVERY_POST_RETENTION_MS = 7 * 86400000;
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

function extractHeaderChannels(html, currentChannel = '') {
  const source = String(html || '');
  const firstPost = source.search(/<div\b[^>]*\bdata-post=/i);
  const header = firstPost >= 0 ? source.slice(0, firstPost) : source.slice(0, 30000);
  const found = new Set();
  for (const match of header.matchAll(/<a\b[^>]*href=["'](https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = stripHtml(match[2]).toLowerCase();
    if (/\b(?:buy|contact|admin|support|help|bot|premium|join)\b/.test(label)) continue;
    try {
      const url = new URL(match[1]);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 's') parts.shift();
      const username = String(parts[0] || '').toLowerCase();
      if (!/^[a-z0-9_]{5,32}$/.test(username) || username === String(currentChannel).toLowerCase()) continue;
      if (/^(?:joinchat|share|addstickers|proxy|iv|login)$/i.test(username)) continue;
      found.add(username);
    } catch {}
  }
  return [...found].slice(0, 8);
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
  constructor({ fetchImpl = fetch, cacheMs = CHANNEL_CACHE_MS, seedChannels = DISCOVERY_SEEDS, maxDiscoveryChannels = MAX_DISCOVERY_CHANNELS } = {}) {
    this.fetchImpl = fetchImpl; this.cacheMs = cacheMs; this.channelCache = new Map();
    this.lastSuccessAt = null; this.lastError = null; this.lastAttemptAt = null; this.channelsFetched = 0;
    this.discoveryChannels = [...new Set(seedChannels.map(x => String(x).toLowerCase()).filter(x => /^[a-z0-9_]{5,32}$/.test(x)))].slice(0, maxDiscoveryChannels);
    this.discoveryVisited = new Set(); this.discoveryCursor = 0; this.maxDiscoveryChannels = maxDiscoveryChannels;
    this.globalPosts = new Map(); this.discoveryLastSuccessAt = null; this.discoveryLastError = null; this.discoveryChannelsScanned = 0;
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
    const entry = { fetchedAt: Date.now(), posts: parseTelegramPage(html, channel), linkedChannels: extractHeaderChannels(html, channel) };
    this.channelCache.set(channel, entry); this.channelsFetched++;
    this.lastSuccessAt = new Date(entry.fetchedAt).toISOString(); this.lastError = null;
    return entry;
  }
  async discoverPublicChannels({ limit = DISCOVERY_BATCH_SIZE } = {}) {
    const batchSize = Math.max(1, Math.min(DISCOVERY_BATCH_SIZE, Number(limit) || DISCOVERY_BATCH_SIZE));
    const batch = this.discoveryChannels.length ? Array.from({ length: Math.min(batchSize, this.discoveryChannels.length) }, (_, index) => this.discoveryChannels[(this.discoveryCursor + index) % this.discoveryChannels.length]) : [];
    if (this.discoveryChannels.length) this.discoveryCursor = (this.discoveryCursor + batch.length) % this.discoveryChannels.length;
    this.lastAttemptAt = new Date().toISOString();
    let scanned = 0;
    for (const channel of batch) {
      try {
        const entry = await this.channelPosts(channel);
        this.discoveryVisited.add(channel);
        scanned++;
        for (const post of entry.posts) this.globalPosts.set(post.link, { ...post, discoverySeed: DISCOVERY_SEEDS.includes(channel) });
        for (const linked of entry.linkedChannels || []) {
          if (this.discoveryChannels.length >= this.maxDiscoveryChannels) break;
          if (!this.discoveryChannels.includes(linked)) this.discoveryChannels.push(linked);
        }
      } catch (error) {
        this.discoveryLastError = String(error.message || error).slice(0, 160);
      }
    }
    const now = Date.now();
    for (const [link, post] of this.globalPosts) if (!Number.isFinite(Date.parse(post.publishedAt)) || now - Date.parse(post.publishedAt) > DISCOVERY_POST_RETENTION_MS) this.globalPosts.delete(link);
    while (this.globalPosts.size > 500) this.globalPosts.delete(this.globalPosts.keys().next().value);
    this.discoveryChannelsScanned += scanned;
    if (scanned) {
      this.discoveryLastSuccessAt = new Date().toISOString();
      this.discoveryLastError = null;
    }
    return { scanned, discoveredChannels: this.discoveryChannels.length, queuedChannels: Math.max(0, this.discoveryChannels.length - this.discoveryVisited.size), postsRetained: this.globalPosts.size, lastSuccess: this.discoveryLastSuccessAt, error: this.discoveryLastError };
  }
  matchDiscoveredToken(token) {
    const now = Date.now();
    const matches = [...this.globalPosts.values()].filter(post => tokenMention(post.text, token));
    const recent1h = matches.filter(post => now - Date.parse(post.publishedAt) <= 3600000);
    const recent24h = matches.filter(post => now - Date.parse(post.publishedAt) <= 86400000);
    const channels = [...new Set(recent24h.map(post => post.channel))];
    const connected = Boolean(this.discoveryLastSuccessAt && now - Date.parse(this.discoveryLastSuccessAt) < 3600000);
    return {
      available: connected, provider: 'Telegram public discovery (curated channels)', checkedAt: new Date().toISOString(),
      mentions1h: recent1h.length, mentions24h: recent24h.length, uniqueAuthors24h: 0,
      uniqueChannels24h: channels.length, sourceChannels: channels, sentimentScore: null,
      channelsScanned: this.discoveryVisited.size, posts: recent24h.slice(0, 8).map(({ id, channel, text, publishedAt, link, source }) => ({ id, channel, title: text.slice(0, 240), text: text.slice(0, 1000), publishedAt, link, source }))
    };
  }
  async searchToken(token) {
    const channels = extractPublicChannels(token), checkedAt = new Date().toISOString();
    if (!channels.length) return this.matchDiscoveredToken(token);
    this.lastAttemptAt = checkedAt;
    const settled = [];
    for (const channel of channels) {
      try { const data = await this.channelPosts(channel); settled.push({ channel, posts: data.posts, ok: true }); }
      catch (error) { const message = String(error.message || error).slice(0, 160); settled.push({ channel, posts: [], ok: false, error: message }); this.lastError = message; }
    }
    const directMatches = settled.flatMap(row => row.posts.filter(post => tokenMention(post.text, token)).map(post => ({ ...post, channelOk: row.ok })));
    const discoveredMatches = [...this.globalPosts.values()].filter(post => tokenMention(post.text, token));
    const matches = [...new Map([...directMatches, ...discoveredMatches].map(post => [post.link, post])).values()];
    const now = Date.now(), recent1h = matches.filter(post => now - Date.parse(post.publishedAt) <= 3600000), recent24h = matches.filter(post => now - Date.parse(post.publishedAt) <= 86400000);
    const sourceChannels = [...new Set(recent24h.map(post => post.channel))], successfulChannels = settled.filter(row => row.ok).length;
    const result = {
      available: successfulChannels > 0 || Boolean(this.discoveryLastSuccessAt && Date.now() - Date.parse(this.discoveryLastSuccessAt) < 3600000), provider: 'Telegram public channel pages (t.me/s) + discovery', checkedAt: new Date().toISOString(),
      channels: [...new Set([...channels, ...this.discoveryChannels])], channelsScanned: successfulChannels + this.discoveryVisited.size, channelsFailed: settled.length - successfulChannels,
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
      mode: 'Découverte de canaux publics crypto/Solana + liens de métadonnées · pages t.me/s · sans clé ni compte',
      lastAttempt: this.lastAttemptAt, lastSuccess: this.discoveryLastSuccessAt || this.lastSuccessAt, lastError: this.discoveryLastError || this.lastError,
      cachedChannels: this.channelCache.size, channelsFetched: this.channelsFetched, cacheMinutes: Math.round(this.cacheMs / 60000),
      discovery: { seedChannels: DISCOVERY_SEEDS.length, configuredChannels: this.discoveryChannels.length, batchSize: DISCOVERY_BATCH_SIZE, discoveredChannels: this.discoveryChannels.length, visitedChannels: this.discoveryVisited.size, queuedChannels: this.discoveryChannels.filter(x => !this.discoveryVisited.has(x)).length, postsRetained: this.globalPosts.size, totalChannelScans: this.discoveryChannelsScanned },
      limitations: 'Canaux publics uniquement; découverte à partir de sources initiales et de leurs liens publics; plusieurs canaux sont promotionnels et leurs performances sont auto-déclarées; aucune garantie de couverture exhaustive, aucun groupe privé.' };
  }
}

module.exports = { TelegramRadar, extractPublicChannels, extractHeaderChannels, parseTelegramPage, tokenMention, DISCOVERY_SEEDS, MAX_DISCOVERY_CHANNELS, DISCOVERY_BATCH_SIZE };
