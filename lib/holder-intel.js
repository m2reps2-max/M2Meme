'use strict';

function analyzeLargestHolders(largestAccounts, accountInfos, supplyAmount) {
  const supply = BigInt(String(supplyAmount || '0'));
  if (supply <= 0n) return { top10HolderPercent: null, top10AccountPercent: null, top5OwnerPercent: null, top1OwnerPercent: null, uniqueOwnerCount: 0, ownerConcentrationAvailable: false };
  const rows = (largestAccounts || []).map((row, index) => {
    const info = accountInfos?.[index]?.data?.parsed?.info;
    const owner = typeof info?.owner === 'string' ? info.owner : null;
    let amount = 0n;
    try { amount = BigInt(String(row?.amount || info?.tokenAmount?.amount || '0')); } catch {}
    return { owner, amount };
  }).filter(x => x.amount > 0n);
  const accountTop10 = rows.slice(0, 10).reduce((sum, x) => sum + x.amount, 0n);
  const owners = new Map();
  const unknownOwners = [];
  for (const row of rows) {
    if (row.owner) owners.set(row.owner, (owners.get(row.owner) || 0n) + row.amount);
    else unknownOwners.push(row.amount);
  }
  const sorted = [...owners.values(), ...unknownOwners].sort((a, b) => a === b ? 0 : a > b ? -1 : 1);
  const pct = amount => Number((amount * 1000000n / supply)) / 10000;
  const top10Owners = sorted.slice(0, 10).reduce((sum, x) => sum + x, 0n);
  return {
    top10HolderPercent: pct(top10Owners),
    top10AccountPercent: pct(accountTop10),
    top5OwnerPercent: owners.size ? pct(sorted.slice(0, 5).reduce((sum, x) => sum + x, 0n)) : null,
    top1OwnerPercent: owners.size ? pct(sorted[0]) : null,
    uniqueOwnerCount: owners.size + unknownOwners.length,
    ownerConcentrationAvailable: owners.size > 0 && unknownOwners.length === 0
  };
}

module.exports = { analyzeLargestHolders };
