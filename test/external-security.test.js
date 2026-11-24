'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeGL1TCHReport}=require('../lib/external-security');

test('normalise un rapport GL1TCH sans supposer le sens du score',()=>{
 const x=normalizeGL1TCHReport({verdict:'CAUTION',score:73,confidence:'high',bottomLine:'Linked wallets detected',checks:[{name:'Linked wallets',status:'warning',reason:'Several holders share a funder'}]});
 assert.equal(x.verdict,'CAUTION');
 assert.equal(x.score,73);
 assert.equal(x.confidence,'high');
 assert.equal(x.checks[0].name,'Linked wallets');
 assert.equal(x.checks[0].details,'Several holders share a funder');
});

test('accepte un rapport imbriqué et borne les données affichées',()=>{
 const x=normalizeGL1TCHReport({report:{verdict:'LOW RISK',score:120,checks:Array.from({length:45},(_,i)=>({title:'Check '+i,message:'x'.repeat(700)}))}});
 assert.equal(x.score,100);
 assert.equal(x.checks.length,40);
 assert.equal(x.checks[0].details.length,500);
});

test('rejette un payload sans rapport exploitable',()=>{
 assert.equal(normalizeGL1TCHReport({error:'unavailable'}),null);
});


test('refuse une réponse GL1TCH qui dépasse la limite de lecture',async()=>{
 const {inspectExternalSecurity}=require('../lib/external-security');
 const token={mint:'BoundedExternalSecurityMint111111111111111'};
 const originalFetch=global.fetch;
 global.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>'x'.repeat(300000)});
 try{
  const result=await inspectExternalSecurity(token);
  assert.equal(result.status,'unavailable');
  assert.match(result.error,/volumineuse|limite/i);
 }finally{
  global.fetch=originalFetch;
 }
});
