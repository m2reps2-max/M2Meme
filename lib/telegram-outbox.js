'use strict';

const MAX_ATTEMPTS = 8;
const BASE_RETRY_MS = 15000;
const MAX_RETRY_MS = 60 * 60 * 1000;

function normalizeTelegramOutbox(input) {
  if (!Array.isArray(input)) return [];
  const entries = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '');
    const chatId = String(raw.chatId || '').trim();
    const message = typeof raw.message === 'string' ? raw.message : '';
    if (!id || !chatId || !message || seen.has(id)) continue;
    const attempts = Math.max(0, Math.min(MAX_ATTEMPTS, Math.floor(Number(raw.attempts) || 0)));
    const status = raw.status === 'dead' ? 'dead' : 'queued';
    seen.add(id);
    entries.push({
      id,
      alertId: String(raw.alertId || ''),
      chatId,
      message: message.slice(0, 4096),
      status,
      attempts,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
      nextAttemptAt: typeof raw.nextAttemptAt === 'string' ? raw.nextAttemptAt : null,
      lastAttemptAt: typeof raw.lastAttemptAt === 'string' ? raw.lastAttemptAt : null,
      lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 180) : null
    });
  }
  return entries;
}

function createTelegramOutboxEntry({ alertId, chatId, message, now = new Date().toISOString() }) {
  const destination = String(chatId || '').trim();
  const text = String(message || '');
  if (!alertId || !destination || !text) throw new Error('Alerte Telegram incomplète.');
  return {
    id: String(alertId) + ':' + destination,
    alertId: String(alertId),
    chatId: destination,
    message: text.slice(0, 4096),
    status: 'queued',
    attempts: 0,
    createdAt: now,
    nextAttemptAt: now,
    lastAttemptAt: null,
    lastError: null
  };
}

function retryDelay(attempts) {
  const exponent = Math.max(0, Math.min(12, Number(attempts) - 1));
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** exponent));
}

function claimDueTelegramOutbox(entries, now = Date.now(), limit = 10) {
  const due = [];
  for (const entry of entries) {
    if (due.length >= limit) break;
    if (entry.status !== 'queued' || entry.attempts >= MAX_ATTEMPTS) continue;
    const nextAt = entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : 0;
    if (Number.isFinite(nextAt) && nextAt > now) continue;
    entry.status = 'sending';
    entry.attempts += 1;
    entry.lastAttemptAt = new Date(now).toISOString();
    due.push(entry);
  }
  return due;
}

function markTelegramOutboxSent(entries, id) {
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return false;
  entries.splice(index, 1);
  return true;
}

function markTelegramOutboxFailed(entry, error, now = Date.now()) {
  const message = String(error?.message || error || 'Erreur Telegram').slice(0, 180);
  entry.lastError = message;
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.status = 'dead';
    entry.nextAttemptAt = null;
    return entry;
  }
  entry.status = 'queued';
  entry.nextAttemptAt = new Date(now + retryDelay(entry.attempts)).toISOString();
  return entry;
}

module.exports = {
  MAX_ATTEMPTS,
  normalizeTelegramOutbox,
  createTelegramOutboxEntry,
  retryDelay,
  claimDueTelegramOutbox,
  markTelegramOutboxSent,
  markTelegramOutboxFailed
};
