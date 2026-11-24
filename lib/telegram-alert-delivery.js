'use strict';

const { createTelegramOutboxEntry } = require('./telegram-outbox');

function alertDeliveryId(alert) {
  if (!alert?.at || !alert?.mint || !alert?.level) return null;
  return String(alert.at) + ':' + String(alert.mint) + ':' + String(alert.level);
}

function queueAlertForChannels({ alert, channels, outbox, message, replyMarkup = null, now = new Date().toISOString() }) {
  const alertId = alertDeliveryId(alert);
  if (!alertId || !Array.isArray(channels) || !Array.isArray(outbox) || !message) return 0;
  const sentTo = Array.isArray(alert.telegramSentTo) ? alert.telegramSentTo : null;
  const queuedTo = new Set(outbox.filter(entry => entry?.alertId === alertId && entry.status !== 'dead').map(entry => String(entry.chatId)));
  let queued = 0;
  for (const channel of channels) {
    if (!channel?.enabled) continue;
    const chatId = String(channel.chatId || '').trim();
    if (!chatId || sentTo?.includes(chatId) || queuedTo.has(chatId)) continue;
    // Legacy alerts predate per-channel delivery tracking. If the channel has
    // sent something after this alert was created, avoid replaying old history.
    if (sentTo === null && channel.lastSentAt && Date.parse(channel.lastSentAt) >= Date.parse(alert.at)) continue;
    const entry = createTelegramOutboxEntry({ alertId, chatId, message, replyMarkup, now });
    if (outbox.some(row => row?.id === entry.id)) continue;
    outbox.push(entry);
    queuedTo.add(chatId);
    queued++;
  }
  return queued;
}

function markAlertDelivered(alerts, alertId, chatId) {
  if (!Array.isArray(alerts) || !alertId || !chatId) return false;
  const alert = alerts.find(row => alertDeliveryId(row) === alertId);
  if (!alert) return false;
  if (!Array.isArray(alert.telegramSentTo)) alert.telegramSentTo = [];
  const destination = String(chatId);
  if (!alert.telegramSentTo.includes(destination)) alert.telegramSentTo.push(destination);
  return true;
}

module.exports = { alertDeliveryId, queueAlertForChannels, markAlertDelivered };
