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
  const usernameId = typeof chat.username === 'string' ? '@' + chat.username.toLowerCase() : '';
  const index = channels.findIndex(row => row.chatId === chatId || (usernameId && row.chatId.toLowerCase() === usernameId));
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
    inline_keyboard: [[
      { text: 'DexScreener', url: 'https://dexscreener.com/solana/' + mint },
      { text: 'GMGN', url: 'https://gmgn.ai/sol/token/' + mint },
      { text: 'Axiom', url: 'https://axiom.trade/t/' + mint }
    ]]
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatAge(token) {
  const minutes = token?.ageMinutes !== null && token?.ageMinutes !== undefined && token?.ageMinutes !== '' ? Number(token.ageMinutes)
    : token?.launchAgeHours !== null && token?.launchAgeHours !== undefined && token?.launchAgeHours !== '' ? Number(token.launchAgeHours) * 60
    : token?.ageHours !== null && token?.ageHours !== undefined && token?.ageHours !== '' ? Number(token.ageHours) * 60 : NaN;
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return Math.round(minutes) + ' min';
  if (minutes < 1440) return Number((minutes / 60).toFixed(1)) + ' h';
  return Number((minutes / 1440).toFixed(1)) + ' j';
}

function formatTelegramAlert(token, level = 'opportunity') {
  const analysis = token?.analysis || {};
  const rawScore = analysis.score;
  const score = rawScore !== null && rawScore !== undefined && rawScore !== '' && Number.isFinite(Number(rawScore)) ? Math.round(Number(rawScore)) : null;
  const symbol = String(token?.symbol || 'TOKEN').replace(/[\r\n]/g, ' ').slice(0, 24);
  const name = String(token?.name || symbol).replace(/[\r\n]/g, ' ').slice(0, 48);
  const mint = String(token?.mint || '').trim();
  const coverage = analysis.coverage !== null && analysis.coverage !== undefined && analysis.coverage !== '' && Number.isFinite(Number(analysis.coverage)) ? Math.round(Number(analysis.coverage)) + '%' : '—';
  const liquidity = money(token?.liquidityUsd);
  const marketCap = money(token?.marketCap || token?.fdv);
  const volume1h = money(token?.volume?.h1);
  const buys = Number(token?.txns?.h1?.buys);
  const sells = Number(token?.txns?.h1?.sells);
  const hasBuys = Number.isFinite(buys) && buys >= 0;
  const hasSells = Number.isFinite(sells) && sells >= 0;
  const transactions = hasBuys && hasSells ? String(buys + sells) : '—';
  const buyRatio = hasBuys && hasSells && buys + sells > 0 ? Math.round(buys / (buys + sells) * 100) + '%' : '—';
  const age = formatAge(token);
  const securityScore = analysis.factors?.security;
  const security = analysis.hardBlocked === true ? 'Bloqué'
    : typeof securityScore === 'number' && Number.isFinite(securityScore)
      ? (analysis.securityComprehensive === true ? 'Contrôles approfondis OK' : 'Contrôle on-chain de base OK')
      : 'À confirmer';
  const warnings = Array.isArray(analysis.flags)
    ? analysis.flags.filter(x => x?.level === 'warning').slice(0, 2).map(x => escapeHtml(x.message || 'Point de vigilance'))
    : [];
  const reasons = Array.isArray(token?.signalReasons) ? token.signalReasons.filter(Boolean).slice(0, 1).map(escapeHtml) : [];
  const highlights = warnings.length ? warnings : reasons.filter(x => !/Tous les critères du profil/i.test(x));
  if (level === 'danger') {
    const criticalFlags = Array.isArray(analysis.flags) ? analysis.flags.filter(x => x?.level === 'critical').slice(0, 2).map(x => escapeHtml(x.message)) : [];
    return [
      '🚨 <b>RISQUE DÉTECTÉ</b>',
      '⚠️ ' + escapeHtml(scoreVerdict(score, 'danger')),
      '',
      '<b>$' + escapeHtml(symbol) + '</b> — ' + escapeHtml(name),
      '🛡 Sécurité : <b>' + escapeHtml(security) + '</b>',
      criticalFlags.join(' · ') || 'Un signal critique a été détecté.',
      '',
      'CA : <code>' + escapeHtml(mint || 'Indisponible') + '</code>'
    ].join('\n').slice(0, 1800);
  }
  const scoreLabel = score === null ? 'Score indisponible' : '⭐ <b>' + score + '/100</b> · ' + escapeHtml(scoreVerdict(score));
  const marketRows = [
    '💰 Capitalisation : <b>' + marketCap + '</b>',
    '💧 Liquidité : <b>' + liquidity + '</b>',
    '📊 Volume 1 h : <b>' + volume1h + '</b>',
    '⚡ Activité 1 h : <b>' + transactions + ' transactions</b> · achats <b>' + buyRatio + '</b>',
    '🕒 Âge du marché : <b>' + escapeHtml(age) + '</b>'
  ];
  const lines = [
    '💎 <b>MEMECOIN SÉLECTIONNÉE</b>',
    '',
    '<b>$' + escapeHtml(symbol) + '</b> — ' + escapeHtml(name),
    scoreLabel + ' · couverture <b>' + escapeHtml(coverage) + '</b>',
    '',
    '<b>📈 DONNÉES DU MARCHÉ</b>',
    ...marketRows,
    '',
    '🛡 Sécurité : <b>' + escapeHtml(security) + '</b>'
  ];
  if (highlights.length) lines.push('🔎 À noter : ' + highlights.join(' · '));
  lines.push('', '🧾 CA : <code>' + escapeHtml(mint || 'Indisponible') + '</code>');
  lines.push('', '<i>Sélection fondée sur les critères M2 et les données disponibles — ce score n’est pas une promesse de performance.</i>');
  return lines.join('\n').slice(0, 1800);
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
  formatTelegramAlert,
  formatAge
};
