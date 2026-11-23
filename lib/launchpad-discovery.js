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
      '4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4': { id: 'raydium-launchlab', name: 'Raydium LaunchLab' },
      'FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1': { id: 'letsbonk', name: 'LetsBonk' },
      'BuM6KDpWiTcxvrpXywWFiw45R2RNH8WURdvqoTDV1BW4': { id: 'letsbonk', name: 'LetsBonk' },
      '6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt': { id: 'stonkfun', name: 'StonkFun' },
      '4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7': { id: 'stonkfun', name: 'StonkFun' },
      'CUqSiwPs6C4WyntMgaFazLp7wYQfaLp5URbjUP9V7SNi': { id: 'stonkfun', name: 'StonkFun' }
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
      'FbKf76ucsQssF7XZBuzScdJfugtsSKwZFYztKsMEhWZM': { id: 'moonshot', name: 'Moonshot' },
      'GKDMxu34q8MWqqj2mVVV3pEw2zkFC7LxYjvPXNjBQLMi': { id: 'bags', name: 'Bags' },
      'BnuJLtrZ14Lka7k937kewwcaWVaK3sFW2NEoik8yKw1V': { id: 'blocks', name: 'Blocks' },
      '8z8WtunBEhAZ3VJBpAMtJL1QPv2sYuPRHxRb1s3LHWtS': { id: 'bots-family', name: 'Bots Family' },
      'FodsuBzgdPxoqhxFtQd4MAFXbKvLpHuQHH54ikfKPXau': { id: 'farmfun', name: 'FarmFun' },
      'ALqi65kBeCYDsVNJY24nXj7GCUUkmU8EN3rDXMUdePet': { id: 'jupiter-studio', name: 'Jupiter Studio' }
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

function discoveryState(state) {
  const target = state.launchpadDiscovery ||= {
    nextProgram: 0,
    pending: {},
    seen: {},
    metrics: { launches: 0, processed: 0, gaps: 0, errors: 0 }
  };
  target.pending ||= {};
  target.seen ||= {};
  target.metrics ||= { launches: 0, processed: 0, gaps: 0, errors: 0 };
  return target;
}

function enqueueLaunchpadSignature(state, event, { now = Date.now(), maxPending = 500 } = {}) {
  const target = discoveryState(state);
  const launchpad = LAUNCHPADS.find(row => row.id === event?.launchpadId);
  const signature = String(event?.signature || '');
  if (!launchpad || !signature || signature.length > 120) return { queued: false, reason: 'invalid_event' };
  const queue = target.pending[launchpad.id] ||= [];
  const seen = target.seen[launchpad.id] ||= [];
  if (seen.includes(signature) || queue.some(row => row.signature === signature)) return { queued: false, reason: 'duplicate' };
  queue.push({
    signature,
    slot: Number.isFinite(Number(event.slot)) ? Number(event.slot) : null,
    attempts: 0,
    observedAt: String(event.observedAt || new Date(now).toISOString()).slice(0, 40)
  });
  if (queue.length > Math.max(1, Math.min(1000, Number(maxPending) || 500))) {
    const dropped = queue.shift();
    if (dropped?.signature) {
      seen.push(dropped.signature);
      if (seen.length > 1000) seen.splice(0, seen.length - 1000);
    }
    target.metrics.gaps++;
  }
  return { queued: true, program: launchpad.id, pending: queue.length };
}

function rememberSignature(target, launchpadId, signature) {
  const seen = target.seen[launchpadId] ||= [];
  if (!seen.includes(signature)) seen.push(signature);
  if (seen.length > 1000) seen.splice(0, seen.length - 1000);
}

async function processPendingLaunchpadTransactions(state, rpc, onLaunch, { now = Date.now(), maxTransactions = 1 } = {}) {
  const target = discoveryState(state);
  const limit = Math.max(1, Math.min(3, Number(maxTransactions) || 1));
  let processed = 0, launches = 0, error = null, lastProgram = null;
  while (processed < limit) {
    const start = ((Number(target.nextProgram) || 0) % LAUNCHPADS.length + LAUNCHPADS.length) % LAUNCHPADS.length;
    let index = -1;
    for (let offset = 0; offset < LAUNCHPADS.length; offset++) {
      const candidate = (start + offset) % LAUNCHPADS.length;
      if ((target.pending[LAUNCHPADS[candidate].id] || []).length) { index = candidate; break; }
    }
    if (index < 0) break;
    const launchpad = LAUNCHPADS[index];
    const queue = target.pending[launchpad.id];
    const pending = queue[0];
    target.nextProgram = (index + 1) % LAUNCHPADS.length;
    lastProgram = launchpad.id;
    let transaction;
    try {
      transaction = await rpc('getTransaction', [pending.signature, {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 1,
        commitment: 'confirmed'
      }]);
    } catch (cause) {
      pending.attempts = (pending.attempts || 0) + 1;
      if (pending.attempts >= 3) {
        queue.shift();
        rememberSignature(target, launchpad.id, pending.signature);
        target.metrics.errors++;
        processed++;
      }
      error = String(cause?.message || cause).slice(0, 180);
      break;
    }
    if (!transaction?.meta) {
      pending.attempts = (pending.attempts || 0) + 1;
      if (pending.attempts >= 3) {
        queue.shift();
        rememberSignature(target, launchpad.id, pending.signature);
        target.metrics.errors++;
        processed++;
        continue;
      }
      break;
    }
    const launch = parseLaunchpadTransaction(transaction, { signature: pending.signature });
    if (!launch) {
      queue.shift();
      rememberSignature(target, launchpad.id, pending.signature);
      processed++;
      target.metrics.processed++;
      continue;
    }
    try {
      await onLaunch(launch);
      queue.shift();
      rememberSignature(target, launchpad.id, pending.signature);
      processed++;
      launches++;
      target.metrics.processed++;
      target.metrics.launches++;
    } catch (cause) {
      pending.attempts = (pending.attempts || 0) + 1;
      if (pending.attempts >= 3) {
        queue.shift();
        rememberSignature(target, launchpad.id, pending.signature);
        target.metrics.errors++;
        processed++;
      }
      error = String(cause?.message || cause).slice(0, 180);
      break;
    }
  }
  target.lastPollAt = new Date(now).toISOString();
  target.lastProgram = lastProgram;
  target.lastProcessed = processed;
  target.lastLaunches = launches;
  target.lastError = error;
  const pending = Object.values(target.pending).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
  return { processed, launches, pending, program: lastProgram, error, metrics: { ...target.metrics } };
}

module.exports = {
  LAUNCHPADS,
  decodeBase58,
  parseLaunchpadTransaction,
  enqueueLaunchpadSignature,
  processPendingLaunchpadTransactions
};
