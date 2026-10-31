import test from 'node:test';import assert from 'node:assert/strict';
import {createSessionSpeech} from './session-speech.js';
import {EventEmitter} from 'node:events';import {playToAudience} from './authorized-playback.js';
const scope={guildId:'111111111111111111',channelId:'222222222222222222',userId:'333333333333333333'},lease='40000000-0000-4000-8000-000000000001';
test('Discord keeps a dispatcher until playback completes, forwards its lease and releases after failure',async()=>{
 const calls=[];const speech=createSessionSpeech({controlUrl:'https://fixture.invalid/voice',workerKey:'synthetic',fetchImpl:async(_,init)=>{const body=JSON.parse(init.body);calls.push(body);if(body.session_action==='desk')return Response.json(body.mode==='claim'?{ready:true,voice_id:'approved',lease_id:body.lease_id}:{released:true});return new Response(new Uint8Array(120));}});
 await assert.rejects(speech.withDesk(scope,async desk=>{assert.match(desk.lease_id,/^[0-9a-f-]{36}$/i);await speech.speak('Radio check','approved',scope,desk.lease_id);assert.equal(calls.some(c=>c.mode==='release'),false);throw Error('Synthetic playback failure');}),/Synthetic playback failure/);
 assert.equal(calls.find(c=>c.session_action==='speak').lease_id,calls[0].lease_id);assert.equal(calls.at(-1).mode,'release');assert.equal(calls.at(-1).lease_id,calls[0].lease_id);
});
test('busy desks wait without generating speech or running a task twice',async()=>{let claims=0,waits=0,runs=0;const speech=createSessionSpeech({controlUrl:'https://fixture.invalid/voice',workerKey:'synthetic',wait:async()=>waits++,fetchImpl:async(_,init)=>{const b=JSON.parse(init.body);return Response.json(b.mode==='release'?{released:true}:++claims<3?{ready:false,retry_after:2}:{ready:true,voice_id:'approved',lease_id:b.lease_id});}});await speech.withDesk(scope,async()=>runs++);assert.equal(claims,3);assert.equal(waits,2);assert.equal(runs,1);});
test('a denied desk cannot synthesize or play a reply',async()=>{let ran=false;const speech=createSessionSpeech({controlUrl:'https://fixture.invalid/voice',workerKey:'synthetic',fetchImpl:async()=>new Response('',{status:403})});await assert.rejects(speech.withDesk(scope,()=>ran=true),/403/);assert.equal(ran,false);});
test('expired renewal stops the actual active Discord playback before releasing the original desk',async()=>{
 let next=0,started=false;const timers=new Map(),calls=[],player=new EventEmitter(),gateway=new EventEmitter();player.play=()=>started=true;player.stop=()=>player.stopped=true;
 const speech=createSessionSpeech({controlUrl:'https://fixture.invalid/voice',workerKey:'synthetic',setTimer:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimer:id=>timers.delete(id),fetchImpl:async(_,init)=>{
  const b=JSON.parse(init.body);calls.push(b);if(b.mode==='check')return new Response('',{status:403});return Response.json(b.mode==='release'?{released:true}:{ready:true,voice_id:'approved',lease_id:b.lease_id});
 }});
 const p=speech.withDesk(scope,desk=>playToAudience({player,gateway,channel:{members:new Map([['allowed',{id:'allowed',user:{bot:false}}]])},resource:{},guildId:scope.guildId,channelId:scope.channelId,authorized:new Set(['allowed']),signal:desk.signal}));
 const denied=assert.rejects(p,/403/);for(let i=0;i<25;i++)await Promise.resolve();assert.equal(started,true);
 const entry=[...timers].find(([,v])=>v.ms===30000);assert.ok(entry);timers.delete(entry[0]);entry[1].fn();await denied;
 assert.equal(player.stopped,true);assert.equal(gateway.listenerCount('voiceStateUpdate'),0);assert.equal(timers.size,0);
 assert.deepEqual(calls.map(c=>c.mode),['claim','check','release']);assert.ok(calls.every(c=>c.lease_id===calls[0].lease_id));
});
