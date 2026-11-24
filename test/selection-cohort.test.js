'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {updateSelectionCohorts,buildSelectionPerformance}=require('../lib/selection-cohort');
const {netReturnPct}=require('../lib/adaptive-model');
function token(mint,price=1){return {mint,pairAddress:'pair-'+mint,priceUsd:price,liquidityUsd:10000,volume:{h1:1000},analysis:{score:80,coverage:90},forecasts:[]};}
test('captures each shortlisted mint once and records later horizon outcomes',()=>{
 const a=token('A');const state={tokens:{A:a}};
 updateSelectionCohorts(state,{best:[{mint:'A'}],observe:[]},1000000);
 assert.equal(state.selectionCohorts.length,1);
 assert.equal(state.selectionCohorts[0].category,'best');
 a.forecasts=[{at:1000000+3600000,priceUsd:1.25,liquidityUsd:9000}];
 updateSelectionCohorts(state,{best:[{mint:'A'}],observe:[]},1000000+3600000);
 assert.equal(state.selectionCohorts.length,1);
 assert.equal(state.selectionCohorts[0].outcomes['1h'].grossReturnPct,25);
 assert.equal(state.selectionCohorts[0].outcomes['1h'].returnPct,Number(netReturnPct(25).toFixed(2)));
 assert.ok(state.selectionCohorts[0].outcomes['1h'].returnPct<25);
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


test('selection performance exposes net returns separately from gross returns and declares its cost assumptions',()=>{
 const result=buildSelectionPerformance({selectionCohorts:[{mint:'A',category:'best',at:1,outcomes:{'1h':{returnPct:8,grossReturnPct:10,maxAdversePct:-5,liquidityFailure:false}}}]});
 assert.equal(result.groups.best.horizons['1h'].averageReturnPct,8);
 assert.equal(result.groups.best.horizons['1h'].grossAverageReturnPct,10);
 assert.equal(result.evaluation.returnBasis,'net_simulated');
 assert.equal(result.evaluation.entrySlippagePct,0.5);
 assert.equal(result.evaluation.exitSlippagePct,0.5);
 assert.equal(result.evaluation.feePerSidePct,0.3);
});


test('legacy stored gross cohort outcomes are migrated once to the net cost model',()=>{
 const state={tokens:{},selectionCohorts:[{mint:'LEGACY',category:'best',at:1,outcomes:{'1h':{returnPct:25,maxFavorablePct:40,maxAdversePct:-12}}}]};
 updateSelectionCohorts(state,{best:[],observe:[]},2);
 const outcome=state.selectionCohorts[0].outcomes['1h'];
 assert.equal(outcome.grossReturnPct,25);
 assert.equal(outcome.returnPct,Number(netReturnPct(25).toFixed(2)));
 assert.equal(outcome.grossMaxFavorablePct,40);
 assert.equal(outcome.maxFavorablePct,Number(netReturnPct(40).toFixed(2)));
 assert.equal(outcome.grossMaxAdversePct,-12);
 assert.equal(outcome.maxAdversePct,Number(netReturnPct(-12).toFixed(2)));
 assert.equal(state.selectionCohorts[0].costModelVersion,1);
 updateSelectionCohorts(state,{best:[],observe:[]},3);
 assert.equal(outcome.returnPct,Number(netReturnPct(25).toFixed(2)),'migration must not apply costs twice');
});
