'use strict';

const { classifyTokenMention, isPromotionalPost } = require('./social-evidence');

const THEMES = [
  { theme: 'IA / agents', pattern: /\b(ai|agent|gpt|llm|neural|robot|artificial|claude|openai)\b/i },
  { theme: 'Animaux', pattern: /\b(cat|dog|doge|pepe|frog|monkey|penguin|bear|bull|shark|bird|hamster|frog)\b/i },
  { theme: 'Politique', pattern: /\b(trump|maga|biden|president|politic|election|government|white house)\b/i },
  { theme: 'Culture internet', pattern: /\b(meme|wojak|chill|sigma|brainrot|viral|tiktok|internet|skibidi)\b/i },
  { theme: 'Finance / trading', pattern: /\b(gold|silver|stock|coin|finance|bank|trader|market|quant|whale)\b/i },
  { theme: 'Gaming', pattern: /\b(game|gaming|gamer|minecraft|fortnite|pokemon|sonic|mario|roblox)\b/i },
  { theme: 'Sport', pattern: /\b(football|soccer|basketball|nba|nfl|ufc|formula ?1|f1|tennis|world cup)\b/i },
  { theme: 'Espace / science', pattern: /\b(space|mars|moon|nasa|rocket|alien|science|quantum)\b/i }
];

const parseTime = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
};

function narrativeSummary(tokens, now = Date.now()) {
  const counts = new Map();
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const launchAt = parseTime(token.firstSeenAt || token.pumpCreatedAt || token.geckoPoolCreatedAt || token.updatedAt);
    if (launchAt === null || launchAt > now + 60000 || now - launchAt > 86400000) continue;

    const metadata = [token.name, token.symbol, token.description].filter(Boolean).join(' ');
    const posts = (Array.isArray(token.socialIntel?.posts) ? token.socialIntel.posts : [])
      .map(post => {
        const publishedAt = parseTime(post.publishedAt);
        const text = String(post.text || post.title || '').slice(0, 2000);
        const match = classifyTokenMention(text, token);
        const source = String(post.source || 'unknown').toLowerCase();
        return { ...post, text, publishedAt, match, source, network: source.includes('telegram') ? 'telegram' : source };
      })
      .filter(post => post.publishedAt !== null && post.publishedAt <= now + 60000
        && now - post.publishedAt <= 86400000 && post.match !== 'none' && post.match !== 'ticker'
        && !isPromotionalPost(post, post.network));

    const themes = new Set();
    for (const entry of THEMES) {
      if (entry.pattern.test(metadata) || posts.some(post => entry.pattern.test(post.text))) themes.add(entry.theme);
    }
    if (!themes.size) continue;

    for (const theme of themes) {
      const row = counts.get(theme) || {
        theme, tokens1h: 0, tokens24h: 0, mentions1h: 0, mentions24h: 0,
        uniqueAuthors24h: 0, uniqueSources24h: 0, duplicatePostsExcluded: 0, samples: [],
        _authors: new Set(), _sources: new Set(), _posts: new Set()
      };
      row.tokens24h++;
      if (now - launchAt <= 3600000) row.tokens1h++;
      row._mints.add(token.mint || token.symbol || token.name || theme);
      if (row.samples.length < 5) row.samples.push({ symbol: token.symbol || '—', name: token.name || 'Token' });

      const themePattern = THEMES.find(entry => entry.theme === theme)?.pattern;
      for (const post of posts) {
        if (!themePattern?.test(post.text) && !themePattern?.test(metadata)) continue;
        const fingerprint = post.text.normalize('NFKC').toLowerCase().replace(/https?:\\/\\/\\S+/g, ' ').replace(/[^a-z0-9$]+/g, ' ').trim();
        const identity = fingerprint || String(post.link || post.uri || [post.source, post.author, post.publishedAt].join('|'));
        if (row._posts.has(identity)) { row.duplicatePostsExcluded++; continue; }
        row._posts.add(identity);
        row.mentions24h++;
        if (now - post.publishedAt <= 3600000) row.mentions1h++;
        const source = String(post.source || 'unknown');
        row._sources.add(source);
        const author = post.author || (post.network === 'telegram' ? post.channel : null);
        if (author) row._authors.add(source.toLowerCase() + ':' + String(author).toLowerCase());
      }
      counts.set(theme, row);
    }
  }

  return [...counts.values()].map(row => {
    row.uniqueAuthors24h = row._authors.size;
    row.uniqueSources24h = row._sources.size;
    const hourlyBaseline = row.mentions24h / 24;
    row.trend = row.mentions1h >= 3 && row.uniqueAuthors24h >= 2 && row.mentions1h > hourlyBaseline * 1.5
      ? 'accélération observée'
      : row.tokens1h > 0 ? 'nouveaux tokens observés' : 'activité récente limitée';
    row.evidence = row.mentions24h > 0 ? 'mentions publiques token-matchées, non promotionnelles' : 'classification des noms et descriptions de tokens';
    delete row._authors;
    delete row._sources;
    delete row._posts;
    return row;
  }).sort((a, b) => b.mentions1h - a.mentions1h || b.tokens1h - a.tokens1h || b.mentions24h - a.mentions24h || b.tokens24h - a.tokens24h).slice(0, 8);
}

module.exports = { narrativeSummary, THEMES };
