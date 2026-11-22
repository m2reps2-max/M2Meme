'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessAlertFreshness,qualifyAlertLevel}=require('../lib/alert-quality');

test('fresh market snapshots preserve opportunity and danger levels',()=>{
 const now=10_000_000,token={history:[{at:now-60_000}]};
 assert.equal(assessAlertFreshness(token,now).status,'fresh');
 assert.equal(qualifyAlertLevel(token,'opportunity',85,now).level,'opportunity');
 assert.equal(qualifyAlertLevel(token,'danger',95,now).level,'danger');
});
test('slightly delayed market snapshots downgrade strong alerts to dashboard-only watch',()=>{
 const now=10_000_000,token={history:[{at:now-8*60_000}]};
 const result=qualifyAlertLevel(token,'danger',95,now);
 assert.equal(result.level,'watch');
 assert.equal(result.freshness.status,'delayed');
 assert.match(result.reason,/aucune alerte Telegram/i);
});
test('stale or unknown market data suppresses alerts',()=>{
 const now=10_000_000;
 assert.equal(qualifyAlertLevel({history:[{at:now-20*60_000}]},'opportunity',90,now).level,'none');
 const unknown=qualifyAlertLevel({history:[]},'danger',100,now);
 assert.equal(unknown.level,'none');
 assert.equal(unknown.freshness.status,'unknown');
});
test('future timestamps are unknown instead of being considered fresh',()=>{
 const now=10_000_000;
 assert.equal(assessAlertFreshness({history:[{at:now+10*60_000}]},now).status,'unknown');
});
