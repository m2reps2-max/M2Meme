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

test('memory budget defers when resident memory is too close to the host limit',()=>{
 const original=process.memoryUsage;
 process.memoryUsage=()=>({heapUsed:60*1048576,external:5*1048576,rss:253*1048576});
 try{assert.equal(memoryBudget({maxHeapMiB:76,maxExternalMiB:20,maxRssMiB:252}).ok,false);}
 finally{process.memoryUsage=original;}
});

test('memory budget accepts RSS below the configured ceiling',()=>{
 const original=process.memoryUsage;
 process.memoryUsage=()=>({heapUsed:60*1048576,external:5*1048576,rss:248*1048576});
 try{assert.equal(memoryBudget({maxHeapMiB:76,maxExternalMiB:20,maxRssMiB:252}).ok,true);}
 finally{process.memoryUsage=original;}
});
