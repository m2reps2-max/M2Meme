'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { Bot, InlineKeyboard } = require('grammy');

const PORT = Number(process.env.PORT || 3000);
const ACCESS_CODE = String(process.env.DASHBOARD_ACCESS_CODE || '');
const SESSION_SECRET = String(process.env.DASHBOARD_SESSION_SECRET || '');
const DASHBOARD_URL = String(process.env.DASHBOARD_URL || '').replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'meme_radar_session';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60 * 1000;

if (!ACCESS_CODE || ACCESS_CODE.length < 12) {
  console.error('Configuration error: DASHBOARD_ACCESS_CODE must contain at least 12 characters.');
  process.exit(1);
}
if (SESSION_SECRET.length < 32) {
  console.error('Configuration error: DASHBOARD_SESSION_SECRET must contain at least 32 characters.');
  process.exit(1);
}
if (IS_PROD && (!DASHBOARD_URL.startsWith('https://'))) {
  console.error('Configuration error: DASHBOARD_URL must use HTTPS in production.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: IS_PROD ? [] : null
}}}));
app.use(express.json({ limit: '12kb' }));
app.use(cookieParser());

const failures = new Map();
function ipKey(req) { return String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 100); }
function rateLimitLogin(req, res, next) {
  const now = Date.now(), key = ipKey(req);
  const entry = failures.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (entry.resetAt <= now) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  if (entry.count >= 8) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans quelques minutes.' });
  req.loginFailure = () => { entry.count += 1; failures.set(key, entry); };
  req.loginSuccess = () => failures.delete(key);
  next();
}
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function codeFingerprint() {
  return crypto.createHash('sha256').update(ACCESS_CODE).digest('hex');
}
function createSession() {
  const payload = Buffer.from(JSON.stringify({ v: 1, code: codeFingerprint(), iat: Date.now(), nonce: crypto.randomBytes(12).toString('hex') })).toString('base64url');
  return payload + '.' + sign(payload);
}
function validSession(token) {
  if (typeof token !== 'string' || token.length > 2048) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot), signature = token.slice(dot + 1);
  if (!safeEqual(sign(payload), signature)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.v === 1 && data.code === codeFingerprint() && Number.isFinite(data.iat) && data.iat <= Date.now() + 60000;
  } catch { return false; }
}
function setSession(res) {
  res.cookie(COOKIE, createSession(), { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path: '/', maxAge: TEN_YEARS });
}
function requireAuth(req, res, next) {
  if (!validSession(req.cookies[COOKIE])) return res.status(401).json({ error: 'Authentification requise.' });
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'meme-radar', timestamp: new Date().toISOString() }));
app.post('/api/login', rateLimitLogin, (req, res) => {
  const supplied = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!safeEqual(supplied, ACCESS_CODE)) {
    req.loginFailure();
    return res.status(401).json({ error: 'Code incorrect.' });
  }
  req.loginSuccess();
  setSession(res);
  res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => {
  res.clearCookie(COOKIE, { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});
app.get('/api/me', requireAuth, (_req, res) => res.json({ ok: true, authenticated: true }));
app.get('/api/status', requireAuth, (_req, res) => res.json({
  ok: true,
  scanner: { connected: false, status: 'not_configured', message: 'Aucune source blockchain connectée.' },
  modules: { liveScanner: false, smartMoney: false, securityChecks: false, socialIntelligence: false, alerts: false }
}));
app.use('/assets', express.static(path.join(__dirname, 'public'), { index: false, maxAge: IS_PROD ? '1h' : 0 }));
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/', (req, res) => {
  if (!validSession(req.cookies[COOKIE])) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.use((err, _req, res, _next) => {
  console.error('Request error:', err.message);
  res.status(500).json({ error: 'Erreur interne.' });
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`MEME RADAR listening on :${PORT}`));
server.requestTimeout = 15000;
server.headersTimeout = 20000;
server.keepAliveTimeout = 5000;

if (process.env.BOT_TOKEN) {
  const bot = new Bot(process.env.BOT_TOKEN);
  const keyboard = () => new InlineKeyboard().url('Ouvrir MEME RADAR', DASHBOARD_URL || 'https://example.com');
  bot.command('start', async ctx => ctx.reply('Bienvenue sur MEME RADAR. Accède au tableau de bord privé ci-dessous.', { reply_markup: keyboard() }));
  bot.command('dashboard', async ctx => ctx.reply('Voici ton accès au tableau de bord :', { reply_markup: keyboard() }));
  bot.command('help', async ctx => ctx.reply('Commandes disponibles : /start, /dashboard, /help'));
  bot.catch(err => console.error('Telegram bot error:', err.message));
  bot.start().catch(err => console.error('Telegram polling error:', err.message));
}
