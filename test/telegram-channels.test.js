'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validChatId, normalizeTelegramChannels, addTelegramChannel,
  updateTelegramChannel, removeTelegramChannel, scoreVerdict, formatTelegramAlert
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
