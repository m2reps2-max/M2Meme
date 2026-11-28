'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {setBoundedCache}=require('../lib/bounded-cache');

test('bounded cache evicts oldest entries and never exceeds its configured capacity',()=>{
 const cache=new Map();
 for(let i=0;i<10000;i++)setBoundedCache(cache,'mint-'+i,{posts:[{text:'x'.repeat(240)}]},400);
 assert.equal(cache.size,400);
 assert.equal(cache.has('mint-0'),false);
 assert.equal(cache.has('mint-9599'),false);
 assert.equal(cache.has('mint-9600'),true);
 assert.equal(cache.has('mint-9999'),true);
});

test('updating an existing cache key refreshes its insertion order',()=>{
 const cache=new Map([['a',1],['b',2],['c',3]]);
 setBoundedCache(cache,'a',4,3);
 setBoundedCache(cache,'d',5,3);
 assert.deepEqual([...cache.keys()],['c','a','d']);
 assert.equal(cache.get('a'),4);
});

test('bounded cache rejects non-map inputs',()=>{
 assert.throws(()=>setBoundedCache({},'x',1,10),/Map/);
});
