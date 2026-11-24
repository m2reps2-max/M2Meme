'use strict';

const { qualifyOpportunity, assessAlertFreshness, assessOpportunityEvidence } = require('./alert-quality');

function scannerPublicationDiagnostics() {
  const now = Date.now();
  const settings = this.state.scannerSettings || {};
  const tokens = Object.values(this.state.tokens || {});
  const linked = tokens.filter(token => Boolean(token.pairAddress || token.geckoPoolAddress));
  const reasonCounts = Object.create(null);
  const candidates = [];
  let freshMarket = 0;
  let staleOrUnknownMarket = 0;
  let scorePass = 0;
  let qualityPass = 0;
  let opportunityEligible = 0;
  let qualifiedButStaleMarket = 0;
  let qualifiedButStaleEvidence = 0;
  let watchEligible = 0;
  let qualifiedButMissingFactors = 0;
  let critical = 0;
  const requiredBestFactors = ['activity', 'market', 'liquidityQuality', 'security'];
  const factorLabels = { activity: 'activité', market: 'marché', liquidityQuality: 'qualité de liquidité', security: 'sécurité on-chain' };

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
    if(missingBestFactors.length){
      const reason='Facteurs requis incomplets : '+missingBestFactors.map(key=>factorLabels[key]||key).join(', ');
      reasonCounts[reason]=(reasonCounts[reason]||0)+1;
    }
    if (qualification.eligible && freshness.status === 'fresh' && evidenceFresh && factorsComplete && settings.publishOpportunities !== false) opportunityEligible++;
    else if (qualification.eligible && freshness.status !== 'fresh') qualifiedButStaleMarket++;
    else if (qualification.eligible && freshness.status === 'fresh' && !evidenceFresh) qualifiedButStaleEvidence++;
    else if (qualification.eligible && freshness.status === 'fresh' && evidenceFresh && !factorsComplete) qualifiedButMissingFactors++;
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
    if (!qualification.eligible || freshness.status !== 'fresh' || (qualification.eligible && freshness.status === 'fresh' && evidenceFresh && !factorsComplete)) {
      candidates.push({
        mint: token.mint,
        symbol: token.symbol || token.name || String(token.mint || '').slice(0, 8),
        score: Number.isFinite(Number(analysis.score)) ? Number(analysis.score) : null,
        coverage: Number.isFinite(Number(analysis.coverage)) ? Number(analysis.coverage) : null,
        freshness: freshness.status,
        freshnessAgeMinutes: freshness.ageMinutes,
        blockers: [
          ...(freshness.status !== 'fresh' ? [freshness.status === 'unknown' ? 'Aucun snapshot marché horodaté' : 'Snapshot marché trop ancien'] : []),
          ...qualification.reasons,
          ...(missingBestFactors.length ? ['Facteurs requis incomplets : '+missingBestFactors.map(key=>factorLabels[key]||key).join(', ')] : [])
        ].slice(0, 10)
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
    if (!freshMarket) diagnosis = 'Les snapshots marché sont absents ou trop anciens : les alertes sont supprimées avant publication.';
    else if (!opportunityEligible && qualifiedButStaleMarket) diagnosis = 'Des candidats passent les critères de qualité, mais leurs snapshots marché ont plus de 5 minutes : le rafraîchissement DEX doit être vérifié.';
    else if (!opportunityEligible && qualifiedButStaleEvidence) diagnosis = 'Des candidats passent les critères de marché, mais les contrôles de sécurité ou les transactions sont trop anciens : la rotation de ces analyses doit être vérifiée.';
    else if (!opportunityEligible && qualifiedButMissingFactors) diagnosis = 'Des candidats passent les critères de qualité et de fraîcheur, mais il manque un facteur obligatoire du classement principal : vérifier l’enrichissement de ces données.';
    else if (!opportunityEligible && !watchEligible && !critical) diagnosis = scorePass ? 'Des tokens atteignent le score minimum, mais les critères de liquidité, d’activité, de couverture ou de sécurité les bloquent; consulter les refus détaillés.' : 'Aucun token relié ne dépasse le score minimum configuré; vérifier la découverte et la qualité des données.';
    else if (!this.bot) diagnosis = 'Le moteur trouve potentiellement des signaux, mais aucun bot Telegram n’est initialisé (token absent/invalide).';
    else if (!enabledChannels.length) diagnosis = 'Le moteur fonctionne, mais aucun canal Telegram n’est activé.';
    else diagnosis = 'Des candidats ou signaux existent : vérifier la file Telegram et les erreurs par canal.';
  }
  if (this.bot && enabledChannels.length && outboxCounts.failed) {
    diagnosis = 'Des publications échouent dans la file Telegram : consulter les erreurs de la file et les droits du bot.';
  }

  return {
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
    scan: { running: this.running === true, lastScanAt, lastScanAgeMs, durationMs: this.state.lastScanDurationMs || null },
    discovery: {
      trackedTokens: tokens.length,
      linkedTokens: linked.length,
      freshMarket,
      staleOrUnknownMarket,
      scorePass,
      qualityPass,
      opportunityEligible,
      qualifiedButStaleMarket,
      qualifiedButStaleEvidence,
      qualifiedButMissingFactors,
      evidenceFallbackDexScreener:linked.filter(token=>assessOpportunityEvidence(token,now).transactionSource==='dexscreener_snapshot').length,
      watchEligible,
      critical,
      sourceStatus: {
        dexscreener: sources.dexscreener,
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
      lastAlertThreshold: this.lastAlertThreshold || null,
      recentAlerts
    },
    rejectionReasons: Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    mostBlockedCandidates: candidates.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 10)
  };
}

module.exports = { scannerPublicationDiagnostics };
