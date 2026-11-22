'use strict';

const parseTime=value=>{
  const at=typeof value==='number'?value:Date.parse(value||'');
  return Number.isFinite(at)?at:null;
};

function detectBundleCandidates(walletTrades=[],tokens={}) {
  const byMint=new Map();
  for(const event of walletTrades||[]){
    if(event?.direction!=='buy'||!event.wallet||!event.mint)continue;
    const at=parseTime(event.at);
    if(at===null)continue;
    const rows=byMint.get(event.mint)||[];
    rows.push({...event,_at:at});
    byMint.set(event.mint,rows);
  }

  const candidates=[];
  const MAX_EVENTS_PER_MINT=300,MAX_CANDIDATES=200;
  const addCandidate=(mint,events,kind)=>{
    if(candidates.length>=MAX_CANDIDATES)return;
    const byWallet=new Map();
    for(const event of events){
      if(!byWallet.has(event.wallet))byWallet.set(event.wallet,event);
    }
    if(byWallet.size<3)return;
    const rows=[...byWallet.values()].sort((a,b)=>a._at-b._at);
    const confirmed=rows.filter(x=>x.swapConfirmed===true).length;
    const gecko=rows.filter(x=>x.source==='gecko_pool_sample'||x.role==='gecko_sample').length;
    candidates.push({
      id:mint+':'+kind+':'+rows.map(x=>x.wallet).sort().join(','),
      mint,
      symbol:tokens?.[mint]?.symbol||'—',
      kind,
      wallets:rows.map(x=>x.wallet),
      uniqueBuyers:rows.length,
      eventCount:events.length,
      confirmedRpcBuyers:confirmed,
      geckoSampleBuyers:gecko,
      firstAt:new Date(rows[0]._at).toISOString(),
      lastAt:new Date(rows[rows.length-1]._at).toISOString(),
      timeSpanMs:rows[rows.length-1]._at-rows[0]._at,
      slots:[...new Set(rows.map(x=>x.slot).filter(x=>x!==null&&x!==undefined))],
      evidence:confirmed>=3?'at_least_3_confirmed_rpc_buyers':gecko>=3?'gecko_pool_sample_only':'mixed_or_partial_sources',
      confidence:confirmed>=3?'observed_onchain_buyer_cluster':'bundle_like_temporal_cluster',
      warning:'Groupe candidat uniquement : achats synchronisés, même slot ou échantillon de pool ne prouvent ni bundle, ni contrôle commun, ni intention coordonnée.'
    });
  };

  for(const [mint,allEvents] of byMint){
    const events=allEvents.sort((a,b)=>a._at-b._at).slice(-MAX_EVENTS_PER_MINT);
    const bySlot=new Map();
    for(const event of events){
      if(event.slot===null||event.slot===undefined||!Number.isFinite(Number(event.slot)))continue;
      const key=String(event.slot);
      const rows=bySlot.get(key)||[];
      rows.push(event);
      bySlot.set(key,rows);
    }
    for(const rows of bySlot.values())if(new Set(rows.map(x=>x.wallet)).size>=3)addCandidate(mint,rows,'same_slot_cluster');

    let i=0;
    while(i<events.length){
      const start=events[i]._at;
      let end=i;
      while(end+1<events.length&&events[end+1]._at-start<=5000)end++;
      const window=events.slice(i,end+1);
      if(new Set(window.map(x=>x.wallet)).size>=3){
        addCandidate(mint,window,'five_second_burst');
        i=end+1;
      }else i++;
    }
  }

  const compact=[];
  for(const candidate of candidates){
    const duplicate=compact.find(existing=>existing.mint===candidate.mint&&
      existing.wallets.length===candidate.wallets.length&&
      existing.wallets.every(wallet=>candidate.wallets.includes(wallet))&&
      Math.abs(Date.parse(existing.firstAt)-Date.parse(candidate.firstAt))<=5000);
    if(duplicate){
      duplicate.kind=duplicate.kind===candidate.kind?duplicate.kind:'same_slot_and_time_burst';
      duplicate.eventCount=Math.max(duplicate.eventCount,candidate.eventCount);
      duplicate.confirmedRpcBuyers=Math.max(duplicate.confirmedRpcBuyers,candidate.confirmedRpcBuyers);
      duplicate.geckoSampleBuyers=Math.max(duplicate.geckoSampleBuyers,candidate.geckoSampleBuyers);
      duplicate.slots=[...new Set([...duplicate.slots,...candidate.slots])];
      if(duplicate.confirmedRpcBuyers>=3){duplicate.evidence='at_least_3_confirmed_rpc_buyers';duplicate.confidence='observed_onchain_buyer_cluster';}
    }else compact.push(candidate);
  }

  const recurrent=[];
  for(let i=0;i<compact.length;i++)for(let j=i+1;j<compact.length;j++){
    const a=compact[i],b=compact[j];
    if(a.mint===b.mint)continue;
    const shared=a.wallets.filter(wallet=>b.wallets.includes(wallet));
    if(shared.length<3)continue;
    recurrent.push({
      mints:[a.mint,b.mint],
      symbols:[a.symbol,b.symbol],
      sharedWallets:shared,
      sharedWalletCount:shared.length,
      evidence:'wallet_overlap_across_distinct_token_bursts',
      confidence:'recurrent_behavioral_candidate',
      warning:'Les mêmes wallets apparaissent dans plusieurs groupes d’achats rapprochés. Cela peut refléter une stratégie commune, un bot ou des conditions de marché; ce n’est pas une preuve de bundle.'
    });
  }

  return {
    candidates:compact.sort((a,b)=>b.uniqueBuyers-a.uniqueBuyers||a.timeSpanMs-b.timeSpanMs).slice(0,100),
    recurrentGroups:recurrent.sort((a,b)=>b.sharedWalletCount-a.sharedWalletCount).slice(0,50),
    summary:{
      bundleLikeCandidates:compact.length,
      sameSlotCandidates:compact.filter(x=>x.kind==='same_slot_cluster'||x.kind==='same_slot_and_time_burst').length,
      temporalBurstCandidates:compact.filter(x=>x.kind==='five_second_burst'||x.kind==='same_slot_and_time_burst').length,
      recurrentWalletGroups:recurrent.length
    },
    limitations:'Détection heuristique sur les transactions déjà observées et conservées. Les échantillons GeckoTerminal sont incomplets; les slots RPC peuvent être partiels. Un groupe de wallets n’est jamais assimilé automatiquement à un bundle confirmé.'
  };
}

module.exports={detectBundleCandidates};
