'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {queueAlertForChannels,markAlertDelivered,alertDeliveryId}=require('../lib/telegram-alert-delivery');

function makeAlert(overrides={}) {
 return {at:'2026-11-24T12:00:00.000Z',mint:'11111111111111111111111111111111',level:'opportunity',...overrides};
}
const channels=[
 {chatId:'@alpha_channel',enabled:true,lastSentAt:null},
 {chatId:'@beta_channel',enabled:false,lastSentAt:null}
];

test('a recent alert recorded before Telegram setup is queued when a channel becomes active',()=>{
 const alert=makeAlert();
 const outbox=[];
 const queued=queueAlertForChannels({alert,channels,outbox,message:'opportunity',now:'2026-11-24T12:05:00.000Z'});
 assert.equal(queued,1);
 assert.equal(outbox.length,1);
 assert.equal(outbox[0].chatId,'@alpha_channel');
 assert.equal(outbox[0].alertId,alertDeliveryId(alert));
});

test('repeated scans do not duplicate an alert already queued for a channel',()=>{
 const alert=makeAlert(),outbox=[];
 const args={alert,channels,outbox,message:'opportunity',now:'2026-11-24T12:05:00.000Z'};
 assert.equal(queueAlertForChannels(args),1);
 assert.equal(queueAlertForChannels(args),0);
 assert.equal(outbox.length,1);
});

test('successful delivery is recorded per channel and prevents future replay',()=>{
 const alert=makeAlert(),outbox=[];
 queueAlertForChannels({alert,channels,outbox,message:'opportunity'});
 assert.equal(markAlertDelivered([alert],alertDeliveryId(alert),'@alpha_channel'),true);
 assert.deepEqual(alert.telegramSentTo,['@alpha_channel']);
 assert.equal(queueAlertForChannels({alert,channels,outbox:[],message:'opportunity'}),0);
});

test('legacy alerts are not replayed when that channel has sent after the alert timestamp',()=>{
 const alert=makeAlert();
 const channel={chatId:'@alpha_channel',enabled:true,lastSentAt:'2026-11-24T12:01:00.000Z'};
 const outbox=[];
 assert.equal(queueAlertForChannels({alert,channels:[channel],outbox,message:'opportunity'}),0);
 assert.equal(outbox.length,0);
});

test('disabled channels and invalid alerts never enter the outbox',()=>{
 const alert=makeAlert(),outbox=[];
 assert.equal(queueAlertForChannels({alert,channels:[channels[1]],outbox,message:'opportunity'}),0);
 assert.equal(queueAlertForChannels({alert:{},channels,outbox,message:'opportunity'}),0);
 assert.equal(outbox.length,0);
});

test('watch and danger alerts are rejected before entering the Telegram outbox',()=>{
 for(const level of ['watch','danger']){
  const outbox=[];
  const alert=makeAlert({level});
  assert.equal(queueAlertForChannels({alert,channels,outbox,message:'must not publish'}),0);
  assert.equal(outbox.length,0);
 }
});
