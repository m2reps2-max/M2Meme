'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { constantTimeEqual, validateHistoricalPayload, validateArchiveLearningPayload, mergeHistoricalBenchmarks } = require('../lib/actions-ingest');
const { buildAdaptiveModel } = require('../lib/adaptive-model');

const allowed = new Set(['BONK', 'WIF']);
const completed = { symbol: 'BONK', completed: true, terminalReturnPct: 20, maxDrawdownPct: -30, signals: [], fetchedAt: new Date().toISOString() };

test('actions ingest compares bearer secrets without accepting mismatched values', () => {
  assert.equal(constantTimeEqual('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(constantTimeEqual('a'.repeat(32), 'b'.repeat(32)), false);
  assert.equal(constantTimeEqual('secret', 'secret-longer'), false);
});

test('actions ingest accepts only known symbols and bounded completed rows', () => {
  assert.equal(validateHistoricalPayload({ schemaVersion: 1, historicalBenchmarks: { BONK: completed } }, allowed).ok, true);
  assert.equal(validateHistoricalPayload({ schemaVersion: 2, historicalBenchmarks: { BONK: completed } }, allowed).ok, false);
  assert.equal(validateHistoricalPayload({ schemaVersion: 1, historicalBenchmarks: { UNKNOWN: completed } }, allowed).ok, false);
  assert.equal(validateHistoricalPayload({ schemaVersion: 1, historicalBenchmarks: { BONK: { ...completed, signals: Array(181).fill({}) } } }, allowed).ok, false);
});

test('actions ingest keeps a recent completed benchmark when a later run only has a failure', () => {
  const old = { BONK: completed };
  const failed = { BONK: { symbol: 'BONK', completed: false, error: '429', fetchedAt: new Date().toISOString() } };
  assert.equal(mergeHistoricalBenchmarks(old, failed)[ 'BONK' ].completed, true);
  assert.equal(mergeHistoricalBenchmarks({}, failed).BONK.completed, false);
});

test('archive learning ingest accepts bounded aggregates and rejects malformed or oversized metrics', () => {
  const metric = { resolved: 12, averageReturnPct: 8.5, positive15Pct: 50, loss20Pct: 16.7 };
  const summary = {
    archiveTokensScanned: 50000,
    tokensWithForecasts: 1200,
    forecasts: 9000,
    uniqueResolvedTokens1h: 800,
    horizons: Object.fromEntries(['15m', '1h', '6h', '24h', '7d'].map(key => [key, metric])),
    scoreBands: Object.fromEntries(['0-44', '45-64', '65-79', '80-100'].map(key => [key, metric])),
    bySource: { 'Pump.fun': metric },
    walkForward: { trainingTokens: 640, validationTokens: 160, validation: metric },
    limitations: 'Cold archive only.'
  };
  const payload = { schemaVersion: 1, generatedAt: new Date().toISOString(), summary };
  assert.equal(validateArchiveLearningPayload(payload).ok, true);
  assert.equal(validateArchiveLearningPayload({ ...payload, summary: { ...summary, archiveTokensScanned: 999999 } }).ok, false);
  assert.equal(validateArchiveLearningPayload({ ...payload, summary: { ...summary, horizons: { ...summary.horizons, '1h': { ...metric, averageReturnPct: Infinity } } } }).ok, false);
});

test('archive learning ingest validates a real adaptive model and rejects unsafe model coefficients',()=>{
  const tokens={};
  for(let i=0;i<300;i++){
    const x=i%100,mint='archive-'+String(i).padStart(4,'0');
    tokens[mint]={mint,forecasts:[{
      at:Date.UTC(2026,0,1)+i*60000,score:100-x,liquidityUsd:100000,
      features:{activity:x,momentum:x*.8+(i%7),market:x*.7+(i%5),liquidityQuality:x*.6+(i%11),security:x*.5+(i%13)},
      outcomes:{'15m':{returnPct:(x-50)*.8,exitLiquidityUsd:100000},'1h':{returnPct:(x-50)*1.5,exitLiquidityUsd:100000},'6h':{returnPct:(x-50)*1.2,exitLiquidityUsd:100000},'24h':{returnPct:(x-50)*.7,exitLiquidityUsd:100000},'7d':{returnPct:(x-50)*.4,exitLiquidityUsd:100000}}
    }]};
  }
  const adaptiveModel=buildAdaptiveModel(tokens);
  const metric={resolved:12,averageReturnPct:8.5,positive15Pct:50,loss20Pct:16.7};
  const summary={
    archiveTokensScanned:50000,tokensWithForecasts:1200,forecasts:9000,uniqueResolvedTokens1h:800,
    horizons:Object.fromEntries(['15m','1h','6h','24h','7d'].map(key=>[key,metric])),
    scoreBands:Object.fromEntries(['0-44','45-64','65-79','80-100'].map(key=>[key,metric])),
    bySource:{'Pump.fun':metric},walkForward:{trainingTokens:640,validationTokens:160,validation:metric},
    adaptiveModel,limitations:'Cold archive only.'
  };
  const payload={schemaVersion:1,generatedAt:new Date().toISOString(),summary};
  assert.equal(adaptiveModel.enabled,true);
  assert.equal(validateArchiveLearningPayload(payload).ok,true);
  assert.equal(validateArchiveLearningPayload({...payload,summary:{...summary,adaptiveModel:{...adaptiveModel,coefficients:{activity:999}}}}).ok,false);
});
