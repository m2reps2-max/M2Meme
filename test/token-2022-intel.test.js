'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectToken2022MintExtensions } = require('../lib/token-2022-intel');

function mintWithExtensions(entries = []) {
  const parts = [Buffer.alloc(166)];
  parts[0][165] = 1;
  for (const [type, payload] of entries) {
    const header = Buffer.alloc(4);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(payload.length, 2);
    parts.push(header, payload);
  }
  return Buffer.concat(parts);
}

test('recognizes a valid Token-2022 mint with no extensions', () => {
  const result = inspectToken2022MintExtensions(mintWithExtensions());
  assert.equal(result.token2022ExtensionsReviewed, true);
  assert.deepEqual(result.token2022Extensions, []);
  assert.equal(result.token2022TlvMalformed, false);
});

test('decodes risk-relevant mint extensions without confusing them with account extensions', () => {
  const fee = Buffer.alloc(108);
  fee.writeUInt16LE(650, 88);
  fee.writeUInt16LE(250, 106);
  const pausable = Buffer.alloc(33);
  pausable[0] = 9;
  pausable[32] = 1;
  const delegate = Buffer.alloc(32, 7);
  const hook = Buffer.alloc(64);
  hook.fill(4, 32, 64);
  const result = inspectToken2022MintExtensions(mintWithExtensions([
    [1, fee], [9, Buffer.alloc(0)], [12, delegate], [14, hook], [26, pausable]
  ]));
  assert.equal(result.token2022ExtensionsReviewed, true);
  assert.equal(result.nonTransferable, true);
  assert.equal(result.permanentDelegateActive, true);
  assert.equal(result.transferHookActive, true);
  assert.equal(result.pausableActive, true);
  assert.equal(result.pausablePaused, true);
  assert.equal(result.maxTransferFeeBps, 650);
});

test('unknown, account-only, wrong account type and malformed TLV data remain unqualified', () => {
  const unknown = inspectToken2022MintExtensions(mintWithExtensions([[500, Buffer.from([1])]]));
  assert.equal(unknown.token2022ExtensionsReviewed, false);
  assert.deepEqual(unknown.token2022UnknownExtensionTypes, [500]);
  const accountOnly = inspectToken2022MintExtensions(mintWithExtensions([[2, Buffer.from([1])]]));
  assert.equal(accountOnly.token2022ExtensionsReviewed, false);
  const wrongKind = mintWithExtensions();
  wrongKind[165] = 2;
  assert.equal(inspectToken2022MintExtensions(wrongKind).token2022ExtensionsReviewed, false);
  const malformed = mintWithExtensions();
  malformed.writeUInt16LE(20, 166);
  malformed.writeUInt16LE(200, 168);
  assert.equal(inspectToken2022MintExtensions(malformed).token2022TlvMalformed, true);
});
