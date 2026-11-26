'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasVerifiedSwapInstruction, transactionInstructions } = require('../lib/wallet-transaction-evidence');

test('recognizes PumpSwap and Pump.fun swaps from known program IDs and swap logs',()=>{
 const pumpSwap='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',pumpFun='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
 for(const programId of [pumpSwap,pumpFun])assert.equal(hasVerifiedSwapInstruction({transaction:{message:{instructions:[{programId}]}},meta:{innerInstructions:[],logMessages:['Program log: Instruction: Buy']}}),true);
});
test('recognizes an explicitly parsed swap instruction', () => {
  assert.equal(hasVerifiedSwapInstruction({
    transaction: { message: { instructions: [{ program: 'jupiter', parsed: { type: 'route' } }] } },
    meta: { innerInstructions: [] }
  }), true);
});

test('recognizes a swap in inner instructions', () => {
  assert.equal(hasVerifiedSwapInstruction({
    transaction: { message: { instructions: [] } },
    meta: { innerInstructions: [{ index: 0, instructions: [{ program: 'raydium', parsed: { type: 'swap' } }] }] }
  }), true);
});

test('does not mistake independent SOL and token transfers for a swap', () => {
  assert.equal(hasVerifiedSwapInstruction({
    transaction: { message: { instructions: [
      { program: 'system', parsed: { type: 'transfer' } },
      { program: 'spl-token', parsed: { type: 'transferChecked' } }
    ] } },
    meta: { innerInstructions: [] }
  }), false);
});

test('does not trust an unrelated program merely because it changes balances', () => {
  assert.equal(hasVerifiedSwapInstruction({
    transaction: { message: { instructions: [{ program: 'system', parsed: { type: 'transfer' } }] } },
    meta: { innerInstructions: [] }
  }), false);
});

test('collects outer and inner instructions without mutating the transaction', () => {
  const transaction = {
    transaction: { message: { instructions: [{ program: 'system' }] } },
    meta: { innerInstructions: [{ instructions: [{ program: 'spl-token' }] }] }
  };
  assert.equal(transactionInstructions(transaction).length, 2);
  assert.equal(transaction.transaction.message.instructions.length, 1);
});


test('recognizes an unparsed known Jupiter swap only when transaction logs confirm the swap instruction', () => {
  const programId = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
  assert.equal(hasVerifiedSwapInstruction({
    transaction: { message: { instructions: [{ programId }] } },
    meta: { innerInstructions: [], logMessages: ['Program log: Instruction: Route'] }
  }), true);
  assert.equal(hasVerifiedSwapInstruction({
    transaction: { message: { instructions: [{ programId }] } },
    meta: { innerInstructions: [], logMessages: ['Program log: Instruction: CreateOpenOrders'] }
  }), false);
});
