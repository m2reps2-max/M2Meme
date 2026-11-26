'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {marketFieldFresh,freshMarketView}=require('../lib/market-freshness');

test('freshMarketView retains only fields with their own recent observation timestamps',()=>{
 const now=Date.now(),fresh=new Date(now-30_000).toISOString(),stale=new Date(now-20*60_000).toISOString();
 const token={volume:{m5:10,h1:100,h24:1000},txns:{m5:{buys:8,sells:2},h1:{buys:80,sells:20}},priceChange:{m5:5,h1:30,h24:90},
  marketFieldsObservedAt:{volumeM5:fresh,volumeH1:stale,volumeH24:fresh,txnsM5:fresh,txnsH1:stale,priceChangeM5:fresh,priceChangeH1:stale,priceChangeH24:fresh}};
 const view=freshMarketView(token,now);
 assert.equal(view.volume.m5,10);assert.equal(view.volume.h1,null);assert.equal(view.volume.h24,1000);
 assert.equal(view.txns.m5.buys,8);assert.equal(view.txns.h1,null);
 assert.equal(view.priceChange.m5,5);assert.equal(view.priceChange.h1,null);assert.equal(view.priceChange.h24,90);
});

test('missing and future market timestamps stay unknown instead of refreshing preserved values',()=>{
 const now=Date.now(),future=new Date(now+5*60_000).toISOString();
 const token={volume:{m5:100,h1:200,h24:300},txns:{h1:{buys:40,sells:10}},priceChange:{m5:20},
  marketFieldsObservedAt:{volumeM5:future,volumeH1:now-1000}};
 const view=freshMarketView(token,now);
 assert.equal(view.volume.m5,null);assert.equal(view.volume.h1,200);assert.equal(view.volume.h24,null);
 assert.equal(view.txns.h1,null);assert.equal(view.priceChange.m5,null);
 assert.equal(marketFieldFresh(token,'volumeH1',now),true);
 assert.equal(marketFieldFresh(token,'volumeM5',now),false);
});
