'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_ATTEMPTS, normalizeTelegramOutbox, createTelegramOutboxEntry,
  retryDelay, claimDueTelegramOutbox, markTelegramOutboxSent,
  markTelegramOutboxFailed
} = require('../lib/telegram-outbox');

test('creates one stable outbox entry per alert and Telegram destination', () => {
  const input = { alertId: '2026-11-23T12:00:00.000Z:Mint:opportunity', chatId: '-1001234567890', message: 'Hello', now: '2026-11-23T12:00:00.000Z' };
  const first = createTelegramOutboxEntry(input);
  const second = createTelegramOutboxEntry(input);
  assert.equal(first.id, second.id);
  assert.equal(first.status, 'queued');
  assert.equal(first.attempts, 0);
});

test('restores an interrupted sending attempt as queued after restart', () => {
  const rows = normalizeTelegramOutbox([{
    id: 'a:chat', alertId: 'a', chatId: 'chat', message: 'Hello',
    status: 'sending', attempts: 1, createdAt: '2026-11-23T12:00:00.000Z'
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'queued');
  assert.equal(rows[0].attempts, 1);
});

test('recovers the final interrupted attempt without exhausting the retry budget', () => {
  const rows = normalizeTelegramOutbox([{
    id: 'last:chat', alertId: 'last', chatId: 'chat', message: 'Hello',
    status: 'sending', attempts: MAX_ATTEMPTS, createdAt: '2026-11-23T12:00:00.000Z'
  }]);
  assert.equal(rows[0].attempts, MAX_ATTEMPTS - 1);
  const claimed = claimDueTelegramOutbox(rows, Date.now(), 1);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].attempts, MAX_ATTEMPTS);
});

test('claims only due messages and increments attempts before network delivery', () => {
  const rows = [
    createTelegramOutboxEntry({ alertId: 'due', chatId: 'chat', message: 'now', now: '2026-11-23T12:00:00.000Z' }),
    createTelegramOutboxEntry({ alertId: 'later', chatId: 'chat', message: 'later', now: '2026-11-23T12:10:00.000Z' })
  ];
  const claimed = claimDueTelegramOutbox(rows, Date.parse('2026-11-23T12:05:00.000Z'), 1);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, 'due:chat');
  assert.equal(claimed[0].attempts, 1);
  assert.equal(claimed[0].status, 'sending');
});

test('uses bounded exponential retry delays', () => {
  assert.equal(retryDelay(1), 15000);
  assert.equal(retryDelay(2), 30000);
  assert.equal(retryDelay(20), 60 * 60 * 1000);
});

test('requeues transient failures and permanently stops after the retry budget', () => {
  const entry = createTelegramOutboxEntry({ alertId: 'a', chatId: 'chat', message: 'Hello' });
  entry.attempts = 2;
  markTelegramOutboxFailed(entry, new Error('429 Too Many Requests'), 1000);
  assert.equal(entry.status, 'queued');
  assert.equal(entry.lastError, '429 Too Many Requests');
  assert.equal(Date.parse(entry.nextAttemptAt), 1000 + 30000);
  entry.attempts = MAX_ATTEMPTS;
  markTelegramOutboxFailed(entry, 'Forbidden', 2000);
  assert.equal(entry.status, 'dead');
  assert.equal(entry.nextAttemptAt, null);
});

test('removes a delivered entry and leaves other destinations untouched', () => {
  const rows = [
    createTelegramOutboxEntry({ alertId: 'a', chatId: 'one', message: 'Hello' }),
    createTelegramOutboxEntry({ alertId: 'a', chatId: 'two', message: 'Hello' })
  ];
  assert.equal(markTelegramOutboxSent(rows, 'a:one'), true);
  assert.deepEqual(rows.map(row => row.chatId), ['two']);
  assert.equal(markTelegramOutboxSent(rows, 'missing'), false);
});

test('normalizes malformed and duplicate persisted rows safely', () => {
  const rows = normalizeTelegramOutbox([
    null,
    { id: 'x', chatId: 'c', message: 'first', attempts: -5 },
    { id: 'x', chatId: 'c', message: 'duplicate' },
    { id: 'bad', chatId: '', message: 'invalid' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].message, 'first');
  assert.equal(rows[0].attempts, 0);
});
