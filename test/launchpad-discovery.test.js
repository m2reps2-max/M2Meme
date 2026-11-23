'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LAUNCHPADS, decodeBase58, parseLaunchpadTransaction, pollLaunchpadDiscovery } = require('../lib/launchpad-discovery');

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

test('ignores non-launch instructions, failed transactions and invalid mint accounts', () => {
  const accounts = ['payer', creator, 'global', 'config', 'authority', 'pool', mint, 'quote'];
  const wrong = txFor({ programId: launchLab.programId, discriminator: '0000000000000000', accounts });
  assert.equal(parseLaunchpadTransaction(wrong), null);
  assert.equal(parseLaunchpadTransaction({ ...wrong, meta: { err: { InstructionError: [0, 'failed'] } } }), null);
  const invalid = txFor({ programId: launchLab.programId, discriminator: 'afaf6d1f0d989bed', accounts: ['payer', creator, 'global', 'config', 'authority', 'pool', 'not-a-mint', 'quote'] });
  assert.equal(parseLaunchpadTransaction(invalid), null);
});

test('polls launchpad programs incrementally and processes only newly observed signatures', async () => {
  const state = {};
  const oldSignature = 'old-signature';
  const newSignature = 'new-signature';
  let raydiumRows = [{ signature: oldSignature, slot: 100 }];
  const launch = txFor({
    programId: launchLab.programId,
    discriminator: 'afaf6d1f0d989bed',
    accounts: ['payer', creator, 'global', 'config', 'authority', 'pool', mint, 'quote'],
    signature: newSignature
  });
  const calls = [];
  const rpc = async (method, params) => {
    calls.push([method, params[0]]);
    if (method === 'getSignaturesForAddress') {
      return params[0] === launchLab.programId ? raydiumRows : [{ signature: 'meteora-old', slot: 90 }];
    }
    if (method === 'getTransaction') return launch;
    throw new Error('unexpected RPC method');
  };
  const found = [];
  await pollLaunchpadDiscovery(state, rpc, row => found.push(row), { now: 1000 });
  await pollLaunchpadDiscovery(state, rpc, row => found.push(row), { now: 2000 });
  raydiumRows = [{ signature: newSignature, slot: 101 }, { signature: oldSignature, slot: 100 }];
  const result = await pollLaunchpadDiscovery(state, rpc, row => found.push(row), { now: 3000 });
  assert.equal(result.program, 'raydium-launchlab');
  assert.equal(result.queued, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.launches, 1);
  assert.equal(found.length, 1);
  assert.equal(found[0].mint, mint);
  assert.equal(state.launchpadDiscovery.metrics.launches, 1);
  assert.equal(state.launchpadDiscovery.pending['raydium-launchlab'].length, 0);
});

test('does not replay historical signatures on first bootstrap', async () => {
  const state = {};
  let transactions = 0;
  const rpc = async method => {
    if (method === 'getSignaturesForAddress') return [{ signature: 'existing-history', slot: 1 }];
    if (method === 'getTransaction') { transactions++; return null; }
    throw new Error('unexpected RPC method');
  };
  const result = await pollLaunchpadDiscovery(state, rpc, () => {}, { now: 1000 });
  assert.equal(result.queued, 0);
  assert.equal(transactions, 0);
  assert.equal(state.launchpadDiscovery.cursors['raydium-launchlab'], 'existing-history');
});
