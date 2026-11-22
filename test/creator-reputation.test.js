'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildCreatorReputation,firstMaturedOutcome}=require('../lib/creator-reputation');

test('creator reputation counts one matured 1h result per launch, not every forecast snapshot',()=>{
 const rows=buildCreatorReputation([
  {mint:'A',creator:'creator1',creatorObservedAtLaunch:true,migrated:true,forecasts:[
   {at:'2026-01-01T00:00:00Z',outcomes:{'1h':{returnPct:30,maxAdversePct:-8}}},
   {at:'2026-01-01T00:15:00Z',outcomes:{'1h':{returnPct:-40,maxAdversePct:-50}}}
  ]},
  {mint:'B',creator:'creator1',creatorObservedAtLaunch:true,creatorSaleEvents:[{at:'2026-01-01T00:00:00Z'}],creatorSaleSummary:{soldPctSupply24h:8},forecasts:[
   {at:'2026-01-02T00:00:00Z',outcomes:{'1h':{returnPct:-25,maxAdversePct:-35}}}
  ]},
  {mint:'C',creator:'creator2',creatorObservedAtLaunch:false,forecasts:[]}
 ]);
 assert.equal(rows.length,1);
 assert.equal(rows[0].address,'creator1');
 assert.equal(rows[0].reputation.launches,2);
 assert.equal(rows[0].reputation.evaluatedLaunches,2);
 assert.equal(rows[0].reputation.positive15Pct,50);
 assert.equal(rows[0].reputation.materialCreatorSaleLaunches,1);
 assert.equal(rows[0].reputation.score,null);
});

test('creator reputation shrinks small samples and reports missing evidence without inventing scores',()=>{
 const rows=buildCreatorReputation([
  {mint:'A',creator:'creator1',creatorObservedAtLaunch:true,creatorFunding:{funder:'funder1'},forecasts:[]},
  {mint:'B',creator:'creator1',creatorObservedAtLaunch:true,creatorFunding:{funder:'funder2'},forecasts:[]}
 ]);
 assert.equal(rows[0].reputation.score,null);
 assert.equal(rows[0].reputation.confidence,'insuffisant');
 assert.equal(rows[0].reputation.observedFunders,2);
 assert.equal(rows[0].reputation.positive15Pct,null);
});

test('first matured outcome selects earliest forecast only',()=>{
 const outcome=firstMaturedOutcome({forecasts:[
  {at:'2026-01-02T00:00:00Z',outcomes:{'1h':{returnPct:4}}},
  {at:'2026-01-01T00:00:00Z',outcomes:{'1h':{returnPct:12}}}
 ]});
 assert.equal(outcome.returnPct,12);
});
