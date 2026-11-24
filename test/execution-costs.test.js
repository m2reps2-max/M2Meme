'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {netReturnPct,estimateSlippageRate}=require('../lib/execution-costs');

test('an observed zero exit liquidity is treated as an unexecutable total loss',()=>{
  assert.equal(netReturnPct(35,100000,0,100),-100);
  assert.equal(netReturnPct(35,100000,'0',100),-100);
});

test('unknown exit liquidity remains distinct from an observed zero',()=>{
  assert.ok(netReturnPct(35,100000,null,100)>-100);
  assert.equal(estimateSlippageRate(null,100),0.10);
  assert.equal(netReturnPct(null,100000,0,100),null);
});
