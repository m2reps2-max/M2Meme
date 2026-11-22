'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {NostrRadar,matchesToken,summarizeEvents}=require('../lib/nostr-radar');

test('Nostr token matching requires a bounded symbol or exact long name',()=>{
 const token={symbol:'BONK',name:'Bonk'};
 assert.equal(matchesToken('I am bullish on $BONK',token),true);
 assert.equal(matchesToken('BONK is moving',token),true);
 assert.equal(matchesToken('I bought NOTBONK yesterday',token),false);
 assert.equal(matchesToken('I like bonkers memes',token),false);
});
test('Nostr event summary deduplicates events and ignores stale or irrelevant posts',()=>{
 const now=Date.UTC(2026,10,22,12);
 const events=[
  {id:'a',kind:1,pubkey:'p1',created_at:Math.floor((now-1000)/1000),content:'Bullish on $BONK, moon soon'},
  {id:'a',kind:1,pubkey:'p1',created_at:Math.floor((now-1000)/1000),content:'Bullish on $BONK, moon soon'},
  {id:'b',kind:1,pubkey:'p2',created_at:Math.floor((now-2*3600000)/1000),content:'$BONK looks like a rug'},
  {id:'c',kind:1,pubkey:'p3',created_at:Math.floor((now-2*86400000)/1000),content:'$BONK'}
 ];
 const result=summarizeEvents(events,{symbol:'BONK',name:'Bonk'},now);
 assert.equal(result.mentions24h,2);
 assert.equal(result.mentions1h,1);
 assert.equal(result.uniqueAuthors24h,2);
 assert.equal(result.posts.length,2);
 assert.ok(result.sentimentScore!==null);
});
test('Nostr radar performs NIP-50 search and caches the result',async()=>{
 class FakeSocket extends EventEmitter {
  constructor(){super();this.readyState=1;setImmediate(()=>this.emit('open'));}
  send(raw){
   const message=JSON.parse(raw);
   if(message[0]!=='REQ')return;
   const sub=message[1];
   setImmediate(()=>{
    this.emit('message',Buffer.from(JSON.stringify(['EVENT',sub,{id:'event1',kind:1,pubkey:'author1',created_at:Math.floor(Date.now()/1000),content:'$BONK bullish'}])));
    this.emit('message',Buffer.from(JSON.stringify(['EOSE',sub])));
   });
  }
  close(){this.readyState=3;this.emit('close');}
 }
 const radar=new NostrRadar({WebSocketImpl:FakeSocket,timeoutMs:1000});
 const token={mint:'mint-bonk',symbol:'BONK',name:'Bonk'};
 const result=await radar.searchToken(token);
 assert.equal(result.available,true);
 assert.equal(result.mentions24h,1);
 const cached=await radar.searchToken(token);
 assert.equal(cached,result);
 assert.equal(radar.status().connected,true);
});
