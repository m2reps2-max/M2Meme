'use strict';

const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_EVENTS=5000;
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const at=value=>{const parsed=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(parsed)?parsed:null;};
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,value));

function buildEliteIntelligenceIndex(state={}) {
  const tokens=state.tokens&&typeof state.tokens==='object'?state.tokens:{};
  const trades=(Array.isArray(state.walletTrades)?state.walletTrades:[]).slice(-MAX_EVENTS);
  const byMint=new Map(),walletMints=new Map(),funderMints=new Map();
  for(const event of trades){
    // GeckoTerminal pool samples are useful for market microstructure, but are not
    // RPC-confirmed wallet transactions and must not build wallet reputation links.
    if(!event||event.swapConfirmed!==true||!WALLET_RE.test(String(event.wallet||''))||!event.mint||!['buy','sell'].includes(event.direction))continue;
    const time=at(event.at);if(time===null)continue;
    const rows=byMint.get(event.mint)||[];
    rows.push({wallet:event.wallet,direction:event.direction,at:time,slot:event.slot??null,signature:event.signature||null,swapConfirmed:event.swapConfirmed===true,source:event.source||null});
    byMint.set(event.mint,rows);
    if(event.direction==='buy'){
      const mints=walletMints.get(event.wallet)||new Set();mints.add(event.mint);walletMints.set(event.wallet,mints);
    }
  }
  for(const token of Object.values(tokens)){
    const funder=token?.creatorFunding?.funder;
    if(!WALLET_RE.test(String(funder||''))||!token?.mint)continue;
    const mints=funderMints.get(funder)||new Set();mints.add(token.mint);funderMints.set(funder,mints);
  }
  return {tokens,byMint,walletMints,funderMints,tradeEvents:trades.length};
}

function analyzeOrganicDemand(token,index={},now=Date.now()) {
  const rows=(Array.isArray(token?.tradeIntel?.observedTrades)?token.tradeIntel.observedTrades:[])
    .map(row=>({wallet:row?.wallet,direction:row?.direction,at:at(row?.at),volumeUsd:n(row?.volumeUsd),slot:row?.slot??null}))
    .filter(row=>WALLET_RE.test(String(row.wallet||''))&&['buy','sell'].includes(row.direction)&&row.at!==null&&row.at<=now+60000)
    .slice(-300);
  const buyers=new Set(rows.filter(x=>x.direction==='buy').map(x=>x.wallet));
  const sellers=new Set(rows.filter(x=>x.direction==='sell').map(x=>x.wallet));
  const overlap=[...buyers].filter(wallet=>sellers.has(wallet));
  const roundTrips=new Set();
  const byWallet=new Map();
  for(const row of rows){const list=byWallet.get(row.wallet)||[];list.push(row);byWallet.set(row.wallet,list);}
  for(const [wallet,events] of byWallet){
    events.sort((a,b)=>a.at-b.at);
    let lastBuy=null;
    for(const event of events){
      if(event.direction==='buy')lastBuy=event;
      else if(lastBuy&&event.at-lastBuy.at<=10*60*1000&&event.at>=lastBuy.at){roundTrips.add(wallet);lastBuy=null;}
    }
  }
  const amounts=rows.filter(x=>x.volumeUsd>0).map(x=>Math.round(x.volumeUsd*10)/10);
  const amountCounts=new Map();for(const amount of amounts)amountCounts.set(amount,(amountCounts.get(amount)||0)+1);
  const repeatedAmounts=[...amountCounts.values()].filter(count=>count>=4).reduce((sum,count)=>sum+count,0);
  const repeatedAmountShare=amounts.length?repeatedAmounts/amounts.length:0;
  const overlapRatio=buyers.size?overlap.length/buyers.size:0;
  const shortRoundTripShare=buyers.size?roundTrips.size/buyers.size:0;
  const sampleComplete=token?.tradeIntel?.earlyWindow?.complete===true;
  const capped=Number(token?.tradeIntel?.tradeCount)>=300;
  const sample=rows.length;
  const reasons=[];
  let risk=0;
  if(sample>=20&&overlap.length>=4&&overlapRatio>=0.45){risk+=Math.min(35,Math.round(overlapRatio*35));reasons.push('Plusieurs mêmes wallets apparaissent comme acheteurs et vendeurs dans l’échantillon.');}
  if(sample>=30&&repeatedAmountShare>=0.35){risk+=Math.min(20,Math.round(repeatedAmountShare*20));reasons.push('Montants de transactions répétés de façon inhabituelle dans l’échantillon.');}
  const bundles=Number(token?.tradeIntel?.sameBlockBuyerClusters)||0;
  if(sample>=20&&bundles>=3){risk+=Math.min(15,bundles*3);reasons.push('Plusieurs groupes d’achats synchronisés sont observés; cela ne prouve pas une manipulation.');}
  const confidence=sample>=60&&!capped?'moderate':sample>=20?'low':'insufficient';
  const reliableFastRoundTrips=confidence==='moderate'&&sample>=60&&roundTrips.size>=5&&shortRoundTripShare>=0.45;
  if(reliableFastRoundTrips)reasons.push('Plusieurs acheteurs distincts ont revendu dans les dix minutes suivant leur achat; signal de rotation rapide, pas preuve de wash trading.');
  if(!sample)reasons.push('Aucun échantillon de transactions exploitable.');
  if(capped)reasons.push('Échantillon possiblement tronqué par la limite de 300 transactions.');
  if(!sampleComplete)reasons.push('Fenêtre initiale non certifiée complète.');
  const score=sample?Math.round(clamp(100-risk)):null;
  const adjustment=confidence==='moderate'&&risk>=45?-Math.min(5,Math.ceil((risk-30)/12)):reliableFastRoundTrips?-2:confidence==='low'&&risk>=65?-2:0;
  return {status:sample>=20?'observed':'insufficient_data',sampleSize:sample,uniqueBuyers:buyers.size,uniqueSellers:sellers.size,buyerSellerOverlap:overlap.length,buyerSellerOverlapPct:buyers.size?Number((overlapRatio*100).toFixed(1)):null,shortRoundTripWallets:roundTrips.size,shortRoundTripSharePct:Number((shortRoundTripShare*100).toFixed(1)),repeatedAmountSharePct:Number((repeatedAmountShare*100).toFixed(1)),sameBlockBuyerClusters:bundles,score,confidence,adjustment,reasons,limitations:'Analyse heuristique d’un échantillon public. Les achats/ventes répétés et montants similaires peuvent être légitimes; ce résultat n’est jamais une preuve de wash trading.'};
}

function analyzeWalletNetwork(token,index={}) {
  const own=new Set((index.byMint?.get(token?.mint)||[]).filter(x=>x.direction==='buy').map(x=>x.wallet));
  const recurrent=[];
  for(const [wallet,mints] of index.walletMints||[]){
    if(!own.has(wallet))continue;
    const others=[...mints].filter(mint=>mint!==token.mint);
    if(others.length)recurrent.push({wallet,otherTokenCount:others.length});
  }
  const repeatedWallets=recurrent.length;
  const sharedFunder=token?.creatorFunding?.funder||null;
  const funderTokenCount=sharedFunder?index.funderMints?.get(sharedFunder)?.size||1:0;
  const reasons=[];
  if(repeatedWallets>=3)reasons.push(repeatedWallets+' acheteurs observés sont également présents sur d’autres tokens suivis.');
  if(funderTokenCount>=2)reasons.push('Le financeur direct observé du créateur apparaît sur '+funderTokenCount+' lancements suivis.');
  const confidence=repeatedWallets>=5||funderTokenCount>=3?'moderate':repeatedWallets>=2||funderTokenCount>=2?'low':'insufficient';
  const risk=clamp((repeatedWallets>=3?Math.min(35,repeatedWallets*4):0)+(funderTokenCount>=2?Math.min(35,(funderTokenCount-1)*12):0));
  return {status:own.size?'observed':'insufficient_data',trackedBuyers:own.size,recurrentWallets:repeatedWallets,sharedCreatorFunder:Boolean(funderTokenCount>=2),funderLaunchCount:funderTokenCount,confidence,riskScore:risk,adjustment:confidence==='moderate'&&risk>=55?-3:0,reasons,limitations:'Les wallets peuvent être des traders actifs ou des services partagés. Un chevauchement comportemental ne démontre pas une identité ou une coordination.'};
}

function analyzeHolderAndTokenSecurity(token) {
  const data=token?.security?.data||{};
  const known=data.ownerConcentrationAvailable===true;
  const top10=known&&Number.isFinite(Number(data.top10HolderPercent))?Number(data.top10HolderPercent):null;
  const top1=known&&Number.isFinite(Number(data.top1OwnerPercent))?Number(data.top1OwnerPercent):null;
  const unknownOwners=Math.max(0,n(data.unknownOwnerAccounts));
  const sampleAccounts=Math.max(0,n(data.holderSampleAccounts));
  const token2022=data.isToken2022===true;
  const extensionsReviewed=data.token2022ExtensionsReviewed===true||data.extensionsReviewed===true;
  const reasons=[];
  if(!known)reasons.push('Concentration réelle des propriétaires non confirmée; l’échantillon RPC peut être incomplet.');
  if(top10!==null&&top10>=70)reasons.push('Concentration élevée parmi les dix plus gros propriétaires observés.');
  if(top1!==null&&top1>=20)reasons.push('Un seul propriétaire observé détient une part importante de la supply.');
  if(token2022&&!extensionsReviewed)reasons.push('Token-2022 détecté, mais les extensions ne sont pas toutes vérifiées.');
  const complete=Boolean(token?.security?.checkedAt&&known&&sampleAccounts>=5&&unknownOwners===0&&(!token2022||extensionsReviewed));
  return {status:complete?'reviewed':token?.security?.checkedAt?'partial':'not_checked',ownerConcentrationAvailable:known,top10HolderPercent:top10,top1OwnerPercent:top1,sampleAccounts,unknownOwners,token2022,extensionsReviewed,complete,reasons,limitations:'Le RPC public ne fournit ici qu’un échantillon des principaux comptes. Les comptes de pool, burn, programme et bénéficiaires liés doivent être identifiés avant toute conclusion sur la concentration.'};
}

function analyzeLearningValidation(learning={}) {
  const out=learning?.outOfSample||{};
  const validation=out.validation||{},holdout=out.holdoutAtSelectedThreshold||{};
  const checks={
    chronologicalHoldout:out.status==='holdout_available',
    validationSample:Number(validation.tokens)>=20,
    selectedSample:Number(holdout.tokens)>=20,
    positiveRate:Number(holdout.positive15Pct)>=55,
    positiveAverage:Number(holdout.averageReturnPct)>0,
    lossRate:Number(holdout.loss20Pct)<=25
  };
  const validated=Object.values(checks).every(Boolean);
  return {status:validated?'validated':out.status||'insufficient_data',validated,checks,validationTokens:n(validation.tokens),selectedTokens:n(holdout.tokens),positive15Pct:Number.isFinite(Number(holdout.positive15Pct))?Number(holdout.positive15Pct):null,averageReturnPct:Number.isFinite(Number(holdout.averageReturnPct))?Number(holdout.averageReturnPct):null,loss20Pct:Number.isFinite(Number(holdout.loss20Pct))?Number(holdout.loss20Pct):null,selectedThreshold:Number.isFinite(Number(out.selectedThreshold))?Number(out.selectedThreshold):null,autoWeightTraining:false,note:'La validation existante est conservée. Aucun poids ni seuil n’est modifié automatiquement par ce module.'};
}

function buildDiscoveryCoverage(state={}) {
  const sources=state.sources||{};
  const sourceStatus=key=>{const row=sources[key]||{};return row.ok===true||row.connected===true?'connected':row.error?'degraded':'unknown';};
  const monitored=[
    {key:'pumpPortal',label:'Pump.fun via PumpPortal',status:sourceStatus('pumpPortal')},
    {key:'launchpadDiscovery',label:'Raydium LaunchLab et Meteora DBC via RPC',status:sourceStatus('launchpadDiscovery')},
    {key:'geckoTerminal',label:'Nouveaux pools GeckoTerminal',status:sourceStatus('geckoTerminal')},
    {key:'dexscreener',label:'Indexation DEX Screener',status:sourceStatus('dexscreener')}
  ];
  const notIntegrated=['Heaven','Pangea','kids.fun','Boop (programme indépendant)'];
  return {status:'partial',monitored,notIntegrated,coverageNote:'Les plateformes non intégrées restent explicitement hors couverture. Ne pas les considérer comme surveillées avant l’ajout et la validation de leurs vrais programmes/API.'};
}

function evaluateEliteIntelligence(token,state={},index=null,learning={}) {
  const built=index||buildEliteIntelligenceIndex(state);
  const organicDemand=analyzeOrganicDemand(token,built);
  const walletNetwork=analyzeWalletNetwork(token,built);
  const holderSecurity=analyzeHolderAndTokenSecurity(token);
  const learningValidation=analyzeLearningValidation(learning);
  const discovery=buildDiscoveryCoverage(state);
  const adjustment=organicDemand.adjustment+walletNetwork.adjustment;
  const flags=[];
  if(organicDemand.adjustment<0)flags.push({level:'warning',code:'ELITE_ORGANIC_DEMAND_SUSPECT',message:'Signaux comportementaux suspects dans l’échantillon de transactions; vérification manuelle recommandée.'});
  if(walletNetwork.sharedCreatorFunder)flags.push({level:'warning',code:'ELITE_RECURRENT_CREATOR_FUNDER',message:'Financeur direct commun observé sur plusieurs lancements; ce lien n’établit pas une coordination.'});
  if(holderSecurity.token2022&&!holderSecurity.extensionsReviewed)flags.push({level:'warning',code:'ELITE_TOKEN2022_EXTENSIONS_UNKNOWN',message:'Token-2022 détecté sans vérification complète des extensions.'});
  return {version:1,adjustment,phases:{organicDemand,walletNetwork,holderSecurity,learningValidation,discovery},flags,generatedAt:new Date().toISOString()};
}

function buildEliteIntelligenceIndexSummary(state={},learning={}) {
  const index=buildEliteIntelligenceIndex(state);
  const tokens=Object.values(index.tokens);
  const inspected=tokens.filter(token=>token?.tradeIntel?.observedTrades?.length);
  const suspicious=inspected.filter(token=>analyzeOrganicDemand(token,index).adjustment<0).length;
  return {version:1,phases:{organicDemand:{status:'active',tokensWithTradeSamples:inspected.length,suspiciousCandidates:suspicious},walletNetwork:{status:'active',trackedWalletEvents:index.tradeEvents,trackedWallets:index.walletMints.size},holderSecurity:{status:'active',tokensWithSecurity:tokens.filter(token=>token?.security?.checkedAt).length},learningValidation:analyzeLearningValidation(learning),discovery:buildDiscoveryCoverage(state)},limitations:'Les phases utilisent uniquement les données réellement disponibles. Les sources manquantes restent inconnues; les nouvelles plateformes ne sont pas déclarées couvertes.'};
}

module.exports={buildEliteIntelligenceIndex,analyzeOrganicDemand,analyzeWalletNetwork,analyzeHolderAndTokenSecurity,analyzeLearningValidation,buildDiscoveryCoverage,evaluateEliteIntelligence,buildEliteIntelligenceIndexSummary};
