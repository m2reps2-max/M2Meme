'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {BlueskyRadar}=require('../lib/bluesky-radar');

test('Bluesky search filters exact cashtag mentions and aggregates public engagement',async()=>{
 const radar=new BlueskyRadar({fetchImpl:async url=>{
  assert.match(String(url),/searchPosts/);
  return {ok:true,json:async()=>({posts:[
   {post:{uri:'at://did:plc:abc/app.bsky.feed.post/one',record:{text:'$CAT is bullish',createdAt:new Date().toISOString()},author:{handle:'one.bsky.social'},likeCount:4,repostCount:2,replyCount:1}},
   {post:{uri:'at://did:plc:def/app.bsky.feed.post/two',record:{text:'CATCH is unrelated',createdAt:new Date().toISOString()},author:{handle:'two.bsky.social'}}}
  ]})};
 }});
 const result=await radar.searchToken({mint:'Mint123456789012345678901234567890123',symbol:'CAT'});
 assert.equal(result.mentions24h,1);
 assert.equal(result.uniqueAuthors24h,1);
 assert.equal(result.engagement24h,7);
 assert.equal(result.posts[0].source,'Bluesky');
 assert.match(result.posts[0].link,/bsky\.app\/profile/);
});

test('Bluesky search reports unavailable data instead of inventing mentions',async()=>{
 const radar=new BlueskyRadar({fetchImpl:async()=>({ok:false,status:429})});
 const result=await radar.searchToken({mint:'Mint123456789012345678901234567890123',symbol:'CAT'});
 assert.equal(result.available,false);
 assert.equal(result.mentions24h,0);
 assert.match(result.error,/429/);
});

test('Bluesky rejects ambiguous short symbols without making a request',async()=>{
 let calls=0;
 const radar=new BlueskyRadar({fetchImpl:async()=>{calls++;throw new Error('should not call');}});
 const result=await radar.searchToken({mint:'Mint123456789012345678901234567890123',symbol:'AI'});
 assert.equal(calls,0);
 assert.equal(result.available,false);
});
