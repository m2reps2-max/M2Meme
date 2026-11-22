'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {memoryBudget}=require('../lib/scanner');

test('memory budget accepts a process below heap and external thresholds',()=>{
 const original=process.memoryUsage;
 process.memoryUsage=()=>({heapUsed:80*1048576,external:18*1048576});
 try{assert.equal(memoryBudget({maxHeapMiB:86,maxExternalMiB:24}).ok,true);}
 finally{process.memoryUsage=original;}
});

test('memory budget defers when JavaScript heap is too high',()=>{
 const original=process.memoryUsage;
 process.memoryUsage=()=>({heapUsed:90*1048576,external:10*1048576});
 try{assert.equal(memoryBudget({maxHeapMiB:86,maxExternalMiB:24}).ok,false);}
 finally{process.memoryUsage=original;}
});

test('memory budget defers when native buffers are too high',()=>{
 const original=process.memoryUsage;
 process.memoryUsage=()=>({heapUsed:60*1048576,external:25*1048576});
 try{assert.equal(memoryBudget({maxHeapMiB:86,maxExternalMiB:24}).ok,false);}
 finally{process.memoryUsage=original;}
});
