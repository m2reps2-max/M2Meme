'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readTextLimited,readJsonLimited}=require('../lib/http-body');

test('bounded reader accepts a small streaming JSON body',async()=>{
 const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"ok":'));controller.enqueue(new TextEncoder().encode('true}'));controller.close();}});
 const response={headers:{get:()=>null},body};
 assert.deepEqual(await readJsonLimited(response,64),{ok:true});
});

test('bounded reader rejects a declared oversized body without reading it',async()=>{
 let reads=0;
 const response={headers:{get:()=> '1000'},body:{getReader(){reads++;throw new Error('should not read');}}};
 await assert.rejects(()=>readTextLimited(response,16),/trop volumineuse/);
 assert.equal(reads,0);
});

test('bounded reader cancels a stream when the byte limit is crossed',async()=>{
 let cancelled=false;
 const response={headers:{get:()=>null},body:{getReader(){return {read:async()=>({done:false,value:new Uint8Array(20)}),cancel:async()=>{cancelled=true;},releaseLock(){}};}}};
 await assert.rejects(()=>readTextLimited(response,10),/supérieure à la limite/);
 assert.equal(cancelled,true);
});

test('bounded reader supports lightweight response test doubles',async()=>{
 const response={headers:{get:()=>null},text:async()=>'{"x":1}'};
 assert.deepEqual(await readJsonLimited(response,32),{x:1});
});
