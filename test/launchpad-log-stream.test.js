'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LaunchpadLogStream, buildWebSocketEndpoints } = require('../lib/launchpad-log-stream');
const { LAUNCHPADS } = require('../lib/launchpad-discovery');

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close'); }
  open() { this.readyState = FakeWebSocket.OPEN; this.emit('open'); }
  message(value) { this.emit('message', JSON.stringify(value)); }
}
function reset() { FakeWebSocket.instances = []; }

test('converts configured HTTP RPC endpoints into deduplicated WebSocket endpoints', () => {
  assert.deepEqual(buildWebSocketEndpoints([
    'https://api.mainnet.solana.com',
    'https://api.mainnet.solana.com',
    'https://rpc.example.test/?api-key=abc',
    'http://localhost:8899'
  ]), [
    'wss://api.mainnet-beta.solana.com/',
    'wss://rpc.example.test/?api-key=abc',
    'ws://localhost:8899/'
  ]);
});

test('subscribes to both launchpad programs and queues only initialize log notifications', () => {
  reset();
  const found = [];
  const stream = new LaunchpadLogStream({
    endpoints: ['https://rpc.example.test'],
    WebSocketImpl: FakeWebSocket,
    onSignature: event => found.push(event)
  });
  stream.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.equal(socket.sent.length, 2);
  assert.equal(socket.sent[0].method, 'logsSubscribe');
  assert.deepEqual(socket.sent[0].params[0].mentions, [LAUNCHPADS[0].programId]);
  assert.deepEqual(socket.sent[1].params[0].mentions, [LAUNCHPADS[1].programId]);
  socket.message({ jsonrpc: '2.0', id: 1, result: 11 });
  socket.message({ jsonrpc: '2.0', id: 2, result: 22 });

  socket.message({
    jsonrpc: '2.0',
    method: 'logsNotification',
    params: { subscription: 11, result: { context: { slot: 100 }, value: { signature: 'trade-signature', err: null, logs: ['Program log: Instruction: Buy'] } } }
  });
  socket.message({
    jsonrpc: '2.0',
    method: 'logsNotification',
    params: { subscription: 22, result: { context: { slot: 101 }, value: { signature: 'failed-launch', err: { InstructionError: [0, 'failed'] }, logs: ['Program log: Instruction: InitializeVirtualPoolWithSplToken'] } } }
  });
  socket.message({
    jsonrpc: '2.0',
    method: 'logsNotification',
    params: { subscription: 22, result: { context: { slot: 102 }, value: { signature: 'meteora-launch', err: null, logs: ['Program log: Instruction: InitializeVirtualPoolWithSplToken'] } } }
  });
  socket.message({
    jsonrpc: '2.0',
    method: 'logsNotification',
    params: { subscription: 11, result: { context: { slot: 103 }, value: { signature: 'raydium-launch', err: null, logs: ['Program log: Instruction: InitializeWithToken2022'] } } }
  });

  assert.deepEqual(found.map(row => [row.launchpadId, row.signature, row.slot]), [
    ['meteora-dbc', 'meteora-launch', 102],
    ['raydium-launchlab', 'raydium-launch', 103]
  ]);
  assert.equal(stream.status().matched, 2);
  assert.equal(stream.status().subscriptions, 2);
  stream.stop();
});

test('reports unavailable configuration without throwing', () => {
  const stream = new LaunchpadLogStream({ endpoints: [], WebSocketImpl: FakeWebSocket });
  stream.start();
  assert.equal(stream.status().configured, false);
  assert.equal(stream.status().connected, false);
  assert.match(stream.status().lastError, /endpoint WebSocket/);
  stream.stop();
});
