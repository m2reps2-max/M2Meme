'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeGL1TCHReport}=require('../lib/external-security');

test('normalise un rapport GL1TCH sans supposer le sens du score',()=>{
 const x=normalizeGL1TCHReport({verdict:'CAUTION',score:73,confidence:'high',bottomLine:'Linked wallets detected',checks:[{name:'Linked wallets',status:'warning',reason:'Several holders share a funder'}]});
 assert.equal(x.verdict,'CAUTION');
 assert.equal(x.score,73);
 assert.equal(x.confidence,'high');
 assert.equal(x.checks[0].name,'Linked wallets');
 assert.equal(x.checks[0].details,'Several holders share a funder');
});

test('accepte un rapport imbriqué et borne les données affichées',()=>{
 const x=normalizeGL1TCHReport({report:{verdict:'LOW RISK',score:120,checks:Array.from({length:45},(_,i)=>({title:'Check '+i,message:'x'.repeat(700)}))}});
 assert.equal(x.score,100);
 assert.equal(x.checks.length,40);
 assert.equal(x.checks[0].details.length,500);
});

test('rejette un payload sans rapport exploitable',()=>{
 assert.equal(normalizeGL1TCHReport({error:'unavailable'}),null);
});


test('refuse une réponse GL1TCH qui dépasse la limite de lecture',async()=>{
 const {inspectExternalSecurity}=require('../lib/external-security');
 const token={mint:'BoundedExternalSecurityMint111111111111111'};
 const originalFetch=global.fetch;
 global.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>'x'.repeat(300000)});
 try{
  const result=await inspectExternalSecurity(token);
  assert.equal(result.status,'unavailable');
  assert.match(result.error,/volumineuse|limite/i);
 }finally{
  global.fetch=originalFetch;
 }
});

test('only sufficiently supported CLEAN and LOW RISK verdicts clear the gate',()=>{
 const {assessExternalSecurity}=require('../lib/external-security');
 for(const verdict of ['CLEAN','LOW RISK'])assert.equal(assessExternalSecurity({status:'ok',verdict,score:80,confidence:75,checks:[]}).decision,'clear');
});
test('CAUTION, HIGH RISK and RUG-SHAPED do not enter the best shortlist',()=>{
 const {assessExternalSecurity}=require('../lib/external-security');
 for(const verdict of ['CAUTION','HIGH RISK','RUG-SHAPED'])assert.equal(assessExternalSecurity({status:'ok',verdict,score:80,confidence:90,checks:[]}).decision,'block',verdict);
});
test('an explicit spam flag blocks even when the overall verdict is CLEAN',()=>{
 const {assessExternalSecurity}=require('../lib/external-security');
 const result=assessExternalSecurity({status:'ok',verdict:'CLEAN',score:90,confidence:90,checks:[{name:'Spam activity',status:'flagged',severity:'high',details:'Coordinated spam trading detected'}]});
 assert.equal(result.decision,'block');
 assert.match(result.reason,/spam/i);
});
test('unavailable, UNKNOWN and low-confidence reports remain inconclusive',()=>{
 const {assessExternalSecurity}=require('../lib/external-security');
 for(const row of [undefined,{status:'unavailable'},{status:'ok',verdict:'UNKNOWN',score:90,confidence:90},{status:'ok',verdict:'CLEAN',score:90,confidence:20}])assert.equal(assessExternalSecurity(row).decision,'inconclusive');
});
test('a negated spam check does not become a false positive',()=>{
 const {assessExternalSecurity}=require('../lib/external-security');
 const result=assessExternalSecurity({status:'ok',verdict:'LOW RISK',score:75,confidence:80,checks:[{name:'Spam activity',status:'pass',severity:'low',details:'No spam detected'}]});
 assert.equal(result.decision,'clear');
});

test('reads the actual GL1TCH explain and risks fields and blocks explicit spam',()=>{
 const {assessExternalSecurity}=require('../lib/external-security');
 const report=normalizeGL1TCHReport({verdict:'CLEAN',score:95,confidence:90,risks:['Spam-like trading activity detected'],checks:[{key:'trade_quality',label:'Trading activity',status:'warn',value:'bot volume',explain:'Spam-like activity detected'}]});
 assert.equal(report.checks[0].details,'Spam-like activity detected');
 assert.deepEqual(report.risks,['Spam-like trading activity detected']);
 assert.equal(assessExternalSecurity({status:'ok',...report}).decision,'block');
});
test('does not treat a negated spam explanation as a positive risk',()=>{
 const {assessExternalSecurity}=require('../lib/external-security');
 const report=normalizeGL1TCHReport({verdict:'LOW RISK',score:80,confidence:80,risks:[],checks:[{label:'Trading activity',status:'pass',explain:'No spam detected'}]});
 assert.equal(assessExternalSecurity({status:'ok',...report}).decision,'clear');
});
