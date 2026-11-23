'use strict';

const path = require('node:path');
const { Bot } = require('grammy');
const { MemeScanner } = require('./lib/scanner');
const { resolveTelegramToken } = require('./lib/telegram-config');

const dataDir = path.resolve(process.env.MEME_RADAR_WORKER_DATA_DIR || path.join(__dirname, 'data'));
const dataFile = path.join(dataDir, 'worker-store.json');
const token = resolveTelegramToken(process.env);
const bot = token ? new Bot(token) : null;

if (!token) {
  console.warn('[worker] Telegram désactivé : configure TELEGRAM_BOT_TOKEN (ou BOT_TOKEN).');
}

const scanner = new MemeScanner({
  dataFile,
  bot,
  telegramChatId: process.env.TELEGRAM_CHAT_ID
});

let stopping = false;
let memoryTimer = null;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log('[worker] arrêt demandé', signal);
  if (memoryTimer) clearInterval(memoryTimer);
  scanner.stop();
  try {
    scanner.flushScheduledSave();
  } catch (error) {
    console.error('[worker] sauvegarde finale impossible :', error.message);
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error('[worker] exception non interceptée', { origin, message: error?.message });
});

memoryTimer = setInterval(() => {
  const usage = process.memoryUsage();
  console.log('[worker] mémoire', {
    rssMiB: Math.round(usage.rss / 1048576),
    heapUsedMiB: Math.round(usage.heapUsed / 1048576),
    externalMiB: Math.round(usage.external / 1048576),
    uptimeSeconds: Math.round(process.uptime())
  });
}, 60000);
memoryTimer.unref();

console.log('[worker] démarrage du moteur MEME RADAR', {
  dataFile,
  telegramConfigured: Boolean(bot),
  telegramPolling: false
});

scanner.start().catch(async error => {
  console.error('[worker] démarrage du scanner impossible :', error);
  await shutdown('startup_error');
  process.exitCode = 1;
});
