'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MemeScanner,buildRpcEndpoints}=require('../lib/scanner');

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
  const second=await MemeScanner.prototype.rpc.call(scanner,'getSlot',[]);
  assert.deepEqual(second,{value:42});
  assert.equal(calls.length,3,'le fournisseur en cooldown ne doit pas être rappelé immédiatement');
  assert.equal(calls[2],'https://fallback.example');
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

test('Helius is the primary RPC when configured, with custom and public fallbacks',()=>{
 const endpoints=buildRpcEndpoints({heliusApiKey:'test key/with+symbols',customRpcUrl:'https://custom.example/rpc'});
 assert.equal(endpoints.length,4);
 assert.equal(new URL(endpoints[0]).hostname,'mainnet.helius-rpc.com');
 assert.equal(new URL(endpoints[0]).searchParams.get('api-key'),'test key/with+symbols');
 assert.equal(endpoints[1],'https://custom.example/rpc');
 assert.equal(endpoints[2],'https://api.mainnet.solana.com');
 assert.equal(endpoints[3],'https://solana-rpc.publicnode.com');
});
test('RPC endpoints do not contain a Helius URL when no API key is configured',()=>{
 const endpoints=buildRpcEndpoints({heliusApiKey:'',customRpcUrl:''});
 assert.deepEqual(endpoints,['https://api.mainnet.solana.com','https://solana-rpc.publicnode.com']);
});


test('token security metadata reports the RPC provider actually used',async()=>{
 const original=global.fetch;
 global.fetch=async()=>{throw new Error('unexpected network request');};
 try{
  const mintData=Buffer.alloc(82);
  mintData[44]=9;mintData[45]=1;
  const scanner={state:{sources:{solanaRpc:{endpoint:'mainnet.helius-rpc.com'}}},rpc:async(method)=>{
   if(method==='getAccountInfo')return {value:{data:[mintData.toString('base64')],owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}};
   if(method==='getTokenLargestAccounts')return {value:[]};
   if(method==='getTokenSupply')return {value:{amount:'100',uiAmountString:'100'}};
   throw new Error('unexpected RPC method '+method);
  }};
  const result=await MemeScanner.prototype.inspectSecurity.call(scanner,{mint:'11111111111111111111111111111111'},{persist:false});
  assert.equal(result.provider,'Helius RPC');
  assert.equal(result.rpcEndpoint,'mainnet.helius-rpc.com');
 }finally{global.fetch=original;}
});
