import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRadioScheduler} from '../src/radio-scheduler.js';
import {createGuildQueue} from '../src/guild-queue.js';
import {playToAudience} from '../src/authorized-playback.js';
const tick=async()=>{for(let n=0;n<12;n++)await new Promise(setImmediate);};
test('the actual worker play entry stops ordinary Discord playback before starting duress',async()=>{
 const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
 const start=source.indexOf('function play(req,'),end=source.indexOf('async function playDelivery(req)');
 assert.ok(start>=0&&end>start);
 const normal=new AbortController(),emergency=new AbortController(),players=new Map(),gateway=new EventEmitter(),seen=[];
 const context={scheduleRadio:createRadioScheduler(),inGuild:createGuildQueue(),queueKey:(g,c)=>g+':'+c,
  radioNets:{run:(_g,_c,_n,task,{signal})=>task({signal,assertCurrent(){}})},
  playDelivery:async req=>{const player=new EventEmitter();players.set(req.voiceChannelId,player);player.play=()=>seen.push('play '+req.voiceChannelId);player.stop=()=>{player.stopped=true;seen.push('stop '+req.voiceChannelId);};
   await playToAudience({signal:req.signal,player,gateway,channel:{members:new Map([['allowed',{id:'allowed',user:{bot:false}}]])},resource:{},guildId:'guild',channelId:req.voiceChannelId,authorized:new Set(['allowed'])});return {played:true};}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const request=(channel,signal)=>({guildId:'guild',voiceChannelId:channel,eventId:channel==='routine'?'1':'2',radioNet:'radio',signal,authorizeForPlayback:async()=>['allowed']});
 const first=context.play(request('routine',normal.signal)).catch(error=>error);let second;
 try{await tick();assert.deepEqual(seen,['play routine']);second=context.play(request('duress',emergency.signal),{priority:2}).catch(error=>error);await tick();
  assert.equal(players.get('routine').stopped,true,'duress must stop ordinary playback rather than wait behind it');
  assert.deepEqual(seen,['play routine','stop routine','play duress']);players.get('duress').emit('idle');
  assert.match((await first).message,/Emergency radio traffic/);assert.equal((await second).played,true);assert.equal(gateway.listenerCount('voiceStateUpdate'),0);
 }finally{normal.abort(Error('Fixture cleanup'));emergency.abort(Error('Fixture cleanup'));await Promise.allSettled([first,second]);}
});

test('the actual delivery loop gives emergency priority only to an authoritative duress event',async()=>{
 const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8'),priorities=[],acks=[];
 const context={shuttingDown:false,lastEventPollAt:0,Date,console:{log(){},error(error){throw Error(error);}},
  control:async(action,args)=>action==='claim'?{deliveries:['duress','new','update'].map((kind,n)=>({id:String(n+1),kind,guild_id:'guild',agency_code:'ALL',voice_channel_id:'channel',payload:{message:'duress mentioned in ordinary update'}}))}:(acks.push(args),{}),
  routeNet:()=> 'radio',routeFor:()=>({}),primaryNet:()=>true,selectedDispatchVoice:()=>null,lastVoiceChoice:new Map(),
  deliverAudienceBound:async(delivery,handlers)=>{await handlers.play({eventId:delivery.id});return {played:true};},
  makeSpeech(){},dispatchOpening(){},sayDelivery(){},assembleDispatchAudio(){},decodePcm(){},currentDeliveryAudience(){},
  play:async(req,options)=>priorities.push({event:req.eventId,priority:options.priority}),rememberTransmission(){},lastAnnouncements:new Map()};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function deliver(){'),source.indexOf('// v43.30 optional receive pipeline')),context);await context.deliver();
 assert.deepEqual(priorities,[{event:'1',priority:2},{event:'2',priority:1},{event:'3',priority:1}]);assert.equal(acks.length,3);assert.ok(acks.every(a=>a.ok===true));
});
