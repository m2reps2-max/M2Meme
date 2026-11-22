'use strict';

const {buildWalletReputation}=require('./wallet-reputation');
const {buildWalletTokenSignals}=require('./wallet-token-signals');

function buildHeliusWalletSnapshot(state={},rpcStatus={},now=Date.now()){
 const reputation=buildWalletReputation(state,now);
 const tracked=new Map();
 for(const row of state.wallets||[])if(row?.address)tracked.set(row.address,{address:row.address,label:row.label||'Wallet manuel',role:'manual'});
 for(const row of state.autoWallets||[])if(row?.address)tracked.set(row.address,{address:row.address,label:row.label||'Acheteur précoce',role:'early_buyer'});
 for(const token of Object.values(state.tokens||{})){
  if(token.creatorObservedAtLaunch===true&&token.creator){
   const prior=tracked.get(token.creator)||{address:token.creator,label:'Créateur observé',role:'creator'};
   prior.role='creator';tracked.set(token.creator,prior);
  }
 }
 const rows=reputation.wallets.map(row=>{
  const meta=tracked.get(row.address)||{address:row.address,label:row.label||'Wallet observé',role:'observed'};
  return {...row,wallet:row.address,name:meta.label,role:meta.role};
 });
 const recentTrades=(state.walletTrades||[]).slice(-30).reverse().map(event=>({
  wallet:event.wallet,mint:event.mint,action:event.direction,tokenAmount:event.tokenAmount,
  quoteAsset:event.quoteSpent?.asset||event.quoteReceived?.asset||null,
  quoteAmount:event.quoteSpent?.amount||event.quoteReceived?.amount||null,
  at:event.at,confirmed:event.swapConfirmed===true,role:event.role||'tracked_wallet'
 }));
 const tokenSignals=buildWalletTokenSignals(state,now);
 const source={
  configured:Boolean(rpcStatus.heliusConfigured),
  connected:Boolean(rpcStatus.connected&&rpcStatus.heliusConfigured),
  provider:'Helius RPC',
  endpoint:rpcStatus.endpoint||null,
  mode:rpcStatus.heliusConfigured?'Helius prioritaire pour signatures et transactions, RPC publics en secours':'Clé HELIUS_API_KEY absente : RPC publics de secours',
  error:rpcStatus.error||null,
  lastSuccess:rpcStatus.lastSuccess||null
 };
 return {
  configured:source.configured,source,provider:'Helius RPC',
  updatedAt:recentTrades[0]?.at||null,
  expertCount:rows.length,tradeCount:(state.walletTrades||[]).length,
  experts:rows.slice(0,50),recentTrades,
  tokenSignals,
  summary:{
   trackedWallets:tracked.size,rankedWallets:rows.length,
   confirmedSwaps:reputation.summary.confirmedSwapEvents,
   closedPositions:reputation.summary.closedPositions,
   highConfidence:reputation.summary.highConfidence,
   tokensWithConvergence:Object.values(tokenSignals).filter(x=>x.qualified).length
  },
  methodology:'Wallets manuels, acheteurs précoces observés et créateurs suivis par le scanner. Les signatures et transactions sont collectées via le RPC Helius prioritaire, avec RPC publics en secours. Les performances sont reconstruites uniquement à partir des swaps confirmés observés depuis le début du suivi; aucun classement KOL externe ni identité sociale supposée.'
 };
}

module.exports={buildHeliusWalletSnapshot};
