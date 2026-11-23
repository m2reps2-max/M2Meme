'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LAUNCHPADS,
  decodeBase58,
  parseLaunchpadTransaction,
  enqueueLaunchpadSignature,
  processPendingLaunchpadTransactions
} = require('../lib/launchpad-discovery');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encodeBase58(bytes) {
  let value = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let out = '';
  while (value > 0n) { const remainder = Number(value % 58n); out = ALPHABET[remainder] + out; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = '1' + out; }
  return out || '1';
}
function txFor({ programId, discriminator, accounts, signature = 'signature-1', name = 'Early Token', symbol = 'EARLY' }) {
  return {
    slot: 123,
    blockTime: 1795000000,
    meta: { err: null, innerInstructions: [] },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [],
        instructions: [
          { programId, accounts, data: encodeBase58(Buffer.from(discriminator, 'hex')) },
          { programId: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', parsed: { type: 'initializeTokenMetadata', info: { name, symbol } } }
        ]
      }
    }
  };
}
const mint = 'Abcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
const creator = 'Bcdefghijkmnopqrstuvwxyz123456789ABCDEFGH';
const launchLab = LAUNCHPADS.find(row => row.id === 'raydium-launchlab');
const meteora = LAUNCHPADS.find(row => row.id === 'meteora-dbc');

test('decodes base58 instruction data including leading zero bytes', () => {
  assert.deepEqual(decodeBase58(encodeBase58(Buffer.from([0, 0, 1, 2, 3]))), Buffer.from([0, 0, 1, 2, 3]));
});

test('detects Raydium LaunchLab creation from its verified initialize discriminator', () => {
  const accounts = ['payer', creator, 'global', 'FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1', 'authority', 'pool', mint, 'quote'];
  const tx = txFor({ programId: launchLab.programId, discriminator: 'afaf6d1f0d989bed', accounts });
  const result = parseLaunchpadTransaction(tx, { signature: 'launch-signature' });
  assert.equal(result.mint, mint);
  assert.equal(result.creator, creator);
  assert.equal(result.launchpadId, 'letsbonk');
  assert.equal(result.launchpadName, 'LetsBonk');
  assert.equal(result.name, 'Early Token');
  assert.equal(result.symbol, 'EARLY');
  assert.equal(result.signature, 'launch-signature');
});

test('detects Meteora DBC and labels the Moonshot partner config', () => {
  const accounts = ['FbKf76ucsQssF7XZBuzScdJfugtsSKwZFYztKsMEhWZM', 'authority', creator, mint, 'quote', 'pool'];
  const tx = txFor({ programId: meteora.programId, discriminator: '8c55d7b06636684f', accounts });
  const result = parseLaunchpadTransaction(tx);
  assert.equal(result.launchpadId, 'moonshot');
  assert.equal(result.launchpadName, 'Moonshot');
  assert.equal(result.mint, mint);
  assert.equal(result.creator, creator);
});

test('identifies partner frontends sharing the same Meteora and LaunchLab programs', () => {
  const dbc = txFor({ programId: meteora.programId, discriminator: '8c55d7b06636684f', accounts: ['GKDMxu34q8MWqqj2mVVV3pEw2zkFC7LxYjvPXNjBQLMi', 'authority', creator, mint, 'quote', 'pool'] });
  assert.equal(parseLaunchpadTransaction(dbc).launchpadId, 'bags');
  const launchLabTx = txFor({ programId: launchLab.programId, discriminator: 'afaf6d1f0d989bed', accounts: ['payer', creator, 'global', '6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt', 'authority', 'pool', mint, 'quote'] });
  assert.equal(parseLaunchpadTransaction(launchLabTx).launchpadId, 'stonkfun');
});

test('recognizes every verified LaunchLab and Meteora DBC initialize variant', () => {
  for (const discriminator of ['afaf6d1f0d989bed', '4399af27da102620', '25be7ede2c9aab11']) {
    const result = parseLaunchpadTransaction(txFor({
      programId: launchLab.programId,
      discriminator,
      accounts: ['payer', creator, 'global', '4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4', 'authority', 'pool', mint, 'quote']
    }));
    assert.equal(result.mint, mint);
    assert.equal(result.launchpadId, 'raydium-launchlab');
  }
  for (const discriminator of ['8c55d7b06636684f', 'a976334e916edc9b']) {
    const result = parseLaunchpadTransaction(txFor({
      programId: meteora.programId,
      discriminator,
      accounts: ['config', 'authority', creator, mint, 'quote', 'pool']
    }));
    assert.equal(result.mint, mint);
    assert.equal(result.launchpadId, 'meteora-dbc');
  }
});

test('ignores non-launch instructions, failed transactions and invalid mint accounts', () => {
  const accounts = ['payer', creator, 'global', 'config', 'authority', 'pool', mint, 'quote'];
  const wrong = txFor({ programId: launchLab.programId, discriminator: '0000000000000000', accounts });
  assert.equal(parseLaunchpadTransaction(wrong), null);
  assert.equal(parseLaunchpadTransaction({ ...wrong, meta: { err: { InstructionError: [0, 'failed'] } } }), null);
  const invalid = txFor({ programId: launchLab.programId, discriminator: 'afaf6d1f0d989bed', accounts: ['payer', creator, 'global', 'config', 'authority', 'pool', 'not-a-mint', 'quote'] });
  assert.equal(parseLaunchpadTransaction(invalid), null);
});

test('queues only recognized launch signatures and deduplicates reconnect notifications', () => {
  const state = {};
  const event = { launchpadId: 'raydium-launchlab', signature: 'signature-a', slot: 123 };
  assert.equal(enqueueLaunchpadSignature(state, event).queued, true);
  assert.equal(enqueueLaunchpadSignature(state, event).reason, 'duplicate');
  assert.equal(enqueueLaunchpadSignature(state, { ...event, launchpadId: 'unknown' }).reason, 'invalid_event');
  assert.equal(state.launchpadDiscovery.pending['raydium-launchlab'].length, 1);
});

test('bounds the pending signature queue and records a gap when it overflows', () => {
  const state = {};
  for (let i = 0; i < 4; i++) enqueueLaunchpadSignature(state, { launchpadId: 'raydium-launchlab', signature: 'sig-' + i }, { maxPending: 3 });
  assert.deepEqual(state.launchpadDiscovery.pending['raydium-launchlab'].map(row => row.signature), ['sig-1', 'sig-2', 'sig-3']);
  assert.equal(state.launchpadDiscovery.metrics.gaps, 1);
});

test('processes only queued launch signatures and records successful token creation', async () => {
  const state = {};
  const event = { launchpadId: 'raydium-launchlab', signature: 'launch-signature', slot: 123 };
  enqueueLaunchpadSignature(state, event);
  const launch = txFor({
    programId: launchLab.programId,
    discriminator: 'afaf6d1f0d989bed',
    accounts: ['payer', creator, 'global', 'config', 'authority', 'pool', mint, 'quote'],
    signature: event.signature
  });
  const calls = [];
  const rpc = async (method, params) => {
    calls.push([method, params[0]]);
    assert.equal(method, 'getTransaction');
    return launch;
  };
  const found = [];
  const result = await processPendingLaunchpadTransactions(state, rpc, row => found.push(row), { now: 1000 });
  assert.equal(calls.length, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.launches, 1);
  assert.equal(found[0].mint, mint);
  assert.equal(state.launchpadDiscovery.metrics.launches, 1);
  assert.equal(state.launchpadDiscovery.pending['raydium-launchlab'].length, 0);
  assert.equal(enqueueLaunchpadSignature(state, event).reason, 'duplicate');
});

test('keeps a launch queued when ingestion fails and retries it on the next scan', async () => {
  const state = {};
  const event = { launchpadId: 'raydium-launchlab', signature: 'retry-signature', slot: 123 };
  enqueueLaunchpadSignature(state, event);
  const launch = txFor({
    programId: launchLab.programId,
    discriminator: 'afaf6d1f0d989bed',
    accounts: ['payer', creator, 'global', 'config', 'authority', 'pool', mint, 'quote'],
    signature: event.signature
  });
  const rpc = async () => launch;
  const failed = await processPendingLaunchpadTransactions(state, rpc, () => { throw new Error('temporary persistence failure'); }, { now: 1000 });
  assert.equal(failed.error, 'temporary persistence failure');
  assert.equal(state.launchpadDiscovery.pending['raydium-launchlab'].length, 1);
  assert.equal(state.launchpadDiscovery.pending['raydium-launchlab'][0].attempts, 1);
  const retried = await processPendingLaunchpadTransactions(state, rpc, () => {}, { now: 2000 });
  assert.equal(retried.launches, 1);
  assert.equal(state.launchpadDiscovery.pending['raydium-launchlab'].length, 0);
});

test('rotates across queued launchpad programs and never scans every trade signature', async () => {
  const state = {};
  enqueueLaunchpadSignature(state, { launchpadId: 'raydium-launchlab', signature: 'raydium-signature' });
  enqueueLaunchpadSignature(state, { launchpadId: 'meteora-dbc', signature: 'meteora-signature' });
  const calls = [];
  const rpc = async (_method, params) => {
    calls.push(params[0]);
    return { meta: { err: null }, transaction: { message: { accountKeys: [], instructions: [] } } };
  };
  await processPendingLaunchpadTransactions(state, rpc, () => {});
  await processPendingLaunchpadTransactions(state, rpc, () => {});
  assert.deepEqual(calls, ['raydium-signature', 'meteora-signature']);
});
