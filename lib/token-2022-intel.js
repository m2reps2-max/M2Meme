'use strict';

const TOKEN_2022_MINT_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MINT_EXTENSIONS = new Map([
  [1, 'transferFeeConfig'], [3, 'mintCloseAuthority'], [4, 'confidentialTransferMint'],
  [6, 'defaultAccountState'], [9, 'nonTransferable'], [10, 'interestBearingConfig'],
  [12, 'permanentDelegate'], [14, 'transferHook'], [16, 'confidentialTransferFeeConfig'],
  [18, 'metadataPointer'], [19, 'tokenMetadata'], [20, 'groupPointer'],
  [21, 'tokenGroup'], [22, 'groupMemberPointer'], [23, 'tokenGroupMember'],
  [24, 'confidentialMintBurn'], [25, 'scaledUiAmount'], [26, 'pausable'], [28, 'permissionedBurn']
]);
const ACCOUNT_ONLY_EXTENSIONS = new Set([2, 5, 7, 8, 11, 13, 15, 17, 27]);

function inspectToken2022MintExtensions(buffer) {
  const result = {
    token2022ExtensionsReviewed: false,
    token2022Extensions: [],
    token2022UnknownExtensionTypes: [],
    token2022TlvMalformed: false,
    nonTransferable: false,
    permanentDelegateActive: false,
    transferHookActive: false,
    confidentialTransfer: false,
    mintCloseAuthorityActive: false,
    defaultAccountFrozen: false,
    pausableActive: false,
    pausablePaused: false,
    maxTransferFeeBps: 0
  };
  if (!Buffer.isBuffer(buffer) || buffer.length < 166 || buffer[165] !== 1) {
    result.token2022TlvMalformed = true;
    return result;
  }
  let offset = 166;
  const seen = new Set();
  while (offset < buffer.length) {
    if (buffer.length - offset < 4) {
      if (buffer.subarray(offset).every(byte => byte === 0)) break;
      result.token2022TlvMalformed = true;
      return result;
    }
    const type = buffer.readUInt16LE(offset);
    const length = buffer.readUInt16LE(offset + 2);
    if (type === 0) {
      if (!buffer.subarray(offset).every(byte => byte === 0)) result.token2022TlvMalformed = true;
      break;
    }
    const end = offset + 4 + length;
    if (end > buffer.length || length === 0 && ![9, 28].includes(type)) {
      result.token2022TlvMalformed = true;
      return result;
    }
    if (seen.has(type)) {
      result.token2022TlvMalformed = true;
      return result;
    }
    seen.add(type);
    const name = MINT_EXTENSIONS.get(type);
    if (!name || ACCOUNT_ONLY_EXTENSIONS.has(type)) result.token2022UnknownExtensionTypes.push(type);
    else {
      result.token2022Extensions.push(name);
      const data = buffer.subarray(offset + 4, end);
      if (type === 9) result.nonTransferable = true;
      if (type === 3) result.mintCloseAuthorityActive = data.length === 32 && data.some(byte => byte !== 0);
      if (type === 4 || type === 16 || type === 24) result.confidentialTransfer = true;
      if (type === 6) {
        if (data.length !== 1) result.token2022TlvMalformed = true;
        else result.defaultAccountFrozen = data[0] === 2;
      }
      if (type === 12) result.permanentDelegateActive = data.length === 32 && data.some(byte => byte !== 0);
      if (type === 14) result.transferHookActive = data.length >= 64 && data.subarray(32, 64).some(byte => byte !== 0);
      if (type === 26) {
        if (data.length !== 33) result.token2022TlvMalformed = true;
        else { result.pausableActive = data.subarray(0, 32).some(byte => byte !== 0); result.pausablePaused = data[32] === 1; }
      }
      if (type === 1) {
        if (data.length !== 108) result.token2022TlvMalformed = true;
        else result.maxTransferFeeBps = Math.max(data.readUInt16LE(88), data.readUInt16LE(106));
      }
    }
    offset = end;
  }
  result.token2022ExtensionsReviewed = !result.token2022TlvMalformed && result.token2022UnknownExtensionTypes.length === 0;
  return result;
}

module.exports = { TOKEN_2022_MINT_PROGRAM, inspectToken2022MintExtensions };
