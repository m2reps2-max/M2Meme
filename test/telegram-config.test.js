'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTelegramToken } = require('../lib/telegram-config');

test('prefers TELEGRAM_BOT_TOKEN', () => {
  assert.equal(resolveTelegramToken({ TELEGRAM_BOT_TOKEN: ' preferred-token ', BOT_TOKEN: 'legacy-token' }), 'preferred-token');
});

test('falls back to the existing BOT_TOKEN variable', () => {
  assert.equal(resolveTelegramToken({ BOT_TOKEN: ' legacy-token ' }), 'legacy-token');
});

test('returns an empty string when Telegram is not configured', () => {
  assert.equal(resolveTelegramToken({ TELEGRAM_BOT_TOKEN: '  ', BOT_TOKEN: '' }), '');
});
