'use strict';

const clamp = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));

function evaluateTradeIntel(data) {
  if (!data || Number(data.tradeCount) < 5) return { score: null, confidence: 'insufficient_data', reasons: [] };
  const buyVolume = Math.max(0, Number(data.buyVolumeUsd) || 0);
  const sellVolume = Math.max(0, Number(data.sellVolumeUsd) || 0);
  const total = buyVolume + sellVolume;
  const buyShare = total > 0 ? buyVolume / total * 100 : null;
  const uniqueBuyers = Math.max(0, Number(data.uniqueBuyers) || 0);
  const concentration = data.top5BuyerSharePct == null ? null : Number(data.top5BuyerSharePct);
  let score = 50;
  const reasons = [];
  if (buyShare !== null) {
    score += (buyShare - 50) * 0.45;
    if (buyShare < 35) reasons.push('Volume vendeur dominant dans les transactions observées');
    if (buyShare >= 65) reasons.push('Volume acheteur supérieur dans l’échantillon observé');
  }
  score += Math.min(uniqueBuyers, 20) * 1.1;
  if (uniqueBuyers < 3) reasons.push('Peu d’acheteurs distincts observés');
  if (concentration !== null) {
    score -= Math.max(0, concentration - 50) * 0.35;
    if (concentration >= 70) reasons.push('Volume acheteur concentré sur cinq wallets ou moins');
  }
  const clusters = Math.max(0, Number(data.sameBlockBuyerClusters) || 0);
  score -= Math.min(clusters, 4) * 7;
  if (clusters) reasons.push('Achats groupés dans un même bloc : coordination possible, non prouvée');
  if (data.earlyWindow?.complete && Number(data.earlyWindow.uniqueBuyers) >= 5) {
    score += 3;
    reasons.push('Plusieurs acheteurs distincts présents dans la fenêtre initiale observée');
  }
  if (sellVolume > buyVolume * 1.5 && Number(data.sells) >= 5) {
    score -= 12;
    reasons.push('Pression vendeuse marquée dans les transactions observées');
  }
  return { score: Math.round(clamp(score)), confidence: Number(data.tradeCount) >= 30 ? 'limited_sample' : 'small_sample', reasons };
}

function evaluateSocialIntel(data) {
  if (!data || !data.available) return { score: null, confidence: 'unavailable', reasons: [] };
  const mentions1h = Math.max(0, Number(data.mentions1h) || 0);
  const mentions24h = Math.max(0, Number(data.mentions24h) || 0);
  if (mentions1h === 0 && mentions24h === 0) return { score: null, confidence: 'no_token_mentions', reasons: [] };
  const authors = Math.max(0, Number(data.uniqueAuthors24h) || 0);
  const sentiment = data.sentimentScore == null ? null : Number(data.sentimentScore);
  let score = 45 + Math.min(mentions1h, 10) * 2.5 + Math.min(authors, 20) * 0.8;
  if (sentiment !== null && Number.isFinite(sentiment)) score += (sentiment - 50) * 0.18;
  const reasons = [];
  if (mentions1h >= 3 && authors >= 3) reasons.push('Accélération des mentions publiques avec plusieurs auteurs');
  if (mentions24h >= 5 && authors <= 2) reasons.push('Mentions concentrées sur peu d’auteurs');
  if (sentiment !== null && sentiment <= 30) reasons.push('Sentiment lexical négatif dans les publications observées');
  return { score: Math.round(clamp(score)), confidence: mentions24h >= 10 && authors >= 5 ? 'limited_sample' : 'small_sample', reasons };
}

function evaluateCandidateIntel(token) {
  const trade = evaluateTradeIntel(token?.tradeIntel);
  const social = evaluateSocialIntel(token?.socialIntel);
  let adjustment = 0;
  if (trade.score !== null) adjustment += (trade.score - 50) * 0.08;
  if (social.score !== null) adjustment += (social.score - 50) * 0.04;
  const flags = [];
  if (trade.reasons.some(x => x.includes('Pression vendeuse'))) flags.push({ level: 'warning', code: 'TRADE_SELL_PRESSURE', message: 'Pression vendeuse détectée dans l’échantillon de transactions GeckoTerminal.' });
  if (trade.reasons.some(x => x.includes('Achats groupés'))) flags.push({ level: 'warning', code: 'SAME_BLOCK_BUY_BURST', message: 'Achats rapprochés dans un même bloc : signal de coordination possible, pas une preuve de manipulation.' });
  if (social.reasons.some(x => x.includes('concentrées'))) flags.push({ level: 'warning', code: 'SOCIAL_AUTHOR_CONCENTRATION', message: 'Les mentions publiques observées proviennent d’un nombre réduit d’auteurs.' });
  return {
    adjustment: Number(Math.max(-6, Math.min(6, adjustment)).toFixed(2)),
    tradeQuality: trade.score,
    socialQuality: social.score,
    tradeConfidence: trade.confidence,
    socialConfidence: social.confidence,
    reasons: [...trade.reasons, ...social.reasons],
    flags
  };
}

module.exports = { evaluateTradeIntel, evaluateSocialIntel, evaluateCandidateIntel };
