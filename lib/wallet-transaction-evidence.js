'use strict';

const SWAP_PROGRAM_NAMES = new Set([
  'jupiter', 'jupiter v6', 'raydium', 'raydium_amm', 'raydium_cpmm', 'raydium_clmm',
  'raydium_launchpad', 'orca', 'whirlpool', 'orca_whirlpool', 'meteora',
  'meteora_dlmm', 'meteora_damm', 'meteora_dbc', 'lifinity', 'phoenix',
  'openbook', 'openbook_v2', 'manifest', 'pump.fun', 'pumpfun', 'pump_swap', 'pump_amm', 'pump amm', 'pump.fun amm', 'launchlab'
]);
const KNOWN_SWAP_PROGRAM_IDS = new Set([
  // Routers and the most common Solana launch / AMM programs.
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  // Raydium CPMM, CLMM and LaunchLab.
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
  // Orca Whirlpool (mutable and immutable deployments).
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN',
  // Meteora DLMM, DAMM and Dynamic Bonding Curve.
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
  'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
  'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
  // Other established Solana venues.
  'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S',
  '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c',
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',
  'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP'
]);
const SWAP_TYPES = new Set([
  'swap', 'exchange', 'route', 'shared_accounts_route',
  'swap_exact_in', 'swap_exact_out', 'exact_in', 'exact_out'
]);

function keyText(value){return typeof value==='string'?value:String(value?.pubkey||value?.key||'');}

function transactionInstructions(transaction) {
  const message = transaction?.transaction?.message || transaction?.message || {};
  const outer = Array.isArray(message.instructions) ? message.instructions : [];
  const innerGroups = Array.isArray(transaction?.meta?.innerInstructions) ? transaction.meta.innerInstructions : [];
  const inner = innerGroups.flatMap(group => Array.isArray(group?.instructions) ? group.instructions : []);
  return [...outer, ...inner];
}

function instructionProgramId(instruction, accountKeys) {
  const indexed = Number(instruction?.programIdIndex);
  const indexedProgram = Number.isInteger(indexed) && indexed >= 0 ? keyText(accountKeys[indexed]) : '';
  return String(instruction?.programId || indexedProgram || '');
}

function hasVerifiedSwapInstruction(transaction) {
  const instructions = transactionInstructions(transaction);
  const message = transaction?.transaction?.message || transaction?.message || {};
  const accountKeys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const parsedSwap = instructions.some(instruction => {
    const program = String(instruction?.program || instruction?.programName || '').trim().toLowerCase();
    const parsedType = String(instruction?.parsed?.type || instruction?.type || '').trim().toLowerCase();
    const programId = instructionProgramId(instruction, accountKeys);
    const recognizedDex = SWAP_PROGRAM_NAMES.has(program) || KNOWN_SWAP_PROGRAM_IDS.has(programId);
    // Parsed AMM buy/sell variants (including PumpSwap's buy_exact_quote_in)
    // are accepted only when the instruction belongs to a recognized DEX.
    return recognizedDex && (SWAP_TYPES.has(parsedType) || /swap|route|exchange|buy|sell/i.test(parsedType));
  });
  if (parsedSwap) return true;
  const knownDexInstruction = instructions.some(instruction => {
    const program = String(instruction?.program || instruction?.programName || '').trim().toLowerCase();
    return SWAP_PROGRAM_NAMES.has(program) || KNOWN_SWAP_PROGRAM_IDS.has(instructionProgramId(instruction, accountKeys));
  });
  const logs = Array.isArray(transaction?.meta?.logMessages) ? transaction.meta.logMessages : [];
  // Include protocol-specific forms such as BuyExactQuoteIn and SellExactBaseIn.
  const swapLog = logs.some(line => /Program log: Instruction: (?:Swap[A-Za-z0-9_]*|Route|SharedAccountsRoute|Buy[A-Za-z0-9_]*|Sell[A-Za-z0-9_]*|ExactIn|ExactOut)/i.test(String(line)));
  return knownDexInstruction && swapLog;
}

function verifiedSwapInstructionIndexes(transaction) {
  const message = transaction?.transaction?.message || transaction?.message || {};
  const outer = Array.isArray(message.instructions) ? message.instructions : [];
  const accountKeys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const parsed = [];
  const recognized = [];
  for (let index = 0; index < outer.length; index++) {
    const instruction = outer[index];
    const program = String(instruction?.program || instruction?.programName || '').trim().toLowerCase();
    const parsedType = String(instruction?.parsed?.type || instruction?.type || '').trim().toLowerCase();
    const programId = instructionProgramId(instruction, accountKeys);
    const isDex = SWAP_PROGRAM_NAMES.has(program) || KNOWN_SWAP_PROGRAM_IDS.has(programId);
    if (!isDex) continue;
    recognized.push(index);
    if (SWAP_TYPES.has(parsedType) || /swap|route|exchange|buy|sell/i.test(parsedType)) parsed.push(index);
  }
  if (parsed.length) return parsed;
  // When the RPC parser omits the instruction name, only attribute inner
  // transfers if there is exactly one recognized DEX instruction in the
  // transaction and the transaction-level swap proof has already passed.
  return recognized.length === 1 && hasVerifiedSwapInstruction(transaction) ? recognized : [];
}

module.exports = { hasVerifiedSwapInstruction, verifiedSwapInstructionIndexes, transactionInstructions, instructionProgramId, KNOWN_SWAP_PROGRAM_IDS };
