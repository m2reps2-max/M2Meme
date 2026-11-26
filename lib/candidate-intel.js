'use strict';

const clamp = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));

function evaluateTradeIntel(data, now = Date.now()) {
  const verifiedTradeCount=Number(data?.rpcConfirmedTradeCount);
  const effectiveTradeCount=Number.isFinite(verifiedTradeCount)&&verifiedTradeCount>0?Math.max(Number(data?.tradeCount)||0,verifiedTradeCount):Number(data?.tradeCount)||0;
  if (!data || effectiveTradeCount < 5) return { score: null, confidence: 'insufficient_data', reasons: [] };
  const checkedAt = Date.parse((verifiedTradeCount>0?data.rpcConfirmedCheckedAt:null)||data.checkedAt||'');
  const evidenceAgeMs = Number.isFinite(checkedAt) && checkedAt <= now + 60000 ? Math.max(0, now - checkedAt) : null;
  if (evidenceAgeMs !== null && evidenceAgeMs > 15 * 60 * 1000) return { score: null, confidence: 'stale_evidence', reasons: ['Échantillon de transactions trop ancien pour noter la demande actuelle.'] };
  const rpcCount=Number(data.rpcConfirmedTradeCount)||0,rpcLastTradeAt=Date.parse(data.rpcConfirmedLastTradeAt||'');
  if(rpcCount>0&&(!Number.isFinite(rpcLastTradeAt)||rpcLastTradeAt>now+60000||now-rpcLastTradeAt>15*60*1000))return {score:null,confidence:'stale_evidence',reasons:['Dernier swap vérifié du pool trop ancien pour noter la demande actuelle.']};
  const rpcCoverage=Number(data.rpcConfirmedVolumeCoverage);
  const hasVerifiedUsdFlow=Number(data.rpcConfirmedTradeCount)>=5&&Number.isFinite(rpcCoverage)&&rpcCoverage>=80&&Number.isFinite(Number(data.rpcConfirmedBuyVolumeUsd))&&Number.isFinite(Number(data.rpcConfirmedSellVolumeUsd));
  const buyVolume = Math.max(0, Number(hasVerifiedUsdFlow?data.rpcConfirmedBuyVolumeUsd:data.buyVolumeUsd) || 0);
  const sellVolume = Math.max(0, Number(hasVerifiedUsdFlow?data.rpcConfirmedSellVolumeUsd:data.sellVolumeUsd) || 0);
  const total = buyVolume + sellVolume;
  const buyShare = total > 0 ? buyVolume / total * 100 : null;
  const rpcBuyerCount=data.rpcConfirmedUniqueBuyers===null||data.rpcConfirmedUniqueBuyers===undefined?null:Number(data.rpcConfirmedUniqueBuyers);
  const rpcSampleCount=Number(data.rpcConfirmedTradeCount)||0;
  const uniqueBuyers=rpcSampleCount>=5&&Number.isFinite(rpcBuyerCount)?Math.max(0,rpcBuyerCount):(data.uniqueBuyers===null||data.uniqueBuyers===undefined?null:Math.max(0,Number(data.uniqueBuyers)||0));
  const concentration = data.top5BuyerSharePct == null ? null : Number(data.top5BuyerSharePct);
  let score = 50;
  const reasons = [];
  if (buyShare !== null) {
    score += (buyShare - 50) * 0.45;
    if (buyShare < 35) reasons.push('Volume vendeur dominant dans les transactions observées');
    if (buyShare >= 65) reasons.push('Volume acheteur supérieur dans l’échantillon observé');
  }
  if(uniqueBuyers!==null){score += Math.min(uniqueBuyers, 20) * 1.1;if (uniqueBuyers < 3) reasons.push('Peu d’acheteurs distincts observés');}
  if (concentration !== null) {
    score -= Math.max(0, concentration - 50) * 0.35;
    if (concentration >= 70) reasons.push('Volume acheteur concentré sur cinq wallets ou moins');
  }
  const clusters = Math.max(0, Number(data.sameBlockBuyerClusters) || 0);
  if (clusters) reasons.push('Achats groupés dans un même bloc : observation contextuelle, déjà traitée dans l’analyse de coordination.');
  if (sellVolume > buyVolume * 1.5 && Number(data.sells) >= 5) {
    score -= 12;
    reasons.push('Pression vendeuse marquée dans les transactions observées');
  }
  const cohort = data.first70BuyerCohort;
  if (cohort?.complete === true && Number.isFinite(Number(cohort.retentionPct))) {
    const retention = Math.max(0, Math.min(100, Number(cohort.retentionPct)));
    score += Math.max(-8, Math.min(8, (retention - 50) * 0.12));
    reasons.push('Rétention estimée des 70 premiers acheteurs : ' + retention.toFixed(1) + ' % sur l’échantillon observé.');
  } else if (cohort) {
    reasons.push('La cohorte des 70 premiers acheteurs n’est pas assez complète pour mesurer sa rétention.');
  }
  return { score: Math.round(clamp(score)), confidence: effectiveTradeCount >= 30 ? 'limited_sample' : 'small_sample', reasons, first70BuyerCohort: cohort || null };
}

function evaluateSocialIntel(data) {
  if (!data || !data.available) return { score: null, confidence: 'unavailable', reasons: [] };
  const evidence = data.evidence && typeof data.evidence === 'object' ? data.evidence : null;
  const hasSample = Boolean(evidence && Number(evidence.sampledPosts24h) > 0);
  const mentions1h = Math.max(0, Number(hasSample ? (evidence.nonPromotionalMentions1h ?? data.mentions1h) : data.mentions1h) || 0);
  const mentions24h = Math.max(0, Number(hasSample ? (evidence.nonPromotionalMentions24h ?? data.mentions24h) : data.mentions24h) || 0);
  if (mentions1h === 0 && mentions24h === 0) return {
    score: null,
    confidence: hasSample && Number(evidence.promotionalPosts24h) > 0 ? 'promotional_only' : 'no_token_mentions',
    reasons: hasSample && Number(evidence.promotionalPosts24h) > 0
      ? ['Les mentions observées proviennent uniquement de canaux Telegram promotionnels ou de signaux non indépendants.'] : []
  };

  const authors = Math.max(0, Number(hasSample ? evidence.uniqueAuthors24h : data.uniqueAuthors24h) || 0);
  const channels = Math.max(0, Number(hasSample ? evidence.uniqueChannels24h : data.uniqueChannels24h) || 0);
  const sourceCount = Math.max(0, Number(hasSample ? evidence.uniqueSources24h : data.uniqueSources24h) || 0);
  const entities = Math.max(0, Number(evidence?.independentEntities24h ?? (authors + channels)) || 0);
  const sentiment = data.sentimentScore == null ? null : Number(data.sentimentScore);
  const duplicateShare = hasSample
    ? Math.max(0, Math.min(100, Number(evidence.duplicateSharePct) || 0))
    : Math.min(100, Math.max(0, Number(data.duplicateTexts) || 0) * 12);
  const weakMatchShare = hasSample ? Math.max(0, Math.min(100, Number(evidence.weakMatchSharePct) || 0)) : 0;
  const identityShare = hasSample
    ? Math.max(0, Math.min(100, Number(evidence.exactMatchSharePct ?? (100 - weakMatchShare))))
    : 100;
  const momentum = hasSample && Number.isFinite(Number(evidence.socialMomentumScore))
    ? Math.max(0, Math.min(100, Number(evidence.socialMomentumScore))) : null;

  let score = momentum === null
    ? 42 + Math.min(mentions1h, 10) * 2.1 + Math.min(authors, 15) * 0.8
      + Math.min(channels, 5) * 2 + Math.min(sourceCount, 4) * 1.5
    : momentum;
  if (sentiment !== null && Number.isFinite(sentiment)) score += (sentiment - 50) * 0.12;
  score -= Math.min(16, duplicateShare * 0.24);
  score -= Math.min(12, weakMatchShare * 0.12);
  if (entities <= 1) score -= 12;
  if (hasSample && Number(evidence.authorConcentrationPct) >= 70 && authors >= 2) score -= 6;
  if (hasSample && Number(evidence.channelConcentrationPct) >= 80 && channels >= 2) score -= 5;

  const reasons = [];
  if (mentions1h >= 2 && (authors >= 3 || channels >= 2)) reasons.push('Accélération des mentions avec plusieurs auteurs ou canaux distincts');
  if (Number(evidence?.accelerating) === 1 || evidence?.accelerating === true) reasons.push('Rythme de mentions supérieur à l’heure précédente');
  if (sourceCount >= 2 && entities >= 3) reasons.push('Propagation observée sur plusieurs réseaux ou communautés');
  if (mentions24h >= 5 && entities <= 2) reasons.push('Mentions concentrées sur peu de comptes ou de canaux');
  if (duplicateShare >= 25) reasons.push('Publications similaires : possible amplification coordonnée, sans preuve de manipulation');
  if (weakMatchShare >= 35) reasons.push('Trop de mentions reposent sur le ticker seul : identité du token à confirmer');
  if (hasSample && Number(evidence.authorConcentrationPct) >= 70) reasons.push('Une faible part des auteurs concentre les publications observées');
  if (sentiment !== null && sentiment <= 30) reasons.push('Sentiment lexical négatif dans les publications observées');

  const confidence = hasSample
    ? (evidence.confidence === 'limited_sample' ? 'limited_sample'
      : evidence.confidence === 'early_signal' ? 'early_signal'
      : (!Object.hasOwn(evidence, 'confidence') && Number(evidence.sampledPosts24h) >= 10
        && (authors >= 5 || channels >= 3) && weakMatchShare < 50 ? 'limited_sample' : 'small_sample'))
    : (mentions24h >= 10 && (authors >= 5 || channels >= 3) ? 'legacy_aggregate' : 'unverified_sample');
  return { score: Math.round(clamp(score)), confidence, reasons, evidence: hasSample ? evidence : null };
}

function evaluateCandidateIntel(token) {
  const trade = evaluateTradeIntel(token?.tradeIntel);
  const social = evaluateSocialIntel(token?.socialIntel);
  // Trade quality is a weighted factor; do not count it a second time as a bonus.
  let adjustment = 0;

  const flags = [];
  const sameTransactionClusteredWallets = Math.max(0, Math.floor(Number(token?.walletReputation?.sameTransactionClusteredWallets) || 0));
  if (sameTransactionClusteredWallets > 0) {
    adjustment -= Math.min(4, sameTransactionClusteredWallets * 2);
  }
  if (trade.reasons.some(x => x.includes('Pression vendeuse'))) flags.push({ level: 'warning', code: 'TRADE_SELL_PRESSURE', message: 'Pression vendeuse détectée dans l’échantillon de transactions GeckoTerminal.' });
  if (trade.reasons.some(x => x.includes('Achats groupés'))) flags.push({ level: 'warning', code: 'SAME_BLOCK_BUY_BURST', message: 'Achats rapprochés dans un même bloc : signal de coordination possible, pas une preuve de manipulation.' });
  if (social.reasons.some(x => x.includes('concentrées'))) flags.push({ level: 'warning', code: 'SOCIAL_AUTHOR_CONCENTRATION', message: 'Les mentions publiques observées proviennent d’un nombre réduit d’auteurs.' });
  if (sameTransactionClusteredWallets > 0) flags.push({ level: 'warning', code: 'SMART_MONEY_TRANSACTION_CLUSTER', message: sameTransactionClusteredWallets + ' wallet(s) Smart Money observé(s) dans la même transaction qu’un autre acheteur suivi. Signal groupé à examiner, pas preuve de propriété commune.' });
  return {
    adjustment: Number(Math.max(-8, Math.min(8, adjustment)).toFixed(2)),
    tradeQuality: trade.score,
    socialQuality: social.score,
    tradeConfidence: trade.confidence,
    socialConfidence: social.confidence,
    reasons: [...trade.reasons, ...social.reasons, ...(sameTransactionClusteredWallets > 0 ? ['Acheteurs Smart Money regroupés dans une même transaction : confirmations indépendantes réduites par prudence'] : [])],
    flags
  };
}

module.exports = { evaluateTradeIntel, evaluateSocialIntel, evaluateCandidateIntel };
