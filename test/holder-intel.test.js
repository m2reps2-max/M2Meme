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
});

test('retombe sur les comptes bruts si les propriétaires ne sont pas disponibles',()=>{
 const x=analyzeLargestHolders([{amount:'800'},{amount:'200'}],[null,null],'1000');
 assert.equal(x.top10HolderPercent,100);
 assert.equal(x.top1OwnerPercent,null);
 assert.equal(x.ownerConcentrationAvailable,false);
});

test('ne calcule pas de pourcentage si la supply est nulle',()=>{
 const x=analyzeLargestHolders([{amount:'10'}],[null],'0');
 assert.equal(x.top10HolderPercent,null);
});
