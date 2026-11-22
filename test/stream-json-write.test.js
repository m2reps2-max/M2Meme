'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {writeJsonFileSync}=require('../lib/stream-json-write');

test('streams nested JSON to disk without changing JSON.stringify output',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-json-'));
 const file=path.join(dir,'state.json');
 const value={text:'émoji 🚀',empty:null,number:Infinity,rows:[1,undefined,{ok:true}],omit:undefined,omitFromToJSON:{toJSON(){return undefined;}},date:new Date('2026-01-02T03:04:05.000Z')};
 try{
  writeJsonFileSync(file,value);
  assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(value));
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),JSON.parse(JSON.stringify(value)));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('streams large objects in bounded chunks and preserves all entries',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-json-large-'));
 const file=path.join(dir,'state.json');
 const value={tokens:Object.fromEntries(Array.from({length:1800},(_,i)=>['mint'+i,{symbol:'TOKEN'+i,forecasts:Array.from({length:35},(_,j)=>({at:j,price:i+j}))}]))};
 try{
  writeJsonFileSync(file,value);
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(Object.keys(parsed.tokens).length,1800);
  assert.equal(parsed.tokens.mint1799.forecasts.length,35);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('rejects circular structures and removes the partial output',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-json-circular-'));
 const file=path.join(dir,'state.json');
 const value={};value.self=value;
 try{
  assert.throws(()=>writeJsonFileSync(file,value),/circular/i);
  assert.equal(fs.existsSync(file),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
