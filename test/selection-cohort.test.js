'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {updateSelectionCohorts,buildSelectionPerformance}=require('../lib/selection-cohort');
function token(mint,price=1){return {mint,pairAddress:'pair-'+mint,priceUsd:price,liquidityUsd:10000,volume:{h1:1000},analysis:{score:80,coverage:90},forecasts:[]};}
test('captures each shortlisted mint once and records later horizon outcomes',()=>{
 const a=token('A');const state={tokens:{A:a}};
 updateSelectionCohorts(state,{best:[{mint:'A'}],observe:[]},1000000);
 assert.equal(state.selectionCohorts.length,1);
 assert.equal(state.selectionCohorts[0].category,'best');
 a.forecasts=[{at:1000000+3600000,priceUsd:1.25,liquidityUsd:9000}];
 updateSelectionCohorts(state,{best:[{mint:'A'}],observe:[]},1000000+3600000);
 assert.equal(state.selectionCohorts.length,1);
 assert.equal(state.selectionCohorts[0].outcomes['1h'].returnPct,25);
});
test('baseline entries are promoted and reset at the first shortlist signal',()=>{
 const a=token('A');const state={tokens:{A:a}};
 updateSelectionCohorts(state,{best:[],observe:[]},1000000);
 assert.equal(state.selectionCohorts[0].category,'baseline');
 updateSelectionCohorts(state,{best:[{mint:'A'}],observe:[]},2000000);
 assert.equal(state.selectionCohorts.length,1);
 assert.equal(state.selectionCohorts[0].category,'best');
 assert.equal(state.selectionCohorts[0].at,2000000);
});
test('summary keeps pending and missing observations separate from losses',()=>{
 const state={selectionCohorts:[
  {mint:'A',category:'best',at:1,outcomes:{'1h':{returnPct:20,maxAdversePct:-5,liquidityFailure:false}}},
  {mint:'B',category:'best',at:2,outcomes:{},missed:{'1h':true}}
 ]};
 const result=buildSelectionPerformance(state);
 assert.equal(result.groups.best.horizons['1h'].resolved,1);
 assert.equal(result.groups.best.horizons['1h'].positive15Pct,100);
 assert.equal(result.groups.best.horizons['1h'].missed,1);
 assert.equal(result.groups.best.horizons['1h'].loss20Pct,0);
});
test('only linked, priced and liquid tokens enter the baseline sample',()=>{
 const good=token('GOOD'),noPrice=token('NO_PRICE',0),noPool=token('NO_POOL');noPool.pairAddress=null;
 const state={tokens:{GOOD:good,NO_PRICE:noPrice,NO_POOL:noPool}};
 updateSelectionCohorts(state,{best:[],observe:[]},1000000);
 assert.deepEqual(state.selectionCohorts.map(x=>x.mint),['GOOD']);
});
