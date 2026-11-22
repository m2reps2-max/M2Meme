'use strict';

const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = value => Math.max(0, Math.min(100, n(value)));

function analyzeMicrostructure(token) {
  const buys = n(token.txns?.m5?.buys);
  const sells = n(token.txns?.m5?.sells);
  const total = buys + sells;
  const hasVolume5m = token.volume?.m5 !== undefined && token.volume?.m5 !== null && Number.isFinite(Number(token.volume.m5));
  const volume5m = n(token.volume?.m5);
  const volume1h = n(token.volume?.h1);
  const liquidity = n(token.liquidityUsd);
  const buyRatio = total ? buys / total : null;
  const expected5mVolume = volume1h > 0 ? volume1h / 12 : null;
  const relativeVolume = hasVolume5m && expected5mVolume > 0 ? volume5m / expected5mVolume : null;
  const priceChange5m = token.priceChange?.m5 !== undefined && token.priceChange?.m5 !== null && Number.isFinite(Number(token.priceChange.m5)) ? Number(token.priceChange.m5) : null;

  let score = null;
  if (total > 0 || relativeVolume !== null || priceChange5m !== null) {
    const buyerComponent = buyRatio === null ? 50 : clamp(buyRatio * 100);
    const activityComponent = relativeVolume === null ? 50 : clamp(50 + Math.log2(Math.max(0.01, relativeVolume)) * 18);
    const priceComponent = priceChange5m === null ? 50 : clamp(50 + priceChange5m * 1.4);
    score = Math.round(buyerComponent * 0.45 + activityComponent * 0.30 + priceComponent * 0.25);
  }

  const flags = [];
  if (total >= 12 && buyRatio !== null && buyRatio < 0.35) {
    flags.push({ level: 'warning', code: 'MICRO_SELL_PRESSURE', message: 'Les ventes dominent nettement les 5 dernières minutes.' });
  }
  if (relativeVolume !== null && relativeVolume >= 4 && liquidity > 0 && liquidity < 10000) {
    flags.push({ level: 'warning', code: 'THIN_VOLUME_SPIKE', message: 'Pic de volume sur un pool peu liquide : risque de mouvement artificiel.' });
  }
  if (priceChange5m !== null && priceChange5m >= 35 && relativeVolume !== null && relativeVolume < 0.75) {
    flags.push({ level: 'warning', code: 'PRICE_VOLUME_DIVERGENCE', message: 'Le prix accélère sans hausse comparable du volume récent.' });
  }
  if (priceChange5m !== null && priceChange5m <= -20) {
    flags.push({ level: 'critical', code: 'MICRO_CRASH', message: 'Chute du prix supérieure à 20 % sur 5 minutes.' });
  }

  return {
    score,
    metrics: {
      transactions5m: total,
      buyRatio5mPct: buyRatio === null ? null : Number((buyRatio * 100).toFixed(1)),
      volume5mUsd: volume5m,
      relativeVolume5m: relativeVolume === null ? null : Number(relativeVolume.toFixed(2)),
      priceChange5mPct: priceChange5m
    },
    flags
  };
}

module.exports = { analyzeMicrostructure };
