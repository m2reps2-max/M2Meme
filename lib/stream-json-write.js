'use strict';
const fs=require('node:fs');
const MAX_BUFFER_CHARS=64*1024;

function writeJsonFileSync(filePath,value){
 const fd=fs.openSync(filePath,'w',0o600);
 let pending='';
 const ancestors=new Set();
 const flush=()=>{
  if(!pending)return;
  const bytes=Buffer.from(pending,'utf8');
  let offset=0;
  while(offset<bytes.length)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);
  pending='';
 };
 const push=chunk=>{
  if(!chunk)return;
  pending+=chunk;
  if(pending.length>=MAX_BUFFER_CHARS)flush();
 };
 const encode=(input,key,inArray=false)=>{
  let current=input;
  if(current&&typeof current.toJSON==='function')current=current.toJSON(key);
  if(current===null||typeof current!=='object'){
   const encoded=JSON.stringify(current);
   if(encoded===undefined){if(inArray)push('null');return false;}
   push(encoded);return true;
  }
  if(ancestors.has(current))throw new TypeError('Converting circular structure to JSON');
  ancestors.add(current);
  if(Array.isArray(current)){
   push('[');
   for(let i=0;i<current.length;i++){
    if(i)push(',');
    encode(current[i],String(i),true);
   }
   push(']');
  }else{
   push('{');
   let first=true;
   for(const property of Object.keys(current)){
    let child=current[property];
    if(child&&typeof child.toJSON==='function')child=child.toJSON(property);
    if(child===undefined||typeof child==='function'||typeof child==='symbol')continue;
    if(!first)push(',');
    first=false;
    push(JSON.stringify(property));push(':');
    encode(child,property,false);
   }
   push('}');
  }
  ancestors.delete(current);
  return true;
 };
 try{
  encode(value,'',false);
  flush();
 }catch(error){
  try{fs.closeSync(fd);}catch{}
  try{fs.unlinkSync(filePath);}catch{}
  throw error;
 }
 fs.closeSync(fd);
}
module.exports={writeJsonFileSync};
