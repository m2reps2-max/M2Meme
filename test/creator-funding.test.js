'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCreatorFunder } = require('../lib/creator-funding');

test('extracts a direct system transfer funding a creator wallet', () => {
  const result = extractCreatorFunder({ transaction: { message: { instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: 'FunderWallet111111111111111111111111111111', destination: 'CreatorWallet111111111111111111111111111111', lamports: 250000000 } } }] } }, meta: { innerInstructions: [] } }, 'CreatorWallet111111111111111111111111111111');
  assert.equal(result.funder, 'FunderWallet111111111111111111111111111111');
  assert.equal(result.lamports, 250000000);
});

test('does not infer a funder from unrelated transfers', () => {
  const result = extractCreatorFunder({ transaction: { message: { instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: 'OtherWallet111111111111111111111111111111', destination: 'SomeoneElse111111111111111111111111111111', lamports: 10 } } }] } }, meta: { innerInstructions: [] } }, 'CreatorWallet111111111111111111111111111111');
  assert.equal(result, null);
});

test('finds a creator account funded in an inner instruction', () => {
  const result = extractCreatorFunder({ transaction: { message: { instructions: [] } }, meta: { innerInstructions: [{ instructions: [{ program: 'system', parsed: { type: 'createAccount', info: { source: 'FunderWallet111111111111111111111111111111', newAccount: 'CreatorWallet111111111111111111111111111111', lamports: 1000 } } }] }] } }, 'CreatorWallet111111111111111111111111111111');
  assert.equal(result.instructionType, 'createAccount');
});
