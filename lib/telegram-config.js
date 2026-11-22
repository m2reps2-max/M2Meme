'use strict';

function resolveTelegramToken(env = process.env) {
  const preferred = typeof env.TELEGRAM_BOT_TOKEN === 'string' ? env.TELEGRAM_BOT_TOKEN.trim() : '';
  const legacy = typeof env.BOT_TOKEN === 'string' ? env.BOT_TOKEN.trim() : '';
  return preferred || legacy;
}

module.exports = { resolveTelegramToken };
