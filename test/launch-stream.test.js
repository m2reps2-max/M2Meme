'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {LaunchStream}=require('../lib/launch-stream');

class FakeWebSocket extends EventEmitter {
 static OPEN=1;
 constructor(){super();this.readyState=0;this.sent=[];}
 send(value){this.sent.push(JSON.parse(value));}
 close(){this.readyState=3;this.emit('close');}
}

test('launch stream subscribes only to free creation and migration feeds',()=>{
 const stream=new LaunchStream({WebSocketImpl:FakeWebSocket});
 stream.start();
 const socket=stream.socket;
 socket.readyState=1;socket.emit('open');
 assert.deepEqual(socket.sent,[{method:'subscribeNewToken'},{method:'subscribeMigration'}]);
 assert.equal(stream.status().connected,true);
 stream.stop();
});

test('launch stream dispatches creation and migration events',()=>{
 const events=[];
 const stream=new LaunchStream({WebSocketImpl:FakeWebSocket,onToken:x=>events.push(['token',x.mint]),onMigration:x=>events.push(['migration',x.mint])});
 stream.start();
 const socket=stream.socket;
 socket.readyState=1;socket.emit('open');
 socket.emit('message',Buffer.from(JSON.stringify({txType:'create',mint:'Mint111'})));
 socket.emit('message',Buffer.from(JSON.stringify({txType:'migrate',mint:'Mint222'})));
 assert.deepEqual(events,[['token','Mint111'],['migration','Mint222']]);
 stream.stop();
});
