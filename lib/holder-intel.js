'use strict';

function analyzeLargestHolders(largestAccounts, accountInfos, supplyAmount) {
  let supply;
  try { supply = BigInt(String(supplyAmount || '0')); } catch { supply = 0n; }
  if (supply <= 0n) return {
    top10HolderPercent: null, top10AccountPercent: null, top5OwnerPercent: null,
    top1OwnerPercent: null, top20HolderPercent: null, top20AccountPercent: null,
    holderGiniTop20: null, holderHhiTop20: null, effectiveOwnersTop20: null,
    holderSampleAccounts: 0, holderSampleOwners: 0, holderSampleCoveragePct: null,
    unknownOwnerAccounts: 0, uniqueOwnerCount: 0, ownerConcentrationAvailable: false
  };

  const rows = (Array.isArray(largestAccounts) ? largestAccounts : []).slice(0, 20).map((row, index) => {
    const info = accountInfos?.[index]?.data?.parsed?.info;
    const owner = typeof info?.owner === 'string' && info.owner ? info.owner : null;
    let amount = 0n;
    try { amount = BigInt(String(row?.amount || info?.tokenAmount?.amount || '0')); } catch {}
    return { owner, amount };
  }).filter(x => x.amount > 0n);

  const owners = new Map();
  const unknownOwners = [];
  for (const row of rows) {
    if (row.owner) owners.set(row.owner, (owners.get(row.owner) || 0n) + row.amount);
    else unknownOwners.push(row.amount);
  }

  const ownerAmounts = [...owners.values()].sort((a, b) => a === b ? 0 : a > b ? -1 : 1);
  const accountAmounts = rows.map(x => x.amount);
  const pct = amount => Number((amount * 1000000n / supply)) / 10000;
  const sum = values => values.reduce((total, value) => total + value, 0n);
  const topN = (values, count) => sum(values.slice(0, count));
  const accountTop10 = topN(accountAmounts, 10);
  const accountTop20 = sum(accountAmounts);
  const ownerTop10 = topN(ownerAmounts, 10);
  const ownerTop5 = topN(ownerAmounts, 5);
  const ownerTop20 = sum(ownerAmounts) + sum(unknownOwners);
  const distribution = ownerAmounts.length ? ownerAmounts : unknownOwners;
  let gini = null;
  if (distribution.length > 1) {
    const ascending = [...distribution].sort((a, b) => a === b ? 0 : a < b ? -1 : 1);
    const total = sum(ascending);
    if (total > 0n) {
      let weighted = 0n;
      for (let i = 0; i < ascending.length; i++) weighted += BigInt(i + 1) * ascending[i];
      const numerator = 2 * Number(weighted);
      const denominator = Number(BigInt(ascending.length + 1) * total);
      gini = denominator > 0 ? Number((numerator / denominator - 1) * (ascending.length) / ascending.length) : null;
      // Equivalent finite-sample Gini, calculated with normalized floating point values.
      const values = ascending.map(value => Number(value) / Number(total));
      const n = values.length;
      gini = Number(((2 * values.reduce((acc, value, i) => acc + (i + 1) * value, 0)) / n) - ((n + 1) / n));
      gini = Math.max(0, Math.min(1, gini));
    }
  }
  const sharesPct = distribution.map(amount => pct(amount));
  const hhi = sharesPct.reduce((total, share) => total + share * share, 0);
  const knownOwnerCoverage = unknownOwners.length === 0 && owners.size > 0;

  return {
    top10HolderPercent: pct(ownerTop10 || accountTop10),
    top10AccountPercent: pct(accountTop10),
    top5OwnerPercent: owners.size ? pct(ownerTop5) : null,
    top1OwnerPercent: owners.size ? pct(ownerAmounts[0]) : null,
    top20HolderPercent: pct(ownerTop20),
    top20AccountPercent: pct(accountTop20),
    holderGiniTop20: gini,
    holderHhiTop20: Number(hhi.toFixed(4)),
    effectiveOwnersTop20: hhi > 0 ? Number((10000 / hhi).toFixed(2)) : null,
    holderSampleAccounts: rows.length,
    holderSampleOwners: owners.size,
    holderSampleCoveragePct: pct(accountTop20),
    unknownOwnerAccounts: unknownOwners.length,
    uniqueOwnerCount: owners.size + unknownOwners.length,
    ownerConcentrationAvailable: knownOwnerCoverage
  };
}

module.exports = { analyzeLargestHolders };
