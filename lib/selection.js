'use strict';

function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function linked(token){return Boolean(token?.pairAddress||token?.geckoPoolAddress);}
function factorSet(token,keys){const factors=token?.analysis?.factors||{};return keys.every(key=>finite(factors[key]));}
function rank(a,b){
 return Number(b.analysis?.score||0)-Number(a.analysis?.score||0)
  ||Number(b.liquidityUsd||0)-Number(a.liquidityUsd||0)
  ||Number(b.volume?.h1||0)-Number(a.volume?.h1||0);
}
function card(token){
 const a=token.analysis||{};
 return {
  mint:token.mint,name:token.name,symbol:token.symbol,
  pairAddress:token.pairAddress||null,geckoPoolAddress:token.geckoPoolAddress||null,
  liquidityUsd:finite(token.liquidityUsd)?token.liquidityUsd:null,
  volume:{h1:finite(token.volume?.h1)?token.volume.h1:null},
  txns:{h1:{buys:finite(token.txns?.h1?.buys)?token.txns.h1.buys:null,sells:finite(token.txns?.h1?.sells)?token.txns.h1.sells:null}},
  analysis:{
   score:finite(a.score)?a.score:null,coverage:finite(a.coverage)?a.coverage:0,
   risk:a.risk||'unknown',securityComprehensive:a.securityComprehensive===true,
   hardBlocked:a.hardBlocked===true,
   factors:Object.fromEntries(['activity','momentum','market','liquidityQuality','security'].filter(k=>finite(a.factors?.[k])).map(k=>[k,a.factors[k]]))
  }
 };
}
function buildSelection(input){
 const all=Array.isArray(input)?input:Object.values(input||{});
 const eligible=all.filter(linked);
 const candidates=eligible.filter(t=>!t.analysis?.hardBlocked&&t.analysis?.risk!=='high'&&t.analysis?.risk!=='unknown');
 const best=candidates.filter(t=>
  Number(t.analysis?.coverage||0)>=80
  &&Number(t.analysis?.score||0)>=68
  &&Number(t.liquidityUsd||0)>=10000
  &&Number(t.volume?.h1||0)>=1000
  &&Number(t.txns?.h1?.buys||0)+Number(t.txns?.h1?.sells||0)>=10
  &&t.analysis?.securityComprehensive===true
  &&t.analysis?.risk==='observations_only'
  &&factorSet(t,['activity','momentum','market','liquidityQuality','security'])
 ).sort(rank).slice(0,5);
 const selected=new Set(best.map(t=>t.mint));
 const observe=candidates.filter(t=>!selected.has(t.mint)
  &&Number(t.analysis?.coverage||0)>=65
  &&Number(t.analysis?.score||0)>=58
  &&Number(t.liquidityUsd||0)>=5000
  &&Number(t.volume?.h1||0)>0
  &&factorSet(t,['market','security'])
 ).sort(rank).slice(0,5);
 return {best:best.map(card),observe:observe.map(card),eligible:eligible.length,considered:all.length};
}
module.exports={buildSelection};
