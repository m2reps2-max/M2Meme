'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MemeScanner } = require('../lib/scanner');
const { createTelegramOutboxEntry } = require('../lib/telegram-outbox');

function make(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-radar-outbox-integration-'));
  return new MemeScanner({ dataFile: path.join(dir, 'store.json'), ...options });
}

function enqueue(scanner, { alertId = 'alert-1', chatId = '-1001234567890', message = 'Alerte de test' } = {}) {
  const mint = '8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump';
  const at = new Date().toISOString();
  const level = alertId;
  const resolvedAlertId = at + ':' + mint + ':' + level;
  scanner.state.tokens[mint] = {
    mint, name: 'Test Coin', symbol: 'TEST', priceUsd: 0.001,
    marketObservedAt: at, marketObservationSource: 'dexscreener'
  };
  scanner.state.alerts.push({
    mint, at, level, symbol: 'TEST',
    decisionSnapshot: {
      priceUsd: 0.001, marketObservedAt: at,
      marketObservationSource: 'dexscreener'
    }
  });
  scanner.state.telegramOutbox.push(createTelegramOutboxEntry({ alertId: resolvedAlertId, chatId, message }));
  scanner.state.telegramChannels = [{ chatId, label: 'Canal test', enabled: true, lastSentAt: null, lastError: null }];
}

test('Telegram outbox sends, removes and persists a delivered message', async () => {
  const scanner = make();
  const calls = [];
  scanner.bot = { api: { sendMessage: async (...args) => { calls.push(args); return { message_id: 42 }; } } };
  enqueue(scanner);

  const result = await scanner.drainTelegramOutbox();

  assert.deepEqual(result, { sent: 1, failed: 0, pending: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '-1001234567890');
  assert.equal(calls[0][1], 'Alerte de test');
  assert.equal(calls[0][2].parse_mode, 'HTML');
  assert.equal(scanner.state.telegramOutbox.length, 0);
  assert.equal(scanner.state.telegramPerformance.length, 1);
  assert.equal(scanner.state.telegramPerformance[0].basePriceUsd, 0.001);
  assert.equal(scanner.state.telegramPerformance[0].priceSource, 'dexscreener');
  assert.ok(scanner.state.telegramChannels[0].lastSentAt);
  assert.equal(scanner.state.telegramChannels[0].lastError, null);

  const restored = new MemeScanner({ dataFile: scanner.file });
  assert.equal(restored.state.telegramOutbox.length, 0);
});

test('makes the preview and its initial percentage available during the Telegram send request', async () => {
  const { findTelegramPreviewEntry, buildTelegramPreviewMetrics } = require('../lib/telegram-preview-image');
  const scanner = make({ telegramPreviewBaseUrl: 'https://m2meme.fadehost.app' });
  let previewId = null;
  scanner.bot = {
    api: {
      sendMessage: async (_chatId, message) => {
        const match = message.match(/telegram-preview\/([A-Za-z0-9_-]{20,40})/);
        assert.ok(match, 'the outgoing message must contain the preview URL');
        previewId = match[1];
        const seed = findTelegramPreviewEntry(
          scanner.state.telegramPerformance, scanner.telegramPreviewSeeds, previewId
        );
        assert.ok(seed, 'Telegram must be able to fetch the preview before sendMessage resolves');
        const metrics = buildTelegramPreviewMetrics(seed);
        assert.equal(metrics.currentReturn, null);
        assert.equal(metrics.currentState, 'en attente');
        return { message_id: 44 };
      }
    }
  };
  enqueue(scanner);

  const result = await scanner.drainTelegramOutbox();

  assert.deepEqual(result, { sent: 1, failed: 0, pending: 0 });
  assert.equal(scanner.state.telegramPerformance[0].previewId, previewId);
  assert.equal(scanner.telegramPreviewSeeds.size, 0,
    'the temporary seed is replaced by the persisted performance entry after delivery');
});

test('Telegram API failure is persisted as a retryable message and survives restart', async () => {
  const scanner = make();
  scanner.bot = { api: { sendMessage: async () => { throw new Error('429 Too Many Requests'); } } };
  enqueue(scanner);

  const result = await scanner.drainTelegramOutbox();

  assert.deepEqual(result, { sent: 0, failed: 1, pending: 1 });
  const pending = scanner.state.telegramOutbox[0];
  assert.equal(pending.status, 'queued');
  assert.equal(pending.attempts, 1);
  assert.match(pending.lastError, /429/);
  assert.ok(Date.parse(pending.nextAttemptAt) > Date.now());
  assert.match(scanner.state.telegramChannels[0].lastError, /429/);

  const restored = new MemeScanner({ dataFile: scanner.file });
  assert.equal(restored.state.telegramOutbox.length, 1);
  assert.equal(restored.state.telegramOutbox[0].status, 'queued');
  assert.equal(restored.state.telegramOutbox[0].lastError, '429 Too Many Requests');
  assert.equal(restored.state.telegramOutbox[0].id, pending.id);
});

test('outbox does not contact Telegram if claiming the message cannot be persisted', async () => {
  const scanner = make();
  let calls = 0;
  scanner.bot = { api: { sendMessage: async () => { calls++; } } };
  enqueue(scanner);
  scanner.save = () => { throw new Error('disk unavailable'); };

  const result = await scanner.drainTelegramOutbox();

  assert.equal(calls, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.pending, 1);
  assert.equal(scanner.state.telegramOutbox[0].status, 'queued');
  assert.equal(scanner.state.telegramOutbox[0].attempts, 0);
  assert.match(result.error, /disk unavailable/);
});

test('delivers Phantom button as Telegram inline keyboard and persists it on retry',async()=>{
  const scanner=make();
  const mint='8TbnsLM72WoHKmVyDqRqEkEuNRGFgA4zbRXQYv6Gpump';
  const replyMarkup={inline_keyboard:[[{text:'👻 Acheter sur Phantom',url:'https://phantom.com/tokens/solana/'+mint}]]};
  const calls=[];
  scanner.bot={api:{sendMessage:async(...args)=>{calls.push(args);return {message_id:43};}}};
  enqueue(scanner,{alertId:'phantom',message:'Nouveau token'});
  scanner.state.telegramOutbox[0].replyMarkup=replyMarkup;
  const result=await scanner.drainTelegramOutbox();
  assert.equal(result.sent,1);
  assert.deepEqual(calls[0][2].reply_markup,replyMarkup);
  assert.equal(calls[0][2].parse_mode, 'HTML');
});
