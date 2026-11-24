'use strict';

const SWAP_PROGRAM_NAMES = new Set([
  'jupiter', 'jupiter v6', 'raydium', 'raydium_amm', 'raydium_clmm',
  'orca', 'whirlpool', 'meteora', 'lifinity', 'phoenix', 'openbook',
  'manifest', 'pump.fun', 'pumpfun', 'pump_swap', 'launchlab'
]);
const KNOWN_SWAP_PROGRAM_IDS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
]);
const SWAP_TYPES = new Set([
  'swap', 'exchange', 'route', 'shared_accounts_route',
  'swap_exact_in', 'swap_exact_out', 'exact_in', 'exact_out'
]);

function transactionInstructions(transaction) {
  const message = transaction?.transaction?.message || transaction?.message || {};
  const outer = Array.isArray(message.instructions) ? message.instructions : [];
  const innerGroups = Array.isArray(transaction?.meta?.innerInstructions) ? transaction.meta.innerInstructions : [];
  const inner = innerGroups.flatMap(group => Array.isArray(group?.instructions) ? group.instructions : []);
  return [...outer, ...inner];
}

function hasVerifiedSwapInstruction(transaction) {
  const instructions = transactionInstructions(transaction);
  const parsedSwap = instructions.some(instruction => {
    const program = String(instruction?.program || instruction?.programName || '').trim().toLowerCase();
    const parsedType = String(instruction?.parsed?.type || instruction?.type || '').trim().toLowerCase();
    return SWAP_TYPES.has(parsedType) || (SWAP_PROGRAM_NAMES.has(program) && /swap|route|exchange/i.test(parsedType));
  });
  if (parsedSwap) return true;
  const knownDexInstruction = instructions.some(instruction => KNOWN_SWAP_PROGRAM_IDS.has(String(instruction?.programId || '')));
  const logs = Array.isArray(transaction?.meta?.logMessages) ? transaction.meta.logMessages : [];
  const swapLog = logs.some(line => /Program log: Instruction: (?:Swap|SwapBaseIn|SwapBaseOut|Route|SharedAccountsRoute|Buy|Sell|ExactIn|ExactOut)/i.test(String(line)));
  return knownDexInstruction && swapLog;
}

module.exports = { hasVerifiedSwapInstruction, transactionInstructions, KNOWN_SWAP_PROGRAM_IDS };
