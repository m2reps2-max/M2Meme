'use strict';

const MAX_CHANNELS = 10;

function validChatId(value) {
  const id = String(value || '').trim();
  return /^-?\d{5,20}$/.test(id) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(id);
}

function normalizeTelegramChannels(input, legacyChatId = '') {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set();
  const channels = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const chatId = String(row.chatId || row.id || '').trim();
    if (!validChatId(chatId) || seen.has(chatId) || channels.length >= MAX_CHANNELS) continue;
    seen.add(chatId);
    channels.push({
      chatId,
      label: String(row.label || chatId).trim().slice(0, 60) || chatId,
      enabled: row.enabled !== false,
      addedAt: typeof row.addedAt === 'string' ? row.addedAt : null,
      lastSentAt: typeof row.lastSentAt === 'string' ? row.lastSentAt : null,
      lastError: typeof row.lastError === 'string' ? row.lastError.slice(0, 180) : null,
      type: row.type === 'channel' ? 'channel' : null,
      username: typeof row.username === 'string' ? row.username.slice(0, 32) : null,
      status: typeof row.status === 'string' ? row.status.slice(0, 24) : null,
      canPostMessages: typeof row.canPostMessages === 'boolean' ? row.canPostMessages : null
    });
  }
  const legacy = String(legacyChatId || '').trim();
  if (!channels.length && validChatId(legacy)) {
    channels.push({ chatId: legacy, label: 'Canal principal', enabled: true, addedAt: new Date().toISOString(), lastSentAt: null, lastError: null });
  }
  return channels;
}

function addTelegramChannel(input, channel, now = new Date().toISOString()) {
  const channels = normalizeTelegramChannels(input);
  const chatId = String(channel?.chatId || '').trim();
  if (!validChatId(chatId)) return { ok: false, error: 'Entre un identifiant Telegram valide (@nomducanal ou identifiant numérique).' };
  if (channels.some(row => row.chatId === chatId)) return { ok: false, error: 'Ce canal est déjà ajouté.' };
  if (channels.length >= MAX_CHANNELS) return { ok: false, error: 'Maximum 10 canaux.' };
  const label = String(channel?.label || chatId).trim().slice(0, 60) || chatId;
  channels.push({ chatId, label, enabled: true, addedAt: now, lastSentAt: null, lastError: null });
  return { ok: true, channels, channel: channels[channels.length - 1] };
}

function upsertTelegramChannel(input, chat, member, now = new Date().toISOString()) {
  if (!chat || chat.type !== 'channel' || !validChatId(chat.id)) {
    return { ok: false, error: 'Mise à jour Telegram ignorée : canal invalide.' };
  }
  const channels = normalizeTelegramChannels(input);
  const chatId = String(chat.id);
  const status = String(member?.status || 'left');
  const canPostMessages = status === 'administrator' && member?.can_post_messages !== false;
  const index = channels.findIndex(row => row.chatId === chatId);
  if (index < 0 && (status === 'left' || status === 'kicked')) {
    return { ok: true, ignored: true, channels };
  }
  if (index < 0 && channels.length >= MAX_CHANNELS) {
    return { ok: false, error: 'Maximum 10 canaux.' };
  }
  const previous = index >= 0 ? channels[index] : null;
  const label = String(chat.title || (chat.username ? '@' + chat.username : '') || previous?.label || chatId).trim().slice(0, 60) || chatId;
  const channel = {
    chatId,
    label,
    enabled: canPostMessages ? (previous?.enabled !== false) : false,
    addedAt: previous?.addedAt || now,
    lastSentAt: previous?.lastSentAt || null,
    lastError: canPostMessages ? null : (status === 'left' || status === 'kicked' ? 'Le bot ne fait plus partie de ce canal.' : 'Le bot doit être administrateur avec le droit de publier.'),
    type: 'channel',
    username: typeof chat.username === 'string' ? chat.username : previous?.username || null,
    status,
    canPostMessages
  };
  if (index >= 0) channels[index] = channel;
  else channels.push(channel);
  return { ok: true, channels, channel };
}

function updateTelegramChannel(input, chatId, patch) {
  const channels = normalizeTelegramChannels(input);
  const index = channels.findIndex(row => row.chatId === String(chatId || '').trim());
  if (index < 0) return { ok: false, error: 'Canal introuvable.' };
  if (typeof patch?.enabled === 'boolean') channels[index].enabled = patch.enabled;
  if (typeof patch?.label === 'string') channels[index].label = patch.label.trim().slice(0, 60) || channels[index].chatId;
  return { ok: true, channels };
}

function removeTelegramChannel(input, chatId) {
  const channels = normalizeTelegramChannels(input);
  const filtered = channels.filter(row => row.chatId !== String(chatId || '').trim());
  if (filtered.length === channels.length) return { ok: false, error: 'Canal introuvable.' };
  return { ok: true, channels: filtered };
}

function scoreVerdict(score, level = 'opportunity') {
  if (level === 'danger') return 'RISQUE IMPORTANT';
  const value = score === null || score === undefined || score === '' ? NaN : Number(score);
  if (!Number.isFinite(value)) return 'ANALYSE INCOMPLÈTE';
  if (value >= 90) return 'EXCEPTIONNEL';
  if (value >= 80) return 'TRÈS PROMETTEUR';
  if (value >= 70) return 'PROMETTEUR';
  if (value >= 55) return 'À SURVEILLER';
  return 'PEU INTÉRESSANT';
}

function money(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(number) + ' $';
}

function buildTelegramAlertKeyboard(token) {
  const mint = String(token?.mint || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  return {
    inline_keyboard: [[{
      text: '👻 Acheter sur Phantom',
      url: 'https://phantom.com/tokens/solana/' + mint
    }]]
  };
}

function formatTelegramAlert(token, level = 'opportunity') {
  const analysis = token?.analysis || {};
  const rawScore = analysis.score;
  const score = rawScore !== null && rawScore !== undefined && rawScore !== '' && Number.isFinite(Number(rawScore)) ? Math.round(Number(rawScore)) : null;
  const verdict = scoreVerdict(score, level);
  const symbol = String(token?.symbol || 'TOKEN').replace(/[\r\n]/g, ' ').slice(0, 24);
  const name = String(token?.name || symbol).replace(/[\r\n]/g, ' ').slice(0, 48);
  const mint = String(token?.mint || '').trim();
  const url = String(token?.dexUrl || 'https://dexscreener.com/solana/' + mint);
  const liquidity = money(token?.liquidityUsd);
  const volume = money(token?.volume?.h1);
  const marketCap = money(token?.marketCap || token?.fdv);
  const rawChange = token?.priceChange?.h1 ?? token?.change?.h1;
  const change = rawChange === null || rawChange === undefined || rawChange === '' ? NaN : Number(rawChange);
  const changeText = Number.isFinite(change) ? (change > 0 ? '+' : '') + change.toFixed(1) + '%' : '—';
  const rawCoverage = analysis.coverage;
  const coverage = rawCoverage !== null && rawCoverage !== undefined && rawCoverage !== '' && Number.isFinite(Number(rawCoverage)) ? Math.round(Number(rawCoverage)) + '%' : '—';
  const reasons = Array.isArray(token?.signalReasons) ? token.signalReasons.slice(0, 2) : [];
  const flags = Array.isArray(analysis.flags) ? analysis.flags.filter(x => x?.level === 'critical').slice(0, 2).map(x => x.message) : [];
  const lines = [
    level === 'danger' ? '⚠️ ALERTE RISQUE' : '🚀 NOUVELLE TROUVAILLE',
    '',
    name + ' ($' + symbol + ')',
    'M2 : ' + (score === null ? '—' : score + '/100') + ' · ' + verdict,
    'Données disponibles : ' + coverage,
    '',
    '💰 Capitalisation / FDV : ' + marketCap,
    '💧 Liquidité : ' + liquidity,
    '📊 Volume 1 h : ' + volume,
    '📈 Variation 1 h : ' + changeText,
    '',
    level === 'danger' ? '🛑 Risque : ' + (flags.join(' ; ') || 'signal critique détecté') : '🔎 Pourquoi : ' + (reasons.join(' ; ') || 'plusieurs signaux de marché concordants'),
    '',
    'CA : ' + mint,
    url,
    '',
    'Le score mesure la qualité des signaux observés, pas une probabilité de hausse. Vérifie les données avant toute décision.'
  ];
  return lines.join('\n').slice(0, 3900);
}

module.exports = {
  MAX_CHANNELS,
  validChatId,
  normalizeTelegramChannels,
  addTelegramChannel,
  upsertTelegramChannel,
  updateTelegramChannel,
  removeTelegramChannel,
  scoreVerdict,
  buildTelegramAlertKeyboard,
  formatTelegramAlert
};
