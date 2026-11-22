'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MemeScanner}=require('../lib/scanner');

test('RPC manager switches provider after a rate limit and remembers the working endpoint',async()=>{
 const original=global.fetch;
 const calls=[];
 global.fetch=async(url)=>{
  calls.push(String(url));
  if(String(url).includes('primary.example'))return {ok:false,status:429,statusText:'Too Many Requests',text:async()=>JSON.stringify({message:'rate limited'})};
  return {ok:true,status:200,statusText:'OK',text:async()=>JSON.stringify({jsonrpc:'2.0',result:{value:42}})};
 };
 try{
  const scanner={rpcEndpoints:['https://primary.example','https://fallback.example'],rpcProviderIndex:0,rpcProviderBackoff:new Map(),state:{sources:{}}};
  const result=await MemeScanner.prototype.rpc.call(scanner,'getSlot',[]);
  assert.deepEqual(result,{value:42});
  assert.equal(calls.length,2);
  assert.equal(scanner.rpcProviderIndex,1);
  assert.equal(scanner.state.sources.solanaRpc.endpoint,'fallback.example');
  assert.equal(scanner.state.sources.solanaRpcProviders['primary.example'].ok,false);
  assert.equal(scanner.state.sources.solanaRpcProviders['fallback.example'].ok,true);
 }finally{global.fetch=original;}
});

test('RPC application errors do not trigger failover to another provider',async()=>{
 const original=global.fetch;
 let calls=0;
 global.fetch=async()=>{
  calls++;
  return {ok:true,status:200,statusText:'OK',text:async()=>JSON.stringify({jsonrpc:'2.0',error:{code:-32602,message:'Invalid params'}})};
 };
 try{
  const scanner={rpcEndpoints:['https://primary.example','https://fallback.example'],rpcProviderIndex:0,rpcProviderBackoff:new Map(),state:{sources:{}}};
  await assert.rejects(()=>MemeScanner.prototype.rpc.call(scanner,'getAccountInfo',[]),/Invalid params/);
  assert.equal(calls,1);
 }finally{global.fetch=original;}
});
