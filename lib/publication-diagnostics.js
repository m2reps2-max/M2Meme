'use strict';

const { qualifyOpportunity, assessAlertFreshness, assessOpportunityEvidence, MAX_SELLABILITY_EVIDENCE_AGE_MINUTES } = require('./alert-quality');
const { buildSelection, hasVerifiedDemand } = require('./selection');

const DIAGNOSTICS_BUILD_FINGERPRINT = 'm2meme-diagnostics-v3-20261125';
function ageMinutes(value,now){
 const at=typeof value==='number'?value:Date.parse(value||'');
 return !Number.isFinite(at)||at>now+60000?null:Math.max(0,(now-at)/60000);
}


function scannerPublicationDiagnostics() {
  const now = Date.now();
  const settings = this.state.scannerSettings || {};
  const tokens = Object.values(this.state.tokens || {});
  const linked = tokens.filter(token => Boolean(token.pairAddress || token.geckoPoolAddress));
  const selected = typeof this.selection === 'function'
    ? this.selection()
    : buildSelection(this.state.tokens, now, { minScore: Number(settings.minScore) || 80, settings });
  const selectedBestMints = new Set(selected.best.map(token => token.mint));
  const reasonCounts = Object.create(null);
  const candidates = [];
  let freshMarket = 0;
  let staleOrUnknownMarket = 0;
  let scorePass = 0;
  let qualityPass = 0;
  let opportunityEligible = 0;
  let qualifiedButOutsideTopFive = 0;
  let qualifiedButStaleMarket = 0;
  let qualifiedButStaleMarketMetrics = 0;
  let qualifiedButStaleEvidence = 0;
  let watchEligible = 0;
  let qualifiedButMissingFactors = 0;
  let qualifiedButUnverifiedDemand = 0;
  let qualifiedButUnverifiedExit = 0;
  let critical = 0;
  const requiredBestFactors = ['activity', 'momentum', 'market', 'liquidityQuality', 'executionQuality', 'security', 'demandQuality'];
  const factorLabels = { activity: 'activité', momentum: 'momentum', market: 'marché', liquidityQuality: 'qualité de liquidité', executionQuality: 'capacité de sortie', security: 'sécurité on-chain', demandQuality: 'demande vérifiée' };
  // Cumulative funnel: each count is the number of linked pools still passing
  // every preceding gate. This makes the first empty stage immediately visible.
  const pipeline = {
    poolLinked: linked.length, score: 0, coverage: 0, liquidity: 0, volume: 0,
    transactions: 0, buyerPressure: 0, valuation: 0, baseSecurity: 0,
    hardBlock: 0, risk: 0, holderSecurity: 0, flags: 0, marketFresh: 0, marketMetricsFresh:0,
    securityFresh: 0, transactionsFresh: 0, requiredFactors: 0,
    verifiedDemand: 0, exitability: 0, publicationEnabled: 0, topFive: 0
  };
  const orderedQualityGates = [
    ['score', 'Score inférieur au seuil'],
    ['coverage', 'Couverture des facteurs insuffisante'],
    ['liquidity', 'Liquidité insuffisante'],
    ['volume', 'Volume 1h insuffisant'],
    ['transactions', 'Activité transactionnelle insuffisante'],
    ['buyerPressure', 'Pression acheteuse insuffisante'],
    ['valuation', 'Valorisation trop élevée par rapport à la liquidité'],
    ['baseSecurity', 'Contrôle on-chain de base incomplet'],
    ['hardBlock', 'Token bloqué par un contrôle de sécurité'],
    ['risk', 'Risque ou sécurité non suffisamment maîtrisés'],
    ['holderSecurity', 'Analyse des détenteurs incomplète'],
    ['flags', 'Signal de risque encore présent']
  ];

  for (const token of linked) {
    const analysis = token.analysis || {};
    const freshness = assessAlertFreshness(token, now);
    if (freshness.status === 'fresh') freshMarket++;
    else staleOrUnknownMarket++;
    if (Number(analysis.score) >= Number(settings.minScore ?? 80)) scorePass++;
    const qualification = qualifyOpportunity(token, settings);
    if (qualification.eligible) qualityPass++;
    const evidence=assessOpportunityEvidence(token,now);
    const evidenceFresh=evidence.eligible;
    const factors=analysis.factors||{};
    const missingBestFactors=requiredBestFactors.filter(key=>!Number.isFinite(factors[key]));
    const factorsComplete=missingBestFactors.length===0;
    const demandVerified=hasVerifiedDemand(token,now);
    const sellabilityAt=Date.parse(token.sellability?.checkedAt||'');
    const sellabilityFresh=Number.isFinite(sellabilityAt)&&sellabilityAt<=now+60000&&now-sellabilityAt<=MAX_SELLABILITY_EVIDENCE_AGE_MINUTES*60000;
    const exitabilityVerified=sellabilityFresh&&Number.isFinite(Number(analysis.exitCapacityUsd))&&Number(analysis.exitCapacityUsd)>=50;
    const volumeFieldAge=ageMinutes(token.marketFieldsObservedAt?.volumeH1,now),transactionsFieldAge=ageMinutes(token.marketFieldsObservedAt?.txnsH1,now);
    const marketMetricsFresh=volumeFieldAge!==null&&volumeFieldAge<=15&&transactionsFieldAge!==null&&transactionsFieldAge<=15;
    const missingFactorsBlock = settings.publishOpportunities !== false
      && qualification.eligible && freshness.status === 'fresh' && !factorsComplete;
    let funnelOpen = true;
    for (const [key, reason] of orderedQualityGates) {
      const passed = !qualification.reasons.includes(reason);
      if (funnelOpen && passed) pipeline[key]++;
      else funnelOpen = false;
    }
    if (funnelOpen) {
      const postQualityGates = [
        ['marketFresh', freshness.status === 'fresh'],
        ['marketMetricsFresh',marketMetricsFresh],
        ['securityFresh', evidence.securityFresh],
        ['transactionsFresh', evidence.transactionFresh],
        ['requiredFactors', factorsComplete],
        ['verifiedDemand', demandVerified],
        ['exitability', exitabilityVerified],
        ['publicationEnabled', settings.publishOpportunities !== false],
        ['topFive', selectedBestMints.has(token.mint)]
      ];
      for (const [key, passed] of postQualityGates) {
        if (funnelOpen && passed) pipeline[key]++;
        else funnelOpen = false;
      }
    }
    if (missingFactorsBlock) {
      const reason='Facteurs requis incomplets : '+missingBestFactors.map(key=>factorLabels[key]||key).join(', ');
      reasonCounts[reason]=(reasonCounts[reason]||0)+1;
    }
    if (freshness.status !== 'fresh') {
      const reason=freshness.status === 'unknown' ? 'Snapshot marché absent ou horodatage invalide' : 'Snapshot marché trop ancien';
      reasonCounts[reason]=(reasonCounts[reason]||0)+1;
    }
    if (!evidence.securityFresh) {
      const reason=evidence.securityAgeMinutes === null ? 'Contrôle de sécurité absent ou horodatage invalide' : 'Contrôle de sécurité trop ancien';
      reasonCounts[reason]=(reasonCounts[reason]||0)+1;
    }
    if (!evidence.transactionFresh) {
      const reason='Preuve transactionnelle récente indisponible';
      reasonCounts[reason]=(reasonCounts[reason]||0)+1;
    }
    if (qualification.eligible && freshness.status === 'fresh' && evidenceFresh && factorsComplete && marketMetricsFresh && settings.publishOpportunities !== false) {
      if (!demandVerified) qualifiedButUnverifiedDemand++;
      else if (!exitabilityVerified) qualifiedButUnverifiedExit++;
      else if (selectedBestMints.has(token.mint)) opportunityEligible++;
      else qualifiedButOutsideTopFive++;
    } else if (qualification.eligible && freshness.status !== 'fresh') qualifiedButStaleMarket++;
    else if (qualification.eligible && freshness.status === 'fresh' && !marketMetricsFresh) qualifiedButStaleMarketMetrics++;
    else if (qualification.eligible && freshness.status === 'fresh' && !evidenceFresh) qualifiedButStaleEvidence++;
    else if (missingFactorsBlock) qualifiedButMissingFactors++;
    const hasCritical = analysis.hardBlocked === true || (analysis.flags || []).some(flag => flag?.level === 'critical');
    if (hasCritical) critical++;
    const watch = freshness.status === 'fresh'
      && Number(analysis.score) >= Math.max(60, Number(settings.minScore ?? 88) - 15)
      && Number(analysis.coverage) >= 45
      && !analysis.hardBlocked
      && analysis.risk !== 'high'
      && analysis.risk !== 'unknown';
    if (watch) watchEligible++;
    for (const reason of qualification.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    if (!qualification.eligible || freshness.status !== 'fresh' || !evidenceFresh || !factorsComplete
      || settings.publishOpportunities === false
      || (qualification.eligible && freshness.status === 'fresh' && evidenceFresh && factorsComplete && !selectedBestMints.has(token.mint))) {
      const blockers = [
        ...(freshness.status !== 'fresh' ? [freshness.status === 'unknown' ? 'Aucun snapshot marché horodaté' : 'Snapshot marché trop ancien'] : []),
        ...(!marketMetricsFresh?['Volume 1h ou transactions 1h sans observation récente indépendante']:[]),
        ...(!evidence.securityFresh ? [evidence.securityAgeMinutes === null ? 'Contrôle de sécurité absent ou horodatage invalide' : 'Contrôle de sécurité trop ancien ('+evidence.securityAgeMinutes+' min)'] : []),
        ...(!evidence.transactionFresh ? ['Preuve transactionnelle récente indisponible'] : []),
        ...(factorsComplete&&!demandVerified ? ['Demande non vérifiée : 20 transactions Gecko récentes, cinq acheteurs distincts et flux USD connus requis'] : []),
        ...(factorsComplete&&demandVerified&&!exitabilityVerified ? ['Cotation Jupiter récente insuffisante : montant réellement testable inférieur à 50 USD ou impact inconnu'] : []),
        ...qualification.reasons,
        ...(missingFactorsBlock ? ['Facteurs requis incomplets : '+missingBestFactors.map(key=>factorLabels[key]||key).join(', ')] : []),
        ...(settings.publishOpportunities === false ? ['Publication des opportunités désactivée'] : []),
        ...(qualification.eligible && freshness.status === 'fresh' && evidenceFresh && factorsComplete && settings.publishOpportunities !== false && !selectedBestMints.has(token.mint) ? ['Hors des cinq meilleurs candidats sélectionnés'] : [])
      ];
      const securityData = token.security?.data || {};
      const tokenProgram = String(securityData.tokenProgram || '');
      const knownPrograms = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
      const tokenProgramKnown = tokenProgram ? knownPrograms.includes(tokenProgram) : securityData.isToken2022 === false;
      const tokenProgramConsistent = !tokenProgram || (tokenProgram === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' ? securityData.isToken2022 === true : securityData.isToken2022 === false);
      const authoritiesKnown = typeof securityData.mintAuthorityActive === 'boolean' && typeof securityData.freezeAuthorityActive === 'boolean';
      const tokenTypeReviewed = securityData.isInitialized === true && tokenProgramKnown && tokenProgramConsistent && (!securityData.isToken2022 || securityData.token2022ExtensionsReviewed === true);
      const securityFactorAvailable = Number.isFinite(analysis.factors?.security);
      const securityInspection = {
        checkedAt: token.security?.checkedAt || null,
        provider: token.security?.provider || null,
        tokenProgram: tokenProgram || null,
        tokenProgramRecognized: tokenProgram ? knownPrograms.includes(tokenProgram) : null,
        tokenProgramKnown,
        tokenProgramConsistent,
        isInitialized: typeof securityData.isInitialized === 'boolean' ? securityData.isInitialized : null,
        isToken2022: typeof securityData.isToken2022 === 'boolean' ? securityData.isToken2022 : null,
        token2022ExtensionsReviewed: typeof securityData.token2022ExtensionsReviewed === 'boolean' ? securityData.token2022ExtensionsReviewed : null,
        authoritiesKnown,
        mintAuthorityKnown: typeof securityData.mintAuthorityActive === 'boolean',
        freezeAuthorityKnown: typeof securityData.freezeAuthorityActive === 'boolean',
        tokenTypeReviewed,
        holderOwnershipAvailable: securityData.ownerConcentrationAvailable === true,
        securityFactorAvailable,
        baseSecurityGatePassed: securityFactorAvailable,
        lastError: token.securityCheckError || token.security?.error || null,
        retryAt: token.securityRetryAt || null,
        failureCount: Number(token.securityCheckFailureCount) || 0
      };
      candidates.push({
        mint: token.mint,
        securityInspection,
        symbol: token.symbol || token.name || String(token.mint || '').slice(0, 8),
        score: Number.isFinite(Number(analysis.score)) ? Number(analysis.score) : null,
        coverage: Number.isFinite(Number(analysis.coverage)) ? Number(analysis.coverage) : null,
        freshness: freshness.status,
        freshnessAgeMinutes: freshness.ageMinutes,
        securityAgeMinutes: evidence.securityAgeMinutes,
        transactionAgeMinutes: evidence.transactionAgeMinutes,
        marketFieldFreshness:{volumeAgeMinutes:volumeFieldAge===null?null:Number(volumeFieldAge.toFixed(1)),transactionsAgeMinutes:transactionsFieldAge===null?null:Number(transactionsFieldAge.toFixed(1))},
        tradeEvidence:{geckoSampleTrades:Number(token.tradeIntel?.tradeCount)||0,verifiedPoolSwaps:token.tradeIntel?.rpcConfirmedTradeCount==null?null:Number(token.tradeIntel.rpcConfirmedTradeCount),distinctRpcBuyers:token.tradeIntel?.rpcConfirmedTradeCount==null?null:Number(token.tradeIntel.rpcConfirmedUniqueBuyers)||0,distinctRpcSellers:token.tradeIntel?.rpcConfirmedTradeCount==null?null:Number(token.tradeIntel.rpcConfirmedUniqueSellers)||0,rpcVolumeCoverage:token.tradeIntel?.rpcConfirmedVolumeCoverage!=null&&Number.isFinite(Number(token.tradeIntel.rpcConfirmedVolumeCoverage))?Number(token.tradeIntel.rpcConfirmedVolumeCoverage):null,rpcBuyUsd:token.tradeIntel?.rpcConfirmedBuyVolumeUsd!=null&&Number.isFinite(Number(token.tradeIntel.rpcConfirmedBuyVolumeUsd))?Number(token.tradeIntel.rpcConfirmedBuyVolumeUsd):null,rpcSellUsd:token.tradeIntel?.rpcConfirmedSellVolumeUsd!=null&&Number.isFinite(Number(token.tradeIntel.rpcConfirmedSellVolumeUsd))?Number(token.tradeIntel.rpcConfirmedSellVolumeUsd):null,rpcCheckedAt:token.tradeIntel?.rpcConfirmedCheckedAt||null,rpcLastTradeAt:token.tradeIntel?.rpcConfirmedLastTradeAt||null,pendingPoolSignatures:Number(token.poolRpcTradeIntel?.pendingCount)||0},
        blockers: [...new Set(blockers)].slice(0, 10)
      });
    }
  }

  const channels = Array.isArray(this.state.telegramChannels) ? this.state.telegramChannels : [];
  const enabledChannels = channels.filter(channel => channel.enabled);
  const outbox = Array.isArray(this.state.telegramOutbox) ? this.state.telegramOutbox : [];
  const outboxCounts = outbox.reduce((counts, entry) => {
    const key = String(entry.status || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const lastScanAt = this.state.lastScanAt || null;
  const lastScanAgeMs = lastScanAt ? Math.max(0, now - Date.parse(lastScanAt)) : null;
  const sources = this.status();
  const recentAlerts = (this.state.alerts || []).slice(-30).reverse().map(alert => ({
    at: alert.at, symbol: alert.symbol, level: alert.level, score: alert.score
  }));

  let diagnosis = 'Aucun candidat avec pool DEX indexé';
  if (linked.length) {
    if (settings.publishOpportunities === false) diagnosis = 'La publication des opportunités est désactivée dans le profil de scan.';
    else if (!opportunityEligible && qualifiedButStaleMarket) diagnosis = 'Des candidats passent les critères de qualité, mais leurs snapshots marché ont plus de 5 minutes : le rafraîchissement DEX doit être vérifié.';
    else if (!opportunityEligible && qualifiedButStaleMarketMetrics) diagnosis = 'Des pools ont des prix/liquidités récents, mais leurs volumes ou transactions 1h ne proviennent pas d’une observation récente : snapshots partiels à rafraîchir.';
    else if (!opportunityEligible && qualifiedButStaleEvidence) diagnosis = 'Des candidats passent les critères de marché, mais les contrôles de sécurité ou les transactions sont trop anciens : la rotation de ces analyses doit être vérifiée.';
    else if (!opportunityEligible && qualifiedButMissingFactors) diagnosis = 'Des candidats passent les critères de qualité et de fraîcheur, mais il manque un facteur obligatoire du classement principal : vérifier l’enrichissement de ces données.';
    else if (!opportunityEligible && qualifiedButUnverifiedDemand) diagnosis = 'Des candidats passent les filtres de base, mais aucun ne présente encore un échantillon récent de demande vérifiée (acheteurs distincts et flux nets USD).';
    else if (!opportunityEligible && qualifiedButUnverifiedExit) diagnosis = 'Des candidats ont une demande suffisante, mais aucune sortie Jupiter récente ne confirme au moins 50 USD réellement cotés avec impact connu.';
    else if (!opportunityEligible && qualifiedButOutsideTopFive) diagnosis = 'Des candidats sont qualifiés, mais seuls les cinq meilleurs sont publiables; les autres restent visibles dans les diagnostics.';
    else if (!freshMarket) diagnosis = 'Les snapshots marché sont absents ou trop anciens : le rafraîchissement DEX doit être vérifié.';
    else if (!opportunityEligible && qualityPass === 0) {
      const firstFailedStage = orderedQualityGates.find(([key]) => pipeline[key] === 0);
      if (firstFailedStage?.[0] === 'baseSecurity' && pipeline.valuation > 0) {
        diagnosis = 'Des signaux de veille existent, mais aucun candidat ne passe le contrôle on-chain de base : les vérifications de sécurité doivent être accélérées ou leur accès RPC contrôlé.';
      } else if (firstFailedStage) {
        const labels = {
          score: 'score minimum', coverage: 'couverture minimale', liquidity: 'liquidité minimale',
          volume: 'volume 1h minimum', transactions: 'activité transactionnelle',
          buyerPressure: 'pression acheteuse', valuation: 'ratio valorisation/liquidité',
          baseSecurity: 'contrôle on-chain de base', hardBlock: 'contrôle anti-scam',
          risk: 'niveau de risque', holderSecurity: 'analyse des détenteurs', flags: 'signaux de risque'
        };
        diagnosis = 'Des signaux de veille existent, mais aucun candidat ne franchit le premier filtre bloquant : ' + (labels[firstFailedStage[0]] || firstFailedStage[0]) + '. Les alertes de veille ne sont pas des opportunités publiables.';
      } else {
        diagnosis = scorePass ? 'Des tokens atteignent le score minimum, mais aucun ne satisfait tous les critères de qualité.' : 'Aucun token relié ne dépasse le score minimum configuré.';
      }
    }
    else if (!freshMarket) diagnosis = 'Les snapshots marché sont absents ou trop anciens : le rafraîchissement DEX doit être vérifié.';
    else if (!this.bot) diagnosis = 'Des opportunités sont éligibles, mais aucun bot Telegram n’est initialisé (token absent/invalide).';
    else if (!enabledChannels.length) diagnosis = 'Des opportunités sont éligibles, mais aucun canal Telegram n’est activé.';
    else diagnosis = 'Des opportunités sont éligibles : vérifier la file Telegram et les erreurs par canal.';
  }
  if (this.bot && enabledChannels.length && outboxCounts.failed) {
    diagnosis = 'Des publications échouent dans la file Telegram : consulter les erreurs de la file et les droits du bot.';
  }

  return {
    buildFingerprint: DIAGNOSTICS_BUILD_FINGERPRINT,
    at: new Date(now).toISOString(),
    diagnosis,
    settings: {
      preset: settings.preset || 'elite',
      minScore: Number(settings.minScore ?? 80),
      minLiquidityUsd: Number(settings.minLiquidityUsd ?? 5000),
      minVolume1hUsd: Number(settings.minVolume1hUsd ?? 750),
      minCoverage: Number(settings.minCoverage ?? 70),
      minTransactions1h: Number(settings.minTransactions1h ?? 8),
      publishOpportunities: settings.publishOpportunities !== false,
      publishRisks: settings.publishRisks !== false
    },
    scan: { running: this.running === true, scanning: this.scanning === true, backgroundTask: this.backgroundTaskRunning || null, lastScanAttemptAt: this.lastScanAttemptAt || null, lastScanSkipReason: this.lastScanSkipReason || null, retryScheduled: Boolean(this.scanRetryTimer), lastScanAt, lastScanAgeMs, durationMs: this.state.lastScanDurationMs || null, lastScanCompletedAt: this.state.lastScanCompletedAt || null, lastScanCompletedDurationMs: this.state.lastScanCompletedDurationMs || null, lastScanError: this.state.lastScanError || null, dexMarket: sources.dexMarket || null, runtimeMemory: sources.runtimeMemory || null },
    discovery: {
      trackedTokens: tokens.length,
      linkedTokens: linked.length,
      freshMarket,
      staleOrUnknownMarket,
      scorePass,
      qualityPass,
      opportunityEligible,
      pipeline,
      qualifiedButStaleMarket,
      qualifiedButStaleMarketMetrics,
      qualifiedButStaleEvidence,
      qualifiedButOutsideTopFive,
      qualifiedButMissingFactors,
      qualifiedButUnverifiedDemand,
      qualifiedButUnverifiedExit,
      evidenceFallbackDexScreener:linked.filter(token=>assessOpportunityEvidence(token,now).transactionSource==='dexscreener_snapshot').length,
      watchEligible,
      critical,
      sourceStatus: {
        dexscreener: sources.dexscreener,
        solanaRpc: sources.solanaRpc || null,
        poolTradeRpc: sources.poolTradeRpc || null,
        dexMarket: sources.dexMarket || null,
        geckoTerminal: sources.geckoTerminal,
        pumpPortal: sources.pumpPortal,
        launchpadDiscovery: sources.launchpadDiscovery,
        xSocial: sources.xSocial,
        telegramSocial: sources.telegramSocial,
        bluesky: sources.bluesky,
        nostr: sources.nostr
      }
    },
    publication: {
      botConfigured: Boolean(this.bot),
      botRunning: Boolean(this.bot && typeof this.bot.isRunning === 'function' && this.bot.isRunning()),
      channels: channels.length,
      enabledChannels: enabledChannels.length,
      outbox: outboxCounts,
      configuredThreshold: Number(settings.minScore ?? 80),
      lastAlertThreshold: this.lastAlertThreshold || null,
      recentAlerts
    },
    rejectionReasons: Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    mostBlockedCandidates: candidates.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 10)
  };
}

module.exports = { scannerPublicationDiagnostics };
