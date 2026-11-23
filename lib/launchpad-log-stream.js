'use strict';

const WebSocket = require('ws');
const { LAUNCHPADS } = require('./launchpad-discovery');

const INITIALIZE_LOG = /Instruction:\s*(?:Initialize|InitializeV2|InitializeWithToken2022|InitializeVirtualPoolWithSplToken|InitializeVirtualPoolWithToken2022)\b/i;

function buildWebSocketEndpoints(endpoints = []) {
  const result = [];
  for (const value of endpoints) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    let url;
    try {
      url = new URL(raw);
      if (url.protocol === 'https:') url.protocol = 'wss:';
      else if (url.protocol === 'http:') url.protocol = 'ws:';
      else if (url.protocol !== 'wss:' && url.protocol !== 'ws:') continue;
      if (url.hostname === 'api.mainnet.solana.com') url.hostname = 'api.mainnet-beta.solana.com';
      result.push(url.toString());
    } catch {}
  }
  return [...new Set(result)];
}

class LaunchpadLogStream {
  constructor({ endpoints = [], onSignature, WebSocketImpl = WebSocket } = {}) {
    this.endpoints = buildWebSocketEndpoints(endpoints);
    this.onSignature = typeof onSignature === 'function' ? onSignature : () => {};
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.timer = null;
    this.stopped = true;
    this.retry = 0;
    this.endpointIndex = 0;
    this.connectedAt = null;
    this.lastMessageAt = null;
    this.lastError = null;
    this.received = 0;
    this.matched = 0;
    this.requestPrograms = new Map();
    this.subscriptions = new Map();
  }

  status() {
    const socket = this.socket;
    return {
      configured: this.endpoints.length > 0,
      socketConnected: Boolean(socket && socket.readyState === this.WebSocketImpl.OPEN),
      connected: Boolean(socket && socket.readyState === this.WebSocketImpl.OPEN && this.subscriptions.size === LAUNCHPADS.length),
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
      received: this.received,
      matched: this.matched,
      subscriptions: this.subscriptions.size,
      programsMonitored: LAUNCHPADS.length,
      endpoint: this.currentEndpoint ? new URL(this.currentEndpoint).host : null,
      mode: 'Solana RPC logsSubscribe · événements de création uniquement'
    };
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    if (!this.endpoints.length) {
      this.lastError = 'Aucun endpoint WebSocket RPC disponible';
      return;
    }
    this.connect();
  }

  connect() {
    if (this.stopped || this.socket || !this.endpoints.length) return;
    const endpoint = this.endpoints[this.endpointIndex % this.endpoints.length];
    this.currentEndpoint = endpoint;
    let socket;
    try {
      socket = new this.WebSocketImpl(endpoint, {
        handshakeTimeout: 10000,
        perMessageDeflate: false,
        maxPayload: 1024 * 1024
      });
      this.socket = socket;
    } catch (error) {
      this.lastError = String(error.message || error).slice(0, 180);
      this.rotateEndpoint();
      this.scheduleReconnect();
      return;
    }

    socket.on('open', () => {
      if (this.stopped || this.socket !== socket) return socket.close();
      this.retry = 0;
      this.connectedAt = new Date().toISOString();
      this.lastError = null;
      this.requestPrograms.clear();
      this.subscriptions.clear();
      LAUNCHPADS.forEach((launchpad, index) => {
        const id = index + 1;
        this.requestPrograms.set(id, launchpad);
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'logsSubscribe',
          params: [{ mentions: [launchpad.programId] }, { commitment: 'confirmed' }]
        }));
      });
    });

    socket.on('message', raw => {
      this.lastMessageAt = new Date().toISOString();
      this.received++;
      let payload;
      try { payload = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
      catch { return; }
      if (!payload || typeof payload !== 'object') return;

      if (Number.isInteger(payload.id) && this.requestPrograms.has(payload.id)) {
        const launchpad = this.requestPrograms.get(payload.id);
        if (payload.error) {
          this.lastError = String(payload.error.message || 'Échec logsSubscribe').slice(0, 180);
          socket.close();
          return;
        }
        if (Number.isInteger(payload.result)) this.subscriptions.set(payload.result, launchpad);
        return;
      }

      if (payload.method !== 'logsNotification') return;
      const params = payload.params || {};
      const launchpad = this.subscriptions.get(params.subscription);
      const value = params.result?.value;
      if (!launchpad || !value || value.err || !Array.isArray(value.logs)) return;
      if (!value.logs.some(line => INITIALIZE_LOG.test(String(line)))) return;
      const signature = String(value.signature || '');
      if (!signature) return;
      this.matched++;
      try {
        this.onSignature({
          launchpadId: launchpad.id,
          programId: launchpad.programId,
          signature: signature.slice(0, 120),
          slot: Number.isFinite(Number(params.result?.context?.slot)) ? Number(params.result.context.slot) : null,
          observedAt: new Date().toISOString()
        });
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
      this.subscriptions.clear();
      this.requestPrograms.clear();
      if (!this.stopped) {
        this.rotateEndpoint();
        this.scheduleReconnect();
      }
    });
  }

  rotateEndpoint() {
    if (this.endpoints.length > 1) this.endpointIndex = (this.endpointIndex + 1) % this.endpoints.length;
  }

  scheduleReconnect() {
    if (this.stopped || this.timer) return;
    const delay = Math.min(60000, 2000 * (2 ** Math.min(this.retry++, 5)));
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
    this.subscriptions.clear();
    this.requestPrograms.clear();
    if (socket) {
      socket.removeAllListeners('close');
      socket.close();
    }
  }
}

module.exports = { LaunchpadLogStream, buildWebSocketEndpoints, INITIALIZE_LOG };
