'use strict';
const { readJsonLimited } = require('./http-body');

const BASE = 'https://api.geckoterminal.com/api/v2';
const QUOTE_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'USD1ttm9pT2f9s5n6h7k8j9m4n3p2q1r0s9t8u7v6w5x'
]);
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;

async function fetchNewPools({ fetchImpl = fetch, page = 1, maxBytes = 1024 * 1024 } = {}) {
  const url = BASE + '/networks/solana/new_pools?page=' + Math.max(1, Math.min(10, Number(page) || 1)) + '&include=base_token,quote_token,dex';
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json;version=20230203', 'user-agent': 'MEME-RADAR/2.2 (+free public data)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('GeckoTerminal HTTP ' + response.status);
  return readJsonLimited(response, maxBytes);
}

function parseNewPools(payload) {
  const included = new Map((payload?.included || []).map(item => [item.id, item]));
  const out = [];
  for (const pool of payload?.data || []) {
    const a = pool.attributes || {};
    const rel = pool.relationships || {};
    const baseId = rel.base_token?.data?.id;
    const quoteId = rel.quote_token?.data?.id;
    const base = included.get(baseId)?.attributes || {};
    const quote = included.get(quoteId)?.attributes || {};
    const baseAddress = String(base.address || baseId || '').replace(/^solana_/, '');
    const quoteAddress = String(quote.address || quoteId || '').replace(/^solana_/, '');
    const useQuote = QUOTE_MINTS.has(baseAddress) && quoteAddress && !QUOTE_MINTS.has(quoteAddress);
    const token = useQuote ? quote : base;
    const address = useQuote ? quoteAddress : baseAddress;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || QUOTE_MINTS.has(address)) continue;
    const createdAt = a.pool_created_at || null;
    const createdMs = createdAt ? Date.parse(createdAt) : NaN;
    out.push({
      tokenAddress: address,
      name: String(token.name || '').slice(0, 100),
      symbol: String(token.symbol || '').slice(0, 24),
      poolAddress: String(a.address || String(pool.id || '').split('_').slice(1).join('_')),
      dexName: String(included.get(rel.dex?.data?.id)?.attributes?.name || '').slice(0, 80),
      poolCreatedAt: createdAt,
      ageHours: Number.isFinite(createdMs) ? Math.max(0, (Date.now() - createdMs) / 3600000) : null,
      liquidityUsd: number(a.reserve_in_usd),
      priceUsd: number(useQuote ? a.quote_token_price_usd : a.base_token_price_usd),
      fdv: number(a.fdv_usd),
      marketCap: number(a.market_cap_usd),
      volume: {
        m5: number(a.volume_usd?.m5),
        h1: number(a.volume_usd?.h1),
        h24: number(a.volume_usd?.h24)
      },
      txns: a.transactions || {},
      priceChange: a.price_change_percentage || {},
      source: 'geckoterminal_new_pool'
    });
  }
  return out;
}


async function fetchPoolTrades(poolAddress, { fetchImpl = fetch } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(poolAddress || ''))) throw new Error('Adresse de pool GeckoTerminal invalide');
  const url = BASE + '/networks/solana/pools/' + encodeURIComponent(poolAddress) + '/trades';
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json;version=20230203', 'user-agent': 'MEME-RADAR/2.2 (+free public data)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('GeckoTerminal trades HTTP ' + response.status);
  return readJsonLimited(response, 512 * 1024);
}

function mergeObservedTrades(target, mint, observed, limit = 5000) {
  const rows = Array.isArray(target) ? target : [];
  const known = new Set(rows.filter(x => x.signature && x.wallet && x.mint).map(x => [x.signature, x.wallet, x.mint].join('|')));
  let added = 0;
  for (const trade of Array.isArray(observed) ? observed : []) {
    if (!trade?.wallet || !trade?.signature || !trade?.at || !mint) continue;
    const key = [trade.signature, trade.wallet, mint].join('|');
    if (known.has(key)) continue;
    known.add(key);
    rows.push({
      wallet: trade.wallet, mint, signature: trade.signature, at: trade.at,
      direction: trade.direction, slot: trade.slot ?? null, volumeUsd: Number(trade.volumeUsd) || 0,
      source: 'gecko_pool_sample', role: 'gecko_sample', swapConfirmed: false,
      observedPriceUsd: null
    });
    added++;
  }
  if (rows.length > limit) rows.splice(0, rows.length - limit);
  return { rows, added };
}

function analyzePoolTrades(payload, poolCreatedAt = null, nowMs = Date.now()) {
  const rawSampleSize = Array.isArray(payload?.data) ? payload.data.length : 0;
  const trades = (payload?.data || []).slice(0, 300).map(row => {
    const a = row.attributes || {};
    return {
      wallet: String(a.tx_from_address || ''),
      kind: String(a.kind || '').toLowerCase(),
      volumeUsd: number(a.volume_in_usd) || 0,
      timestamp: Date.parse(a.block_timestamp || ''),
      block: a.block_number == null ? null : String(a.block_number),
      signature: String(a.tx_hash || row.id || '')
    };
  }).filter(x => Number.isFinite(x.timestamp) && (x.kind === 'buy' || x.kind === 'sell'))
    .sort((a,b) => a.timestamp - b.timestamp);
  const wallets = new Map();
  let buyVolumeUsd = 0, sellVolumeUsd = 0, buys = 0, sells = 0;
  for (const trade of trades) {
    if (trade.kind === 'buy') { buys++; buyVolumeUsd += trade.volumeUsd; }
    else { sells++; sellVolumeUsd += trade.volumeUsd; }
    if (!trade.wallet) continue;
    const row = wallets.get(trade.wallet) || { wallet: trade.wallet, buys: 0, sells: 0, buyVolumeUsd: 0, sellVolumeUsd: 0 };
    row[trade.kind === 'buy' ? 'buys' : 'sells']++;
    row[trade.kind === 'buy' ? 'buyVolumeUsd' : 'sellVolumeUsd'] += trade.volumeUsd;
    wallets.set(trade.wallet, row);
  }
  const buyerRows = [...wallets.values()].filter(x => x.buys).sort((a,b) => b.buyVolumeUsd-a.buyVolumeUsd);
  const sellerRows = [...wallets.values()].filter(x => x.sells).sort((a,b) => b.sellVolumeUsd-a.sellVolumeUsd);
  const top5BuyerVolume = buyerRows.slice(0,5).reduce((sum,x)=>sum+x.buyVolumeUsd,0);
  const top5BuyerSharePct = buyVolumeUsd > 0 ? Number((top5BuyerVolume / buyVolumeUsd * 100).toFixed(1)) : null;
  const blockGroups = new Map();
  for (const trade of trades) {
    if (trade.kind !== 'buy' || !trade.block || !trade.wallet) continue;
    const group = blockGroups.get(trade.block) || { wallets: new Set(), volumeUsd: 0, timestamps: [] };
    group.wallets.add(trade.wallet); group.volumeUsd += trade.volumeUsd; group.timestamps.push(trade.timestamp); blockGroups.set(trade.block, group);
  }
  const bundleCandidates = [...blockGroups.entries()].filter(([,group]) => group.wallets.size >= 3).map(([block,group]) => ({ kind: 'same_block_buyer_cluster', block, wallets: [...group.wallets].slice(0,12), uniqueBuyers: group.wallets.size, buyVolumeUsd: Number(group.volumeUsd.toFixed(2)), timeSpanMs: Math.max(...group.timestamps)-Math.min(...group.timestamps) }));
  const sameBlockBuyerClusters = bundleCandidates.length;
  const burstCandidates = [];
  for (let i = 0; i < trades.length; i++) {
    if (trades[i].kind !== 'buy' || !trades[i].wallet) continue;
    const window = trades.slice(i).filter(x => x.kind === 'buy' && x.timestamp - trades[i].timestamp <= 5000);
    const unique = [...new Set(window.map(x => x.wallet))];
    if (unique.length >= 3) {
      const key = unique.slice().sort().join('|');
      if (!burstCandidates.some(x => x.key === key && Math.abs(Date.parse(x.at) - trades[i].timestamp) <= 5000)) burstCandidates.push({ key, kind: 'five_second_buyer_burst', at: new Date(trades[i].timestamp).toISOString(), wallets: unique.slice(0,12), uniqueBuyers: unique.length, buyVolumeUsd: Number(window.reduce((sum,x)=>sum+x.volumeUsd,0).toFixed(2)) });
    }
  }
  const compactBursts = burstCandidates.slice(0,10).map(({key,...x})=>x);
  const created = poolCreatedAt ? Date.parse(poolCreatedAt) : NaN;
  const firstFiveMinutes = Number.isFinite(created) ? trades.filter(x => x.timestamp >= created && x.timestamp <= created + 300000) : [];
  const firstEarlyTradeAt = firstFiveMinutes[0]?.timestamp ?? null;
  const lastEarlyTradeAt = firstFiveMinutes.at(-1)?.timestamp ?? null;
  const poolAgeMs = Number.isFinite(created) ? nowMs - created : null;
  const windowElapsed = poolAgeMs !== null && poolAgeMs >= 300000;
  const sampleBelowCap = rawSampleSize < 300;
  const startsAtLaunch = firstEarlyTradeAt !== null && firstEarlyTradeAt >= created - 30000 && firstEarlyTradeAt <= created + 30000;
  const reachesWindowEnd = lastEarlyTradeAt !== null && lastEarlyTradeAt >= created + 270000;
  const earlyWindowComplete = Number.isFinite(created) && windowElapsed && sampleBelowCap && startsAtLaunch && reachesWindowEnd;
  const earlyWindowReason = !Number.isFinite(created) ? 'missing_pool_creation_time'
    : !windowElapsed ? 'five_minute_window_not_elapsed'
    : !sampleBelowCap ? 'trade_sample_at_api_cap'
    : !startsAtLaunch ? 'launch_edge_not_observed'
    : !reachesWindowEnd ? 'five_minute_window_end_not_observed'
    : 'complete_within_available_sample';
  const earlyWallets = new Map();
  for(const trade of firstFiveMinutes.filter(x=>x.kind==='buy'&&x.wallet)){
    const row=earlyWallets.get(trade.wallet)||{wallet:trade.wallet,buys:0,buyVolumeUsd:0};
    row.buys++;row.buyVolumeUsd+=trade.volumeUsd;earlyWallets.set(trade.wallet,row);
  }
  const earlyBuyers=[...earlyWallets.values()].sort((a,b)=>b.buyVolumeUsd-a.buyVolumeUsd);
  const flags = [];
  if (sameBlockBuyerClusters) flags.push({ code: 'SAME_BLOCK_BUY_BURST', level: 'warning', message: sameBlockBuyerClusters + ' bloc(s) contiennent au moins 3 acheteurs distincts.' });
  if (compactBursts.length) flags.push({ code: 'BUNDLE_LIKE_BURST', level: 'warning', message: compactBursts.length + ' rafale(s) de 5 secondes avec au moins 3 acheteurs distincts.' });
  if (buyerRows.length >= 5 && top5BuyerSharePct !== null && top5BuyerSharePct >= 70) flags.push({ code: 'BUY_VOLUME_CONCENTRATION', level: 'warning', message: 'Les 5 plus gros acheteurs représentent ' + top5BuyerSharePct + '% du volume acheteur observé.' });
  if (sellVolumeUsd > buyVolumeUsd * 1.5 && sells >= 5) flags.push({ code: 'SELL_VOLUME_DOMINANCE', level: 'warning', message: 'Le volume vendeur dépasse nettement le volume acheteur observé.' });
  if (earlyWindowComplete && earlyBuyers.length >= 5) flags.push({ code: 'EARLY_BUYER_BURST', level: 'warning', message: earlyBuyers.length + ' acheteurs distincts détectés dans les 5 premières minutes du pool.' });
  return {
    checkedAt: new Date().toISOString(), window: '24h maximum / 300 transactions maximum',
    tradeCount: trades.length, buys, sells, uniqueBuyers: buyerRows.length, uniqueSellers: sellerRows.length,
    buyVolumeUsd: Number(buyVolumeUsd.toFixed(2)), sellVolumeUsd: Number(sellVolumeUsd.toFixed(2)),
    top5BuyerSharePct, sameBlockBuyerClusters, bundleCandidates: bundleCandidates.slice(0,10), burstCandidates: compactBursts,
    observedTrades: trades.filter(x=>x.wallet).slice(-300).map(x=>({wallet:x.wallet,direction:x.kind,volumeUsd:Number(x.volumeUsd.toFixed(2)),at:new Date(x.timestamp).toISOString(),slot:x.block===null?null:Number(x.block),signature:x.signature,source:'gecko_pool_sample'})),
    earlyWindow: { complete: earlyWindowComplete, reason: earlyWindowReason, trades: firstFiveMinutes.length, uniqueBuyers: earlyBuyers.length, poolAgeMs, sampleSize: rawSampleSize, sampleBelowApiCap: sampleBelowCap, firstTradeOffsetMs: firstEarlyTradeAt === null ? null : firstEarlyTradeAt - created, lastTradeOffsetMs: lastEarlyTradeAt === null ? null : lastEarlyTradeAt - created },
    earlyBuyers: earlyWindowComplete ? earlyBuyers.slice(0,10).map(x=>({...x,buyVolumeUsd:Number(x.buyVolumeUsd.toFixed(2))})) : [],
    topBuyers: buyerRows.slice(0,5).map(x=>({wallet:x.wallet,buys:x.buys,buyVolumeUsd:Number(x.buyVolumeUsd.toFixed(2))})),
    topSellers: sellerRows.slice(0,5).map(x=>({wallet:x.wallet,sells:x.sells,sellVolumeUsd:Number(x.sellVolumeUsd.toFixed(2))})),
    flags
  };
}

module.exports = { fetchNewPools, parseNewPools, fetchPoolTrades, analyzePoolTrades, mergeObservedTrades };
