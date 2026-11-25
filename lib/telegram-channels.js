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
      { text: 'Axiom', url: 'https://axiom.trade/t/' + mint },
      { text: '👻 Acheter sur Phantom', url: 'https://phantom.com/tokens/solana/' + mint }
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

function buildSelectionReason(token = {}) {
  const facts = [];
  const txns = token.txns?.h1 || {};
  const buys = Number(txns.buys);
  const sells = Number(txns.sells);
  const total = buys + sells;
  const priceChange = token.priceChange || {};
  const trade = token.tradeIntel || {};
  const social = token.socialIntel?.evidence || {};

  // Use only observed values. Never turn a model factor or a score into a factual claim.
  if (Number.isFinite(buys) && Number.isFinite(sells) && total >= 10 && buys > sells) {
    const buyShare = buys / total * 100;
    if (buyShare >= 60) {
      facts.push('sur 1 h, ' + buys + ' achats contre ' + sells + ' ventes (' + Math.round(buyShare) + ' % des transactions sont des achats)');
    }
  }

  for (const period of ['h1', 'h6', 'h24']) {
    const change = Number(priceChange[period]);
    if (Number.isFinite(change) && change >= 5) {
      facts.push('prix en hausse de ' + change.toFixed(1).replace('.', ',') + ' % sur ' + ({ h1: '1 h', h6: '6 h', h24: '24 h' }[period]));
      break;
    }
  }

  const buyVolume = Number(trade.buyVolumeUsd);
  const sellVolume = Number(trade.sellVolumeUsd);
  const uniqueBuyers = Number(trade.uniqueBuyers);
  const tradeCount = Number(trade.tradeCount);
  if (Number.isFinite(buyVolume) && Number.isFinite(sellVolume)
      && Number.isFinite(uniqueBuyers) && Number.isFinite(tradeCount)
      && tradeCount >= 10 && uniqueBuyers >= 3 && buyVolume > sellVolume * 1.25) {
    facts.push('sur ' + tradeCount + ' swaps observés, ' + money(buyVolume) + ' d’achats contre ' + money(sellVolume) + ' de ventes, avec ' + uniqueBuyers + ' acheteurs distincts');
  }

  const mentions1h = Number(social.nonPromotionalMentions1h);
  const authors = Number(social.uniqueAuthors24h);
  const sources = Number(social.uniqueSources24h);
  const identityMatch = Number(social.exactMatchSharePct);
  const duplicateShare = Number(social.duplicateSharePct);
  if (Number.isFinite(mentions1h) && mentions1h >= 2
      && Number.isFinite(authors) && authors >= 3
      && Number.isFinite(sources) && sources >= 2
      && Number.isFinite(identityMatch) && identityMatch >= 70
      && Number.isFinite(duplicateShare) && duplicateShare < 50) {
    facts.push(mentions1h + ' mentions non promotionnelles en 1 h, venant de ' + authors + ' auteurs sur ' + sources + ' sources');
  }

  const liquidityChange = Number(token.metrics?.liquidityChangePct);
  if (Number.isFinite(liquidityChange) && liquidityChange >= 5) {
    facts.push('liquidité en hausse de ' + liquidityChange.toFixed(1).replace('.', ',') + ' % depuis le précédent relevé');
  }

  const early = trade.earlyWindow;
  const earlyBuyers = Number(early?.uniqueBuyers);
  if (early?.complete === true && Number.isFinite(earlyBuyers) && earlyBuyers >= 5) {
    facts.push(earlyBuyers + ' acheteurs distincts observés pendant les 5 premières minutes du pool');
  }

  const selected = facts.slice(0, 2);
  if (selected.length) {
    return '💡 <b>Pourquoi elle ressort :</b> ' + selected.join(' ; ') + '.';
  }
  return '💡 <b>Signal mesuré :</b> aucun indicateur positif isolé n’est suffisamment documenté dans les données disponibles.';
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
  const hasFdv = Number.isFinite(Number(token?.fdv)) && Number(token.fdv) > 0;
  const valuation = hasFdv ? money(token.fdv) : money(token?.marketCap);
  const valuationLabel = hasFdv ? 'Valorisation estimée (FDV)' : 'Capitalisation';
  const volume1h = money(token?.volume?.h1);
  const buys = Number(token?.txns?.h1?.buys);
  const sells = Number(token?.txns?.h1?.sells);
  const hasBuys = Number.isFinite(buys) && buys >= 0;
  const hasSells = Number.isFinite(sells) && sells >= 0;
  const transactions = hasBuys && hasSells ? String(buys + sells) : '—';
  const buyRatio = hasBuys && hasSells && buys + sells > 0 ? Math.round(buys / (buys + sells) * 100) + '%' : '—';
  const age = formatAge(token);
  const whySelected = buildSelectionReason(token);
  if (level === 'danger') {
    const criticalFlags = Array.isArray(analysis.flags) ? analysis.flags.filter(x => x?.level === 'critical').slice(0, 2).map(x => escapeHtml(x.message)) : [];
    return [
      '🚨 <b>RISQUE DÉTECTÉ</b>',
      '⚠️ ' + escapeHtml(scoreVerdict(score, 'danger')),
      '',
      '<b>$' + escapeHtml(symbol) + '</b> — ' + escapeHtml(name),
      criticalFlags.join(' · ') || 'Un signal critique a été détecté.',
      '',
      'CA : <code>' + escapeHtml(mint || 'Indisponible') + '</code>'
    ].join('\n').slice(0, 1800);
  }
  const verdict = score === null ? 'Score indisponible' : score >= 90 ? 'EXCEPTIONNELLE' : score >= 80 ? 'TRÈS PROMETTEUSE' : score >= 70 ? 'PROMETTEUSE' : score >= 55 ? 'À SURVEILLER' : 'PEU INTÉRESSANTE';
  const scoreLabel = score === null ? verdict : '⭐ <b>' + score + '/100</b> · ' + verdict;
  const lines = [
    '💎 <b>MEMECOIN RETENUE</b>',
    '',
    '<b>$' + escapeHtml(symbol) + '</b> — ' + escapeHtml(name),
    scoreLabel + ' · couverture de l’analyse <b>' + escapeHtml(coverage) + '</b>',
    whySelected,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '<b>📊 DONNÉES DU MARCHÉ</b>',
    '🏷 ' + valuationLabel + ' : <b>' + valuation + '</b>',
    '💧 Liquidité : <b>' + liquidity + '</b>',
    '📈 Volume (1 h) : <b>' + volume1h + '</b>',
    '🔄 Transactions (1 h) : <b>' + transactions + '</b> · achats <b>' + buyRatio + '</b>',
    '⏱ Âge du pool : <b>' + escapeHtml(age) + '</b>',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '<b>📋 ADRESSE DU CONTRAT (CA)</b>',
    '<code>' + escapeHtml(mint || 'Indisponible') + '</code>',
    ''
  ];
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
  buildSelectionReason,
  formatAge
};
