'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validChatId, normalizeTelegramChannels, addTelegramChannel,
  updateTelegramChannel, removeTelegramChannel, upsertTelegramChannel, scoreVerdict, buildTelegramAlertKeyboard, formatTelegramAlert
} = require('../lib/telegram-channels');

test('accepts numeric Telegram chat ids and public channel usernames', () => {
  assert.equal(validChatId('-1001234567890'), true);
  assert.equal(validChatId('@meme_radar_news'), true);
  assert.equal(validChatId('not-a-channel'), false);
});

test('migrates the legacy chat id only when no channel is already configured', () => {
  assert.equal(normalizeTelegramChannels([], '-1001234567890')[0].chatId, '-1001234567890');
  assert.equal(normalizeTelegramChannels([{ chatId: '@meme_radar_news' }], '-1001234567890').length, 1);
});

test('adds channels once and enforces the ten-channel limit', () => {
  const first = addTelegramChannel([], { chatId: '@meme_radar_news' }, '2026-11-23T00:00:00.000Z');
  assert.equal(first.ok, true);
  assert.equal(addTelegramChannel(first.channels, { chatId: '@meme_radar_news' }).ok, false);
  let channels = first.channels;
  for (let i = 0; i < 9; i++) channels = addTelegramChannel(channels, { chatId: '-1001234567' + String(i).padStart(3, '0') }).channels;
  assert.equal(channels.length, 10);
  assert.equal(addTelegramChannel(channels, { chatId: '-1009999999999' }).ok, false);
});

test('updates and removes only the requested channel', () => {
  const channels = normalizeTelegramChannels([{ chatId: '@meme_radar_news', enabled: true }, { chatId: '-1001234567890' }]);
  const updated = updateTelegramChannel(channels, '@meme_radar_news', { enabled: false });
  assert.equal(updated.channels[0].enabled, false);
  assert.equal(removeTelegramChannel(updated.channels, '-1001234567890').channels.length, 1);
});

test('verdicts are labels, not probability claims', () => {
  assert.equal(scoreVerdict(87), 'TRÈS PROMETTEUR');
  assert.equal(scoreVerdict(73), 'PROMETTEUR');
  assert.equal(scoreVerdict(40), 'PEU INTÉRESSANT');
  assert.equal(scoreVerdict(99, 'danger'), 'RISQUE IMPORTANT');
});

test('formats a curated best-memecoin post with market details and terminal links', () => {
  const message = formatTelegramAlert({
    name: 'Example Token', symbol: 'EX', mint: '8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump',
    liquidityUsd: 12000, fdv: 43000, ageMinutes: 30, volume: { h1: 4000 }, txns: { h1: { buys: 18, sells: 2 } },
    analysis: { score: 87, coverage: 92, securityComprehensive: false, factors: { security: 82, buyRatio: 90, momentum: 75 }, flags: [] },
    signalReasons: ['Liquidité correcte', 'Activité acheteurs en hausse']
  });
  assert.match(message, /\$EX/);
  assert.match(message, /87\/100/);
  assert.match(message, /TRÈS PROMETTEUSE/);
  assert.match(message, /MEMECOIN RETENUE/);
  assert.match(message, /DONNÉES DU MARCHÉ/);
  assert.match(message, /Volume \(1 h\)/);
  assert.match(message, /Transactions/);
  assert.match(message, /\n/);
  assert.doesNotMatch(message, /\\\\n/);
  assert.ok(message.includes('couverture de l’analyse <b>92%</b>'));
  assert.match(message, /Valorisation estimée \(FDV\)/);
  assert.match(message, /Liquidité/);
  assert.match(message, /30 min/);
  assert.match(message, /Pourquoi elle ressort/);
  assert.match(message, /18 achats contre 2 ventes/);
  assert.match(message, /90 % des transactions sont des achats/);
  assert.doesNotMatch(message, /CONTRÔLE DE SÉCURITÉ|Contrôle on-chain|Contrôles approfondis/);
  assert.match(message, /<code>8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump<\/code>/);
  assert.doesNotMatch(message, /Cette sélection repose|ne garantit aucun rendement/);
  assert.doesNotMatch(message, /Variation \\(1 h\\)|Phantom/);
});


test('does not invent a positive reason when observed market evidence is missing', () => {
  const { buildSelectionReason } = require('../lib/telegram-channels');
  const reason = buildSelectionReason({ analysis: { score: 88, coverage: 90, factors: { momentum: 95, liquidityQuality: 99 } } });
  assert.match(reason, /aucun indicateur positif isolé n’est suffisamment documenté/);
  assert.doesNotMatch(reason, /momentum positif|bonne qualité de liquidité|score élevé/);
});

test('keeps the channel selection in French and never leaks raw foreign-language signal text', () => {
  const message = formatTelegramAlert({
    name: 'Token Name', symbol: 'TN', mint: '8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump',
    fdv: 10000, liquidityUsd: 6000, volume: { h1: 900 }, txns: { h1: { buys: 12, sells: 4 } }, ageMinutes: 8,
    analysis: { score: 91, coverage: 88, factors: { security: 90 }, flags: [{ level: 'warning', message: 'Low liquidity and suspicious activity' }] },
    signalReasons: ['All checks passed']
  });
  assert.match(message, /MEMECOIN RETENUE/);
  assert.match(message, /Valorisation estimée/);
  assert.match(message, /Liquidité/);
  assert.match(message, /Pourquoi elle ressort/);
  assert.doesNotMatch(message, /CONTRÔLE DE SÉCURITÉ|Contrôle on-chain/);
  assert.doesNotMatch(message, /Low liquidity|suspicious activity|All checks passed/);
});

test('escapes token-controlled text and keeps risk alerts concise', () => {
  const message = formatTelegramAlert({
    name: 'Offchain <script> & Co', symbol: 'OFF&', mint: '5jv4h9dam2xtheatffvqfjpnhj2gmd3443auuxisccgm',
    liquidityUsd: 1650, fdv: 2056, ageMinutes: 10,
    analysis: { score: 71, coverage: 75, hardBlocked: true, flags: [{ level: 'critical', message: 'Chute du prix > 20% sur 5 minutes' }] }
  }, 'danger');
  assert.ok(message.startsWith('🚨 <b>RISQUE DÉTECTÉ</b>'));
  assert.match(message, /Offchain &lt;script&gt; &amp; Co/);
  assert.match(message, /RISQUE IMPORTANT/);
  assert.doesNotMatch(message, /Sécurité :|CONTRÔLE DE SÉCURITÉ/);
  assert.match(message, /Chute du prix &gt; 20% sur 5 minutes/);
  assert.doesNotMatch(message, /<script>/);
});

test('builds DexScreener, GMGN and Axiom buttons only for valid Solana mints',()=>{
  const mint='8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump';
  assert.deepEqual(buildTelegramAlertKeyboard({mint}),{
    inline_keyboard:[[
      {text:'DexScreener',url:'https://dexscreener.com/solana/'+mint},
      {text:'GMGN',url:'https://gmgn.ai/sol/token/'+mint},
      {text:'Axiom',url:'https://axiom.trade/t/'+mint},
      {text:'👻 Phantom',url:'https://phantom.com/tokens/solana/'+mint}
    ]]
  });
  assert.equal(buildTelegramAlertKeyboard({mint:'not-a-solana-mint'}),null);
  assert.equal(buildTelegramAlertKeyboard({mint:''}),null);
});

test('discovers a channel automatically when Telegram promotes the bot to administrator', () => {
  const chat = { id: -1001234567890, type: 'channel', title: 'M2 Signals', username: 'm2_signals' };
  const result = upsertTelegramChannel([], chat, { status: 'administrator', can_post_messages: true }, '2026-11-23T12:00:00.000Z');
  assert.equal(result.ok, true);
  assert.equal(result.channel.chatId, '-1001234567890');
  assert.equal(result.channel.label, 'M2 Signals');
  assert.equal(result.channel.username, 'm2_signals');
  assert.equal(result.channel.enabled, true);
  assert.equal(result.channel.canPostMessages, true);
});

test('does not activate a channel until the bot can publish messages', () => {
  const result = upsertTelegramChannel([], { id: -1001234567890, type: 'channel', title: 'Read only' }, { status: 'member' });
  assert.equal(result.ok, true);
  assert.equal(result.channel.enabled, false);
  assert.equal(result.channel.canPostMessages, false);
  assert.match(result.channel.lastError, /administrateur/);
});

test('keeps a disconnected channel visible but disables publication', () => {
  const connected = upsertTelegramChannel([], { id: -1001234567890, type: 'channel', title: 'M2 Signals' }, { status: 'administrator', can_post_messages: true });
  const disconnected = upsertTelegramChannel(connected.channels, { id: -1001234567890, type: 'channel', title: 'M2 Signals' }, { status: 'left' });
  assert.equal(disconnected.ok, true);
  assert.equal(disconnected.channel.enabled, false);
  assert.equal(disconnected.channel.status, 'left');
  assert.equal(disconnected.channels.length, 1);
});
