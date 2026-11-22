'use strict';
const MAX_WALLETS=15,MAX_TOKEN_OBSERVATIONS=20;
const n=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
function legacyObservations(wallet){
 const existing=Array.isArray(wallet.observations)?wallet.observations:[];
 if(existing.length)return existing;
 const mints=[...new Set([...(wallet.sourceMints||[]),wallet.sourceMint].filter(Boolean))];
 if(!mints.length)return [];
 const buys=n(wallet.buysObserved),volume=n(wallet.buyVolumeUsd);
 return mints.map(mint=>({mint,buys:buys/mints.length,buyVolumeUsd:volume/mints.length}));
}
function scoreWalletDiscovery(wallet){
 const observations=legacyObservations(wallet);
 const mints=new Set(observations.map(x=>x.mint).filter(Boolean));
 const buys=observations.reduce((sum,x)=>sum+n(x.buys),0);
 const volume=observations.reduce((sum,x)=>sum+n(x.buyVolumeUsd),0);
 const diversity=Math.min(35,Math.max(0,mints.size-1)*12);
 const activity=Math.min(20,Math.max(0,buys-2)*2.5);
 const size=Math.min(25,Math.log10(1+volume/150)*12);
 const recurrence=mints.size>=5?15:mints.size>=3?10:mints.size>=2?5:0;
 const score=Math.round(Math.min(100,20+diversity+activity+size+recurrence));
 const reasons=[];
 if(mints.size>=2)reasons.push('Acheteur précoce observé sur '+mints.size+' tokens distincts');
 if(buys>=4)reasons.push(buys+' achats précoces cumulés dans les fenêtres observées');
 if(volume>=500)reasons.push('Volume acheteur précoce cumulé : '+Math.round(volume)+' USD');
 if(mints.size<2)reasons.push('Un seul token observé : récidive non démontrée');
 return {discoveryScore:score,discoveryConfidence:mints.size>=3&&buys>=6?'échantillon limité':mints.size>=2&&buys>=4?'échantillon faible':'très préliminaire',discoveryReasons:reasons,tokensObserved:mints.size,buysObserved:buys,buyVolumeUsd:Number(volume.toFixed(2))};
}
function recordEarlyBuyerCandidates(currentWallets,token,buyers,now=new Date().toISOString()){
 const byAddress=new Map();
 for(const row of Array.isArray(currentWallets)?currentWallets:[])if(row&&typeof row.address==='string'&&row.address){row.observations=legacyObservations(row);byAddress.set(row.address,row);}
 let accepted=0;
 for(const buyer of Array.isArray(buyers)?buyers:[]){
  const address=typeof buyer?.wallet==='string'?buyer.wallet:'',buys=n(buyer?.buys),volume=n(buyer?.buyVolumeUsd);
  if(!address||buys<2||volume<150||address===token?.creator)continue;
  const mint=String(token?.mint||'');if(!mint)continue;
  const wallet=byAddress.get(address)||{address,label:'Acheteur précoce · '+(token?.symbol||'token'),sourceMint:mint,sourceMints:[],observations:[],discoveredAt:now,lastSeenAt:now};
  const prior=wallet.observations.find(x=>x.mint===mint);
  const observation={mint,symbol:token?.symbol||'—',buys:Math.max(buys,n(prior?.buys)),buyVolumeUsd:Number(Math.max(volume,n(prior?.buyVolumeUsd)).toFixed(2)),observedAt:now};
  if(prior)Object.assign(prior,observation);else wallet.observations.push(observation);
  wallet.observations=wallet.observations.slice(-MAX_TOKEN_OBSERVATIONS);
  wallet.sourceMints=[...new Set(wallet.observations.map(x=>x.mint))];
  wallet.sourceMint=wallet.sourceMint||mint;wallet.sourceSymbol=wallet.sourceSymbol||token?.symbol||'—';wallet.lastSeenAt=now;
  Object.assign(wallet,scoreWalletDiscovery(wallet));
  wallet.label=wallet.tokensObserved>=2?'Acheteur précoce récurrent · '+(wallet.sourceSymbol||'Solana'):'Acheteur précoce · '+(wallet.sourceSymbol||'token');
  byAddress.set(address,wallet);accepted++;
 }
 const wallets=[...byAddress.values()].map(wallet=>({...wallet,...scoreWalletDiscovery(wallet)}))
  .sort((a,b)=>b.discoveryScore-a.discoveryScore||b.tokensObserved-a.tokensObserved||Date.parse(b.lastSeenAt||0)-Date.parse(a.lastSeenAt||0)).slice(0,MAX_WALLETS);
 return {wallets,accepted,ranked:wallets.length};
}
module.exports={scoreWalletDiscovery,recordEarlyBuyerCandidates};
