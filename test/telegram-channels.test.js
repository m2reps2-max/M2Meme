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

test('formats a compact French Telegram alert and explains the score', () => {
  const message = formatTelegramAlert({
    name: 'Example Token', symbol: 'EX', mint: 'MintAddress',
    liquidityUsd: 12000, fdv: 43000, volume: { h1: 93000 },
    priceChange: { h1: 47.6 }, dexUrl: 'https://dexscreener.com/solana/MintAddress',
    analysis: { score: 87, coverage: 92, flags: [] },
    signalReasons: ['Liquidité correcte', 'Activité acheteurs en hausse']
  });
  assert.match(message, /TRÈS PROMETTEUR/);
  assert.match(message, /87\/100/);
  assert.match(message, /qualité des signaux observés/);
  assert.match(message, /MintAddress/);
});

test('builds a direct Phantom token-page button only for valid Solana mints',()=>{
  const mint='8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump';
  assert.deepEqual(buildTelegramAlertKeyboard({mint}),{
    inline_keyboard:[[{text:'👻 Acheter sur Phantom',url:'https://phantom.com/tokens/solana/'+mint}]]
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
