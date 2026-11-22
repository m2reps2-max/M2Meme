'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeLargestHolders}=require('../lib/holder-intel');

test('agrège plusieurs comptes token appartenant au même wallet',()=>{
 const rows=[{amount:'400'},{amount:'300'},{amount:'200'},{amount:'100'}];
 const infos=[
  {data:{parsed:{info:{owner:'wallet-A'}}}},
  {data:{parsed:{info:{owner:'wallet-A'}}}},
  {data:{parsed:{info:{owner:'wallet-B'}}}},
  {data:{parsed:{info:{owner:'wallet-C'}}}}
 ];
 const x=analyzeLargestHolders(rows,infos,'1000');
 assert.equal(x.top1OwnerPercent,70);
 assert.equal(x.top5OwnerPercent,100);
 assert.equal(x.top10HolderPercent,100);
 assert.equal(x.top10AccountPercent,100);
 assert.equal(x.uniqueOwnerCount,3);
 assert.equal(x.ownerConcentrationAvailable,true);
 assert.equal(x.top20HolderPercent,100);
 assert.equal(x.holderSampleCoveragePct,100);
 assert.equal(x.holderGiniTop20,0.4);
 assert.equal(x.holderHhiTop20,5400);
 assert.equal(x.effectiveOwnersTop20,1.85);
});

test('ne présente pas la concentration des comptes comme une concentration de wallets si les propriétaires sont inconnus',()=>{
 const x=analyzeLargestHolders([{amount:'800'},{amount:'200'}],[null,null],'1000');
 assert.equal(x.top10HolderPercent,null);
 assert.equal(x.top10AccountPercent,100);
 assert.equal(x.top20HolderPercent,null);
 assert.equal(x.top1OwnerPercent,null);
 assert.equal(x.ownerConcentrationAvailable,false);
});

test('ne calcule pas de pourcentage si la supply est nulle',()=>{
 const x=analyzeLargestHolders([{amount:'10'}],[null],'0');
 assert.equal(x.top10HolderPercent,null);
});

test('calcule une concentration partielle sans prétendre connaître les propriétaires inconnus',()=>{
 const x=analyzeLargestHolders([{amount:'800'},{amount:'200'}],[null,null],'1000');
 assert.equal(x.holderSampleAccounts,2);
 assert.equal(x.holderSampleOwners,0);
 assert.equal(x.unknownOwnerAccounts,2);
 assert.equal(x.holderGiniTop20,0.3);
 assert.equal(x.ownerConcentrationAvailable,false);
 assert.equal(x.top1OwnerPercent,null);
});
