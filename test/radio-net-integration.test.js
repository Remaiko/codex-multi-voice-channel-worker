import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync}from'node:fs';
import {createRadioNetGuard,routeNet,primaryNet}from'../src/radio-nets.js';
import {createRadioScheduler}from'../src/radio-scheduler.js';import {createGuildQueue}from'../src/guild-queue.js';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8'),g='guild',c='channel';
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('production automatic playback stops on retuning while interactive replies remain available',async()=>{
 const radioNets=createRadioNetGuard(),routes=net=>new Map([[g+':'+c,{radio_net:net}]]);radioNets.update(routes('radio'));
 let started=0;const context={radioNets,scheduleRadio:createRadioScheduler(),inGuild:createGuildQueue(),queueKey:()=>g+':bot',Error,String,
 playDelivery:async request=>{started++;await request.authorizeForPlayback?.();if(request.interactive)return{played:true};return new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}));}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function play(req,'),source.indexOf('async function playDelivery')),context);
 const req={guildId:g,voiceChannelId:c,radioNet:'radio',eventId:'1',authorizeForPlayback:async()=>['authorized']};
 const active=context.play(req,{priority:1}),denied=assert.rejects(active,e=>e.code==='RADIO_NET_CHANGED');await tick();assert.equal(started,1);
 const queued=context.play({...req,eventId:'2'},{priority:1}),queuedDenied=assert.rejects(queued,e=>e.code==='RADIO_NET_CHANGED');radioNets.update(routes('radio:patrol2'));await Promise.all([denied,queuedDenied]);assert.equal(started,1);
 assert.equal((await context.play({...req,interactive:true})).played,true);assert.equal(started,2);
 radioNets.update(routes('radio'));await tick();assert.equal(started,2);
});
test('production delivery poll discards known side-net events but retries unknown routes without synthesis',async()=>{
 const deliveries=[{id:'1',guild_id:g,voice_channel_id:c,agency_code:'BCSO'}],acks=[];let syntheses=0,known=true;
 const context={shuttingDown:false,lastEventPollAt:0,Date,Promise,String,console:{log(){},error(){}},routeNet,primaryNet,voiceRouteKey:(a,b)=>a+':'+b,routes:new Map(),
 routeFor:()=>{if(!known)throw Error('Unknown route');return{radio_net:'radio:patrol2'};},control:async(action,body)=>action==='claim'?{deliveries}:(acks.push(body),{}),
 selectedDispatchVoice:()=>{syntheses++;throw Error('Unexpected provider work');}};
 vm.createContext(context);const start=source.indexOf('async function deliver(){'),end=source.indexOf('// v43.30',start);vm.runInContext(source.slice(start,end),context);
 await context.deliver();assert.equal(syntheses,0);assert.equal(acks[0].ok,true);assert.equal(acks[0].error,'side_net_skipped');known=false;await context.deliver();assert.equal(syntheses,0);assert.equal(acks[1].ok,false);assert.match(acks[1].error,/Unknown route/);
});
