'use strict';

const WebSocket = require('ws');

const ENDPOINT = 'wss://pumpportal.fun/api/data';
const MAX_BACKOFF_MS = 60000;

class LaunchStream {
  constructor({ onToken, onMigration, WebSocketImpl = WebSocket } = {}) {
    this.onToken = typeof onToken === 'function' ? onToken : () => {};
    this.onMigration = typeof onMigration === 'function' ? onMigration : () => {};
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.timer = null;
    this.stopped = true;
    this.retry = 0;
    this.connectedAt = null;
    this.lastMessageAt = null;
    this.lastError = null;
    this.received = 0;
  }

  status() {
    return {
      configured: true,
      connected: Boolean(this.socket && this.socket.readyState === this.WebSocketImpl.OPEN),
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
      received: this.received,
      mode: 'PumpPortal · créations et migrations gratuites'
    };
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped || this.socket) return;
    let socket;
    try {
      socket = new this.WebSocketImpl(ENDPOINT, { handshakeTimeout: 10000, perMessageDeflate: false });
      this.socket = socket;
    } catch (error) {
      this.lastError = String(error.message || error).slice(0, 180);
      this.scheduleReconnect();
      return;
    }

    socket.on('open', () => {
      if (this.stopped || this.socket !== socket) return socket.close();
      this.retry = 0;
      this.connectedAt = new Date().toISOString();
      this.lastError = null;
      socket.send(JSON.stringify({ method: 'subscribeNewToken' }));
      socket.send(JSON.stringify({ method: 'subscribeMigration' }));
    });

    socket.on('message', raw => {
      this.lastMessageAt = new Date().toISOString();
      this.received += 1;
      let event;
      try { event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
      catch { return; }
      if (!event || typeof event !== 'object') return;
      const type = String(event.txType || event.type || event.event || '').toLowerCase();
      try {
        if (type === 'create' || event.signature && (event.mint || event.tokenAddress) && (event.uri || event.name)) {
          this.onToken(event);
        } else if (type === 'migrate' || type === 'migration' || event.pool && (event.mint || event.tokenAddress)) {
          this.onMigration(event);
        }
      } catch (error) {
        this.lastError = String(error.message || error).slice(0, 180);
      }
    });

    socket.on('error', error => {
      this.lastError = String(error.message || error).slice(0, 180);
    });

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.connectedAt = null;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.timer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 2000 * (2 ** Math.min(this.retry++, 5)));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners('close');
      socket.close();
    }
  }
}

module.exports = { LaunchStream };
