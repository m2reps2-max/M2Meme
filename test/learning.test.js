'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {learningSummary,recordForecast}=require('../lib/learning');

test('le taux de réussite à une heure compte les hausses de 15% ou plus',()=>{
 const scanner={state:{tokens:{
  a:{mint:'a',symbol:'AAA',liquidityUsd:100000,forecasts:[
   {score:80,at:1,liquidityUsd:100000,outcomes:{'1h':{label:'win',returnPct:18,exitLiquidityUsd:100000}}},
   {score:70,at:2,liquidityUsd:100000,outcomes:{'1h':{label:'strong_win',returnPct:65,exitLiquidityUsd:100000}}}
  ]},
  b:{mint:'b',symbol:'BBB',liquidityUsd:100000,forecasts:[
   {score:60,at:3,liquidityUsd:100000,outcomes:{'1h':{label:'flat',returnPct:2,exitLiquidityUsd:100000}}},
   {score:50,at:4,liquidityUsd:100000,outcomes:{'1h':{label:'liquidity_stress',returnPct:25,exitLiquidityUsd:100000}}}
  ]}
 }}};
 const result=learningSummary.call(scanner);
 assert.equal(result.successRate.horizon,'1h');
 assert.equal(result.successRate.minReturnPct,15);
 assert.equal(result.successRate.evaluated,4);
 assert.equal(result.successRate.successful,3);
 assert.equal(result.successRate.ratePct,75);
});

test('le taux reste indisponible tant qu’aucune observation à une heure n’est résolue',()=>{
 const result=learningSummary.call({state:{tokens:{a:{mint:'a',forecasts:[{at:1,score:80,outcomes:{}}]}}}});
 assert.equal(result.successRate.evaluated,0);
 assert.equal(result.successRate.ratePct,null);
});

test('les prévisions enregistrent le maximum favorable et le drawdown',()=>{
 const token={mint:'mint',forecasts:[]};
 const base={priceUsd:1,liquidityUsd:10000,volume1h:1000,volume24h:5000,buys1h:20,sells1h:10,fdv:50000,score:80,coverage:90,classification:'strong_candidate',risk:'low',flags:[]};
 recordForecast(token,{...base,at:1000000});
 recordForecast(token,{...base,at:1900000,priceUsd:1.3});
 recordForecast(token,{...base,at:4600000,priceUsd:.8});
 const outcome=token.forecasts[0].outcomes['1h'];
 assert.equal(outcome.returnPct,-20);
 assert.equal(outcome.maxFavorablePct,30);
 assert.equal(outcome.maxAdversePct,-20);
});

test('learning segments one-hour outcomes by discovery source and launch age',()=>{
 const result=learningSummary.call({state:{tokens:{
  a:{mint:'a',forecasts:[{score:80,at:1000,source:'Pump.fun',launchAgeHours:0.02,liquidityUsd:100000,outcomes:{'1h':{label:'win',returnPct:20,exitLiquidityUsd:100000}}}]},
  b:{mint:'b',forecasts:[{score:60,at:2000,source:'GeckoTerminal pool',launchAgeHours:0.2,liquidityUsd:100000,outcomes:{'1h':{label:'loss',returnPct:-25,exitLiquidityUsd:100000}}}]}
 }}});
 assert.equal(result.cohorts.bySource['Pump.fun'].winRate1hPct,100);
 assert.equal(result.cohorts.bySource['GeckoTerminal pool'].lossRate1hPct,100);
 assert.equal(result.cohorts.byLaunchAge['0–5 min'].resolved,1);
 assert.equal(result.cohorts.byLaunchAge['5–30 min'].resolved,1);
});

test('new forecast records discovery source and preserves unknown age',()=>{
 const token={mint:'mint',geckoPoolAddress:'pool',forecasts:[]};
 recordForecast(token,{priceUsd:1,liquidityUsd:2000,volume1h:100,volume24h:500,buys1h:4,sells1h:2,fdv:10000,score:70,coverage:80,classification:'watch',risk:'unknown',flags:[],at:1000000});
 assert.equal(token.forecasts[0].source,'GeckoTerminal pool');
 assert.equal(token.forecasts[0].launchAgeHours,null);
});

test('out-of-sample calibration separates mints and counts one first forecast per token',()=>{
 const tokens={};
 for(let i=0;i<100;i++){
  const mint='MintCalibration'+String(i).padStart(4,'0');
  tokens[mint]={mint,forecasts:[
   {at:i+1,score:80,source:'test',liquidityUsd:100000,outcomes:{'1h':{returnPct:20,exitLiquidityUsd:100000,label:'win'}}},
   {at:i+2,score:90,source:'test',liquidityUsd:100000,outcomes:{'1h':{returnPct:-25,exitLiquidityUsd:100000,label:'loss'}}}
  ]};
 }
 const result=learningSummary.call({state:{tokens}}).outOfSample;
 assert.equal(result.uniqueResolvedTokens,100);
 assert.equal(result.training.tokens+result.validation.tokens,100);
 assert.ok(result.training.tokens>=70&&result.training.tokens<=90);
 assert.ok(result.validation.tokens>=10&&result.validation.tokens<=30);
 assert.equal(result.selectedThreshold,60);
 assert.equal(result.holdoutAtSelectedThreshold.tokens,result.validation.tokens);
 assert.ok(Date.parse(result.trainingEndAt)<Date.parse(result.validationStartAt));
 assert.equal(result.baselineComparison.randomSameSize.tokens,result.holdoutAtSelectedThreshold.tokens);
 assert.equal(result.baselineComparison.thresholdVsAllValidation,0);
 assert.equal(result.holdoutAtSelectedThreshold.positive15Pct,100);
 assert.equal(result.returnBasis,'net_simulated');
 assert.ok(result.training.averageReturnPct<result.training.grossAverageReturnPct);
 assert.ok(result.holdoutAtSelectedThreshold.averageReturnPct<result.holdoutAtSelectedThreshold.grossAverageReturnPct);
});

test('une observation tardive résout le forecast et indique sa qualité',()=>{
 const token={mint:'late',forecasts:[]};
 const base={priceUsd:1,liquidityUsd:5000,volume1h:100,volume24h:500,buys1h:5,sells1h:2,fdv:10000,score:70,coverage:80,classification:'watch',risk:'unknown',flags:[]};
 recordForecast(token,{...base,at:1000000});
 recordForecast(token,{...base,at:1000000+7200000,priceUsd:1.2});
 assert.equal(token.forecasts[0].outcomes['1h'].returnPct,20);
 assert.equal(token.forecasts[0].outcomes['1h'].resolutionQuality,'late_observation');
});
test('la calibration hors échantillon ignore les prévisions sans score réel',()=>{
 const scanner={state:{tokens:{a:{mint:'a',forecasts:[{at:1,score:null,outcomes:{'1h':{returnPct:50,label:'win'}}}]}}}};
 const result=learningSummary.call(scanner).outOfSample;
 assert.equal(result.uniqueResolvedTokens,0);
 assert.equal(result.status,'insufficient_sample');
});

test('la validation walk-forward utilise uniquement des tokens plus récents que le training',()=>{
 const tokens={};
 for(let i=0;i<40;i++){
  const mint='WalkForward'+String(i).padStart(4,'0');
  tokens[mint]={mint,forecasts:[{at:i*1000+1,score:i<32?85:45,liquidityUsd:100000,outcomes:{'1h':{returnPct:i<32?25:-10,exitLiquidityUsd:100000,label:i<32?'win':'drawdown'}}}]};
 }
 const result=learningSummary.call({state:{tokens}}).outOfSample;
 assert.equal(result.training.tokens,32);
 assert.equal(result.validation.tokens,8);
 assert.ok(Date.parse(result.trainingEndAt)<Date.parse(result.validationStartAt));
 assert.equal(result.selectedThreshold,60);
 assert.equal(result.holdoutAtSelectedThreshold.tokens,0);
 assert.equal(result.status,'holdout_too_small');
});

test('low-liquidity tokens are included in forecasts and segmented separately',()=>{
 const token={mint:'micro',geckoPoolAddress:'pool',forecasts:[]};
 recordForecast(token,{priceUsd:0.000001,liquidityUsd:250,volume1h:10,volume24h:50,buys1h:2,sells1h:1,fdv:10000,score:68,coverage:70,classification:'watch',risk:'high',flags:[],at:1000000});
 assert.equal(token.forecasts.length,1);
 assert.equal(token.forecasts[0].liquidityBand,'under_1k');
 const result=learningSummary.call({state:{tokens:{micro:{...token,forecasts:[{...token.forecasts[0],outcomes:{'1h':{label:'loss',returnPct:-30}}}]}}}});
 assert.equal(result.cohorts.byLiquidity.under_1k.resolved,1);
 assert.equal(result.cohorts.byLiquidity.under_1k.lossRate1hPct,100);
});
test('zero-liquidity tokens do not create invalid forecast prices',()=>{
 const token={mint:'no-liquidity',forecasts:[]};
 recordForecast(token,{priceUsd:1,liquidityUsd:0,score:80,at:1000000});
 assert.equal(token.forecasts.length,0);
});

test('a fresh validated cold-archive model is used when the active cache has not learned enough',()=>{
 const archived={status:'validated',enabled:true,observations:400,trainingTokens:320,validationTokens:80,coefficients:{activity:.4,momentum:.3,market:.2,security:.1},means:{activity:50,momentum:50,market:50,security:50},stds:{activity:20,momentum:20,market:20,security:20},features:[],holdout:{selectedTokens:24,upliftVsStaticPctPoints:8,upliftVsRandomPctPoints:7}};
 const scanner={state:{tokens:{},archiveLearning:{adaptiveModel:archived},archiveLearningGeneratedAt:new Date().toISOString()}};
 const result=learningSummary.call(scanner);
 assert.equal(result.adaptiveModel.enabled,true);
 assert.equal(result.adaptiveModel.source,'cold_archive');
 assert.equal(result.adaptiveModelSources.archive.fresh,true);
});

test('a stale cold-archive model is not used for live candidate ranking',()=>{
 const archived={status:'validated',enabled:true,observations:400,trainingTokens:320,validationTokens:80};
 const scanner={state:{tokens:{},archiveLearning:{adaptiveModel:archived},archiveLearningGeneratedAt:new Date(Date.now()-6*86400000).toISOString()}};
 const result=learningSummary.call(scanner);
 assert.equal(result.adaptiveModel.enabled,false);
 assert.equal(result.adaptiveModel.source,'active_cache');
 assert.equal(result.adaptiveModelSources.archive.fresh,false);
});

test('a validated active-cache model takes priority over a validated cold-archive model',()=>{
 const tokens={};
 for(let i=0;i<300;i++){
  const x=i%100,mint='active-'+String(i).padStart(4,'0');
  tokens[mint]={mint,forecasts:[{at:Date.UTC(2026,0,1)+i*60000,score:100-x,liquidityUsd:100000,features:{activity:x,momentum:x*.8+(i%7),market:x*.7+(i%5),liquidityQuality:x*.6+(i%11),security:x*.5+(i%13)},outcomes:{'1h':{returnPct:(x-50)*1.5,exitLiquidityUsd:100000}}}]};
 }
 const archived={status:'validated',enabled:true,observations:500,trainingTokens:400,validationTokens:100,coefficients:{activity:.4,momentum:.3,market:.2,security:.1},means:{activity:50,momentum:50,market:50,security:50},stds:{activity:20,momentum:20,market:20,security:20},features:[],holdout:{selectedTokens:30,upliftVsStaticPctPoints:8,upliftVsRandomPctPoints:7}};
 const scanner={state:{tokens,archiveLearning:{adaptiveModel:archived},archiveLearningGeneratedAt:new Date().toISOString()}};
 const result=learningSummary.call(scanner);
 assert.equal(result.adaptiveModel.enabled,true);
 assert.equal(result.adaptiveModel.source,'active_cache');
});


test('net simulated returns, not gross labels, drive win/loss and calibration rates',()=>{
 const result=learningSummary.call({state:{tokens:{micro:{mint:'micro',forecasts:[{score:80,at:1,source:'test',liquidityBand:'under_1k',liquidityUsd:250,outcomes:{'1h':{label:'win',grossLabel:'win',returnPct:16,grossReturnPct:16,exitLiquidityUsd:250}}}]}}}});
 assert.equal(result.successRate.evaluated,1);
 assert.equal(result.successRate.successful,0);
 assert.equal(result.summary.horizons['1h'].winRatePct,0);
 assert.equal(result.summary.horizons['1h'].lossRatePct,100);
 assert.equal(result.cohorts.byLiquidity.under_1k.winRate1hPct,0);
 assert.equal(result.cohorts.byLiquidity.under_1k.lossRate1hPct,100);
 assert.equal(result.labels.drawdown['1h'],1);
 assert.equal(result.grossLabels.win['1h'],1);
 assert.equal(result.recent[0].outcomes['1h'].netLabel,'drawdown');
 assert.equal(result.recent[0].outcomes['1h'].label,'drawdown');
 assert.ok(result.recent[0].outcomes['1h'].returnPct<0);
 assert.equal(result.recent[0].outcomes['1h'].grossReturnPct,16);
});


test('new forecast records preserve gross labels and expose net labels separately',()=>{
 const token={mint:'low-liquidity',forecasts:[]};
 const base={priceUsd:1,liquidityUsd:250,volume1h:10,volume24h:20,buys1h:2,sells1h:1,fdv:10000,score:80,coverage:90,classification:'strong_candidate',risk:'low',flags:[]};
 recordForecast(token,{...base,at:1000000});
 recordForecast(token,{...base,at:4600000,priceUsd:1.16});
 const outcome=token.forecasts[0].outcomes['1h'];
 assert.equal(outcome.grossReturnPct,16);
 assert.equal(outcome.returnPct,16);
 assert.equal(outcome.label,'win');
 assert.equal(outcome.grossLabel,'win');
 assert.equal(outcome.netLabel,'drawdown');
 assert.ok(outcome.netReturnPct<0);
});
