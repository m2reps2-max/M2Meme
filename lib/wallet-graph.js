'use strict';

const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const { detectBundleCandidates } = require('./wallet-bundles');

const time = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
};

function walletGraphIntel() {
  const state = this.state || {};
  const nodes = new Map();
  const addNode = (address, metadata = {}) => {
    if (!address) return;
    const current = nodes.get(address) || { address, roles: [], labels: [], tokens: new Set(), firstSeenAt: null };
    for (const role of metadata.roles || []) if (!current.roles.includes(role)) current.roles.push(role);
    if (metadata.label && !current.labels.includes(metadata.label)) current.labels.push(metadata.label);
    for (const mint of metadata.tokens || []) current.tokens.add(mint);
    if (metadata.firstSeenAt && (!current.firstSeenAt || time(metadata.firstSeenAt) < time(current.firstSeenAt))) current.firstSeenAt = metadata.firstSeenAt;
    nodes.set(address, current);
  };

  for (const wallet of state.wallets || []) addNode(wallet.address, { roles: ['manual'], label: wallet.label, firstSeenAt: wallet.addedAt });
  for (const wallet of state.autoWallets || []) addNode(wallet.address, { roles: ['early_buyer'], label: wallet.label, tokens: wallet.sourceMints || [wallet.sourceMint].filter(Boolean), firstSeenAt: wallet.discoveredAt });
  const creatorFunding = new Map();
  for (const token of Object.values(state.tokens || {})) {
    if (token.creatorObservedAtLaunch === true && token.creator) {
      addNode(token.creator, { roles: ['creator'], tokens: [token.mint], firstSeenAt: token.pumpCreatedAt || token.firstSeenAt });
      const funder = token.creatorFunding?.funder;
      if (funder) {
        addNode(funder, { roles: ['observed_funder'] });
        const creators = creatorFunding.get(funder) || new Map();
        creators.set(token.creator, { creator: token.creator, mint: token.mint, symbol: token.symbol || '—', sol: token.creatorFunding.sol ?? null, checkedAt: token.creatorFunding.checkedAt || null });
        creatorFunding.set(funder, creators);
      }
    }
  }

  const edges = new Map();
  const pairKey = (a, b) => [a, b].sort().join('|');
  const getEdge = (a, b) => {
    if (!a || !b || a === b) return null;
    const key = pairKey(a, b);
    if (!edges.has(key)) edges.set(key, { id: key, from: [a, b].sort()[0], to: [a, b].sort()[1], sameSlotEvents: 0, closeBuyWindows: 0, distinctMints: new Set(), examples: [], sharedFunders: new Set() });
    return edges.get(key);
  };

  for (const [funder, creators] of creatorFunding) {
    const list = [...creators.keys()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const edge = getEdge(list[i], list[j]);
      edge.sharedFunders.add(funder);
      edge.examples.push({ type: 'shared_creator_funder', funder, first: creators.get(list[i]), second: creators.get(list[j]) });
    }
  }

  const buysByMint = new Map();
  for (const event of state.walletTrades || []) {
    if (event.direction !== 'buy' || !event.wallet || !event.mint) continue;
    addNode(event.wallet, { roles: ['observed_buyer'], tokens: [event.mint] });
    const at = time(event.at);
    if (at === null) continue;
    const list = buysByMint.get(event.mint) || [];
    list.push({ wallet: event.wallet, mint: event.mint, at, slot: event.slot ?? null, signature: event.signature || null });
    buysByMint.set(event.mint, list);
  }

  for (const [mint, events] of buysByMint) {
    events.sort((a, b) => a.at - b.at);
    const recent = [];
    for (const event of events) {
      while (recent.length && event.at - recent[0].at > 15000) recent.shift();
      for (const previous of recent) {
        if (previous.wallet === event.wallet) continue;
        const edge = getEdge(previous.wallet, event.wallet);
        if (!edge) continue;
        edge.closeBuyWindows++;
        edge.distinctMints.add(mint);
        if (previous.slot !== null && event.slot !== null && previous.slot === event.slot) edge.sameSlotEvents++;
        if (edge.examples.length < 12) edge.examples.push({ type: previous.slot !== null && previous.slot === event.slot ? 'same_slot_buy' : 'close_buy', mint, symbol: state.tokens?.[mint]?.symbol || '—', firstAt: new Date(previous.at).toISOString(), secondAt: new Date(event.at).toISOString(), slot: event.slot });
      }
      recent.push(event);
    }
  }

  const edgeRows = [...edges.values()].map(edge => {
    const sharedFunderCount = edge.sharedFunders.size;
    const distinctMints = edge.distinctMints.size;
    const score = Math.min(100, (sharedFunderCount ? 75 + Math.min(15, (sharedFunderCount - 1) * 5) : 0) + Math.min(15, edge.sameSlotEvents * 5) + Math.min(30, Math.max(0, edge.closeBuyWindows - edge.sameSlotEvents) * 10) + Math.min(20, Math.max(0, distinctMints - 1) * 10));
    const classification = sharedFunderCount ? 'shared_creator_funder' : distinctMints >= 2 && edge.closeBuyWindows >= 2 ? 'repeated_co_buy_pattern' : edge.sameSlotEvents > 0 ? 'same_slot_only' : 'single_close_buy';
    const confidence = sharedFunderCount ? 'strong_evidence_of_shared_funding' : distinctMints >= 2 && edge.closeBuyWindows >= 2 ? 'moderate_behavioral_signal' : 'weak_temporal_signal';
    return { id: edge.id, from: edge.from, to: edge.to, score, classification, confidence, sharedFunderCount, sameSlotEvents: edge.sameSlotEvents, closeBuyWindows: edge.closeBuyWindows, distinctMints, sharedFunders: [...edge.sharedFunders], examples: edge.examples.slice(0, 8), warning: sharedFunderCount ? 'Financement direct commun observé pour des wallets créateurs. Cela ne prouve pas à lui seul un contrôle commun.' : 'Proximité comportementale uniquement. Des achats indépendants peuvent être synchronisés par le marché.' };
  }).sort((a, b) => b.score - a.score || b.distinctMints - a.distinctMints);

  const parent = new Map([...nodes.keys()].map(address => [address, address]));
  const find = address => { let root = address; while (parent.get(root) !== root) root = parent.get(root); while (parent.get(address) !== address) { const next = parent.get(address); parent.set(address, root); address = next; } return root; };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (const edge of edgeRows) if (edge.sharedFunderCount || edge.confidence === 'moderate_behavioral_signal') join(edge.from, edge.to);
  const groups = new Map();
  for (const edge of edgeRows) {
    if (!edge.sharedFunderCount && edge.confidence !== 'moderate_behavioral_signal') continue;
    const root = find(edge.from), group = groups.get(root) || { members: new Set(), edges: [], strongEdges: 0, behavioralEdges: 0 };
    group.members.add(edge.from); group.members.add(edge.to); group.edges.push(edge);
    if (edge.sharedFunderCount) group.strongEdges++; else group.behavioralEdges++;
    groups.set(root, group);
  }
  const clusters = [...groups.values()].filter(group => group.members.size >= 2).map(group => ({
    members: [...group.members].map(address => ({ address, roles: nodes.get(address)?.roles || [], tokensObserved: nodes.get(address)?.tokens.size || 0 })),
    walletCount: group.members.size,
    edgeCount: group.edges.length,
    strongFundingLinks: group.strongEdges,
    repeatedBehaviorLinks: group.behavioralEdges,
    confidence: group.strongEdges ? 'strong_funding_evidence' : 'moderate_behavioral_pattern',
    edges: group.edges,
    warning: group.strongEdges ? 'Au moins un lien de financement direct est observé. Une source de financement commune peut être un service partagé.' : 'Groupe comportemental candidat, pas une preuve de bundle ni de propriété commune.'
  })).sort((a, b) => b.strongFundingLinks - a.strongFundingLinks || b.walletCount - a.walletCount);

  const bundleIntel=detectBundleCandidates(state.walletTrades||[],state.tokens||{});

  return {
    summary: { trackedWallets: nodes.size, observedBuyEvents: [...buysByMint.values()].reduce((sum, rows) => sum + rows.length, 0), candidateLinks: edgeRows.length, clusters: clusters.length, strongFundingLinks: edgeRows.filter(edge => edge.sharedFunderCount).length, weakTemporalLinks: edgeRows.filter(edge => edge.confidence === 'weak_temporal_signal').length, bundleLikeCandidates:bundleIntel.summary.bundleLikeCandidates, recurrentWalletGroups:bundleIntel.summary.recurrentWalletGroups },
    nodes: [...nodes.values()].map(node => ({ ...node, tokens: [...node.tokens] })),
    edges: edgeRows.slice(0, 300),
    clusters: clusters.slice(0, 100),
    bundleCandidates:bundleIntel.candidates,
    recurrentWalletGroups:bundleIntel.recurrentGroups,
    bundleLimitations:bundleIntel.limitations,
    limitations: 'Le graphe ne voit que les wallets suivis et les transactions effectivement récupérées. Un même slot ou des achats proches ne prouvent pas une coordination. Les liens forts reposent sur un financeur commun observé pour des créateurs issus des événements de lancement; cela peut aussi être un service partagé.'
  };
}

module.exports = { walletGraphIntel };
