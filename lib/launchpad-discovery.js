'use strict';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58].map((char, index) => [char, index]));
const TOKEN_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const LAUNCHPADS = [
  {
    id: 'raydium-launchlab',
    name: 'Raydium LaunchLab',
    programId: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
    instructions: [
      { discriminator: 'afaf6d1f0d989bed', mint: 6, creator: 1, config: 3 },
      { discriminator: '4399af27da102620', mint: 6, creator: 1, config: 3 },
      { discriminator: '25be7ede2c9aab11', mint: 6, creator: 1, config: 3 }
    ],
    frontends: {
      'FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1': { id: 'letsbonk', name: 'LetsBonk' },
      'BuM6KDpWiTcxvrpXywWFiw45R2RNH8WURdvqoTDV1BW4': { id: 'letsbonk', name: 'LetsBonk' }
    }
  },
  {
    id: 'meteora-dbc',
    name: 'Meteora Dynamic Bonding Curve',
    programId: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
    instructions: [
      { discriminator: '8c55d7b06636684f', mint: 3, creator: 2, config: 0 },
      { discriminator: 'a976334e916edc9b', mint: 3, creator: 2, config: 0 }
    ],
    frontends: {
      'FbKf76ucsQssF7XZBuzScdJfugtsSKwZFYztKsMEhWZM': { id: 'moonshot', name: 'Moonshot' }
    }
  }
];

function decodeBase58(value) {
  if (typeof value !== 'string' || !value.length) return null;
  let number = 0n;
  for (const char of value) {
    const digit = BASE58_INDEX.get(char);
    if (digit === undefined) return null;
    number = number * 58n + BigInt(digit);
  }
  let hex = number.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = number === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  let zeros = 0;
  while (zeros < value.length && value[zeros] === '1') zeros++;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

function accountKeys(transaction) {
  const rows = transaction?.transaction?.message?.accountKeys || transaction?.message?.accountKeys || [];
  return rows.map(row => typeof row === 'string' ? row : String(row?.pubkey || row?.key || ''));
}

function instructionAccounts(instruction, keys) {
  if (!Array.isArray(instruction?.accounts)) return [];
  return instruction.accounts.map(account => {
    if (typeof account === 'string') return account;
    if (Number.isInteger(account)) return keys[account] || '';
    if (account && typeof account === 'object') return String(account.pubkey || account.key || '');
    return '';
  });
}

function allInstructions(transaction) {
  const message = transaction?.transaction?.message || transaction?.message || {};
  const outer = Array.isArray(message.instructions) ? message.instructions : [];
  const inner = (transaction?.meta?.innerInstructions || []).flatMap(row => Array.isArray(row.instructions) ? row.instructions : []);
  return [...outer, ...inner];
}

function parsedMetadata(transaction) {
  for (const instruction of allInstructions(transaction)) {
    const parsed = instruction?.parsed;
    if (!parsed || typeof parsed !== 'object') continue;
    const info = parsed.info || {};
    if (parsed.type === 'initializeTokenMetadata' || parsed.type === 'createMetadataAccount' || parsed.type === 'createMetadataAccountV2' || parsed.type === 'createMetadataAccountV3') {
      const data = info.data || info;
      const name = String(data.name || '').trim().slice(0, 100);
      const symbol = String(data.symbol || '').trim().slice(0, 24);
      if (name || symbol) return { name, symbol };
    }
  }
  return {};
}

function parseLaunchpadTransaction(transaction, { signature = null } = {}) {
  if (!transaction?.meta || transaction.meta.err) return null;
  const keys = accountKeys(transaction);
  const instructions = allInstructions(transaction);
  for (const instruction of instructions) {
    const programId = String(instruction?.programId || keys[instruction?.programIdIndex] || '');
    const launchpad = LAUNCHPADS.find(row => row.programId === programId);
    if (!launchpad || typeof instruction.data !== 'string') continue;
    const bytes = decodeBase58(instruction.data);
    if (!bytes || bytes.length < 8) continue;
    const discriminator = bytes.subarray(0, 8).toString('hex');
    const definition = launchpad.instructions.find(row => row.discriminator === discriminator);
    if (!definition) continue;
    const accounts = instructionAccounts(instruction, keys);
    const mint = accounts[definition.mint] || '';
    const creator = accounts[definition.creator] || '';
    if (!TOKEN_MINT.test(mint) || !TOKEN_MINT.test(creator)) continue;
    const config = accounts[definition.config] || '';
    const frontend = launchpad.frontends[config] || null;
    const metadata = parsedMetadata(transaction);
    const timestamp = Number(transaction.blockTime);
    return {
      mint,
      creator,
      name: metadata.name || frontend?.name || launchpad.name,
      symbol: metadata.symbol || '—',
      launchpadId: frontend?.id || launchpad.id,
      launchpadName: frontend?.name || launchpad.name,
      programId,
      config: config || null,
      signature: String(signature || transaction.transaction?.signatures?.[0] || '').slice(0, 100),
      slot: Number.isFinite(Number(transaction.slot)) ? Number(transaction.slot) : null,
      blockTime: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null
    };
  }
  return null;
}

async function pollLaunchpadDiscovery(state, rpc, onLaunch, { now = Date.now(), maxTransactions = 1 } = {}) {
  const target = state.launchpadDiscovery ||= { nextProgram: 0, cursors: {}, pending: {}, metrics: { launches: 0, processed: 0, gaps: 0, errors: 0 } };
  target.cursors ||= {};
  target.pending ||= {};
  target.metrics ||= { launches: 0, processed: 0, gaps: 0, errors: 0 };
  const index = ((Number(target.nextProgram) || 0) % LAUNCHPADS.length + LAUNCHPADS.length) % LAUNCHPADS.length;
  const launchpad = LAUNCHPADS[index];
  target.nextProgram = (index + 1) % LAUNCHPADS.length;
  const queue = target.pending[launchpad.id] ||= [];
  let queued = 0, processed = 0, launches = 0, gap = false, error = null;
  try {
    const signatures = await rpc('getSignaturesForAddress', [launchpad.programId, { limit: 100, commitment: 'confirmed' }]);
    const rows = Array.isArray(signatures) ? signatures.filter(row => row?.signature && !row.err) : [];
    const cursor = target.cursors[launchpad.id] || null;
    if (!cursor) {
      target.cursors[launchpad.id] = rows[0]?.signature || null;
      target.bootstrappedAt ||= new Date(now).toISOString();
    } else {
      const fresh = [];
      let foundCursor = false;
      for (const row of rows) {
        if (row.signature === cursor) { foundCursor = true; break; }
        fresh.push(row);
      }
      if (!foundCursor && rows.length) {
        gap = true;
        target.metrics.gaps++;
      }
      const known = new Set(queue.map(row => row.signature));
      for (const row of fresh.reverse()) {
        if (known.has(row.signature)) continue;
        queue.push({ signature: row.signature, slot: row.slot ?? null, attempts: 0 });
        known.add(row.signature);
        queued++;
      }
      if (queue.length > 500) {
        const dropped = queue.length - 500;
        queue.splice(0, dropped);
        target.metrics.gaps += dropped;
        gap = true;
      }
      if (rows[0]?.signature) target.cursors[launchpad.id] = rows[0].signature;
    }
  } catch (cause) {
    error = String(cause?.message || cause).slice(0, 180);
    target.metrics.errors++;
  }

  while (!error && queue.length && processed < Math.max(1, Math.min(2, Number(maxTransactions) || 1))) {
    const pending = queue[0];
    let transaction;
    try {
      transaction = await rpc('getTransaction', [pending.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
    } catch (cause) {
      pending.attempts = (pending.attempts || 0) + 1;
      if (pending.attempts >= 3) { queue.shift(); target.metrics.errors++; processed++; }
      error = String(cause?.message || cause).slice(0, 180);
      break;
    }
    if (!transaction?.meta) {
      pending.attempts = (pending.attempts || 0) + 1;
      if (pending.attempts >= 3) { queue.shift(); target.metrics.errors++; processed++; }
      else break;
      continue;
    }
    queue.shift();
    processed++;
    target.metrics.processed++;
    const launch = parseLaunchpadTransaction(transaction, { signature: pending.signature });
    if (!launch) continue;
    try {
      onLaunch(launch);
      launches++;
      target.metrics.launches++;
    } catch (cause) {
      error = String(cause?.message || cause).slice(0, 180);
      target.metrics.errors++;
      break;
    }
  }

  target.lastPollAt = new Date(now).toISOString();
  target.lastProgram = launchpad.id;
  target.lastQueued = queued;
  target.lastProcessed = processed;
  target.lastLaunches = launches;
  target.lastError = error;
  target.lastGap = gap;
  return { program: launchpad.id, queued, processed, launches, pending: queue.length, gap, error, metrics: { ...target.metrics } };
}

module.exports = { LAUNCHPADS, decodeBase58, parseLaunchpadTransaction, pollLaunchpadDiscovery };
