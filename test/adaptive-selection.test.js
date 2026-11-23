'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveAdaptiveSelectionThreshold}=require('../lib/selection');

test('selection threshold stays conservative until independent validation is sufficient',()=>{
 const result=resolveAdaptiveSelectionThreshold(null,68);
 assert.equal(result.threshold,68);
 assert.equal(result.validated,false);
 assert.equal(result.source,'conservative_default');
});

test('selection threshold adapts only after a sufficiently large positive holdout',()=>{
 const result=resolveAdaptiveSelectionThreshold({
  status:'holdout_available',
  selectedThreshold:75,
  validation:{tokens:24},
  holdoutAtSelectedThreshold:{tokens:22,positive15Pct:59.1,averageReturnPct:18.4,loss20Pct:18.2}
 },68);
 assert.equal(result.threshold,75);
 assert.equal(result.validated,true);
 assert.equal(result.source,'out_of_sample_validation');
});

test('selection threshold refuses weak, negative or undersized holdouts',()=>{
 for(const holdout of [
  {tokens:19,positive15Pct:90,averageReturnPct:10,loss20Pct:0},
  {tokens:30,positive15Pct:90,averageReturnPct:-1,loss20Pct:0},
  {tokens:30,positive15Pct:90,averageReturnPct:10,loss20Pct:26}
 ]){
  const result=resolveAdaptiveSelectionThreshold({status:'holdout_available',selectedThreshold:82,validation:{tokens:25},holdoutAtSelectedThreshold:holdout},68);
  assert.equal(result.threshold,68);
  assert.equal(result.validated,false);
 }
});
