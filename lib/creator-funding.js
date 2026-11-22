'use strict';

function extractCreatorFunder(transaction, creator) {
  if (!transaction || !creator) return null;
  const message = transaction.transaction?.message || transaction.message || {};
  const instructions = [
    ...(message.instructions || []),
    ...((transaction.meta?.innerInstructions || []).flatMap(group => group.instructions || []))
  ];
  for (const instruction of instructions) {
    if (instruction.program !== 'system' || !instruction.parsed?.info) continue;
    const info = instruction.parsed.info;
    const isTransfer = instruction.parsed.type === 'transfer' || instruction.parsed.type === 'transferWithSeed';
    const isCreate = instruction.parsed.type === 'createAccount' || instruction.parsed.type === 'createAccountWithSeed';
    if (isTransfer && info.destination === creator && info.source) {
      return { funder: String(info.source), lamports: Number(info.lamports || 0), instructionType: instruction.parsed.type };
    }
    if (isCreate && (info.newAccount === creator || info.account === creator) && info.source) {
      return { funder: String(info.source), lamports: Number(info.lamports || 0), instructionType: instruction.parsed.type };
    }
  }
  return null;
}

module.exports = { extractCreatorFunder };
