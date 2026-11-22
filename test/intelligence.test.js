'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {backtest}=require('../lib/intelligence');

test('backtest limits each horizon to a nearby observation and measures excursions',()=>{
 const history=[
  {at:1000,priceUsd:1,score:82,coverage:90},
  {at:31000,priceUsd:1.2,score:80,coverage:90},
  {at:61000,priceUsd:.9,score:78,coverage:90},
  {at:4000000,priceUsd:1.5,score:75,coverage:90}
 ];
 const result=backtest.call({state:{tokens:{mint:{mint:'mint',symbol:'TEST',history}}}});
 const first=result.recent.find(x=>x.at===new Date(1000).toISOString());
 assert.equal(first.outcomes['1m'].returnPct,-10);
 assert.equal(first.outcomes['1m'].maxFavorablePct,20);
 assert.equal(first.outcomes['1m'].maxAdversePct,-10);
 assert.equal(first.outcomes['5m'],undefined);
});
