import {dispatchBody,dispatchOpening} from './dispatch-message.js';
import {prepareRadioSpeech} from './radio-speech.js';
import {operationalIntentAllowed,voiceCommandText} from './operational-commands.js';
import {audienceStatus} from './voice-audience.js';
import {codeReply} from './radio-reference.js';
import {stereoToMono} from './realtime-speech.js';
import {createSessionSpeech} from './session-speech.js';
import {closeVoiceWorker} from './shutdown.js';
import {voicePresence} from './voice-presence.js';
import {createPresencePublisher,createPresenceRouteSync} from './presence-sync.js';
import http from 'node:http';
import workerPackage from '../package.json' with {type:'json'};
import {deliverValidated} from './delivery-validation.js';
import {rememberTransmission,repeatTransmission} from './repeat-delivery.js';
import {deliverAudienceBound} from './delivery-audience.js';
import {createDispatchAgent} from './dispatch-agent.js';
import {dispatchEventId,selectedDispatchVoice,assembleDispatchAudio,decodePcm} from './dispatch-recording.js';
import {Readable} from 'node:stream';
import prism from 'prism-media';
import {timingSafeEqual,randomUUID as randomUuid} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Client,GatewayIntentBits,ChannelType} from 'discord.js';
import {AudioPlayerStatus,NoSubscriberBehavior,StreamType,EndBehaviorType,createAudioPlayer,createAudioResource,joinVoiceChannel,entersState,VoiceConnectionStatus} from '@discordjs/voice';
import {voicePolicy,canListen,canBroadcast,parseVoiceCommand,describeVoiceResult} from './voice-policy.js';
import {flattenVoiceRoutes,voiceRouteKey} from './voice-routes.js';
import {recognitionConfig,transcribeAudio} from './speech-recognition.js';
import {playToAudience} from './authorized-playback.js';
import {createGuildQueue,idleRoutes} from './guild-queue.js';
import {botCredentials,selectVoiceBot,companionConfiguration} from './bot-pool.js';
import {synthesizeElevenLabs} from './elevenlabs.js';
import {fleetInput,fleetReport,reconnectFleetBot} from './fleet-control.js';
import {createFleetBranding} from './fleet-branding.js';
const applyFleetBranding=createFleetBranding();
import {ensureConnectionReady} from './connection-ready.js';

const token=process.env.DISCORD_BOT_TOKEN;
const workerKey=process.env.VOICE_WORKER_KEY||'';
const port=Number(process.env.PORT||8080);
const maxBody=5*1024*1024;
if(!token)throw Error('DISCORD_BOT_TOKEN is required.');
if(!/^[a-f0-9]{64}$/.test(workerKey))throw Error('VOICE_WORKER_KEY must be a private 64-character hex key.');

// Each bot identity holds one session per guild. Companions allow simultaneous rooms.
const controlUrl=process.env.VOICE_CONTROL_URL||'https://midnight-cad-discord-test.vercel.app/api/voice';
const voiceRouteUrl=process.env.VOICE_ROUTE_URL||controlUrl;
const voiceCommandUrl=process.env.VOICE_COMMAND_URL||new URL('/api/voice-command',controlUrl).href;
const cadCommandUrl=process.env.VOICE_COMMANDS_ENABLED==='true'?voiceCommandUrl:'';
const routes=new Map();
const bots=botCredentials(token,companionConfiguration(process.env)).map(spec=>({...spec,client:new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]})}));
const client=bots[0].client;
const connections=new Map();
const inGuild=createGuildQueue();
const recent=new Map();
const recentReplies=new Map();
const lastAnnouncements=new Map();
const receiving=new Set();
const cooldowns=new Map();
const recentSpeech=new Map();
let lastRouteSyncAt=0,lastEventPollAt=0,presenceTimer=null,shuttingDown=false;
const configuredSpeech=recognitionConfig(process.env);
const speechConfig=configuredSpeech.provider==='none'&&['auto',undefined].includes(process.env.VOICE_STT_PROVIDER)?{provider:'cad-relay',apiKey:null}:configuredSpeech;
const sessionSpeech=createSessionSpeech({controlUrl,workerKey});
const lastVoiceChoice=new Map();
const inputEnabled=process.env.VOICE_INPUT_ENABLED==='true' && Boolean(speechConfig.apiKey||speechConfig.provider==='cad-relay');
let speechSelfTest=inputEnabled?'waiting_for_opt_in':'disabled',speechTestFlight=null;
const wakePhrase=(process.env.VOICE_WAKE_PHRASE||'dispatch').toLowerCase();
const routeBot=route=>selectVoiceBot(bots,route);
const queueKey=(guildId,channelId)=>String(guildId)+':'+routeBot(routes.get(voiceRouteKey(guildId,channelId))).key;
const idleVoiceRoutes=()=>idleRoutes([...routes.values()],[...connections.values()],route=>routeBot(route).key);

function respond(res,status,value){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
function authorized(req){const got=Buffer.from(req.headers.authorization||'');const want=Buffer.from(`Bearer ${workerKey}`);return got.length===want.length&&timingSafeEqual(got,want);}
function readJson(req){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',b=>{size+=b.length;if(size>maxBody){reject(Error('body too large'));req.destroy();return;}chunks.push(b);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('invalid JSON'));}});req.on('error',reject);});}
function routeFor(guildId,agencyCode,channelId){const route=routes.get(voiceRouteKey(guildId,channelId));if(!route||!/^\d{15,22}$/.test(route.voice_channel_id||''))throw Error('Voice dispatch is not configured for this channel.');if(route.agency_code!=='ALL'&&route.agency_code!==agencyCode)throw Error('No active voice route for this agency.');return route;}
async function voiceFor(guildId,channelId){
 const bot=routeBot(routes.get(voiceRouteKey(guildId,channelId)));
 const guild=bot.client.guilds.cache.get(guildId);if(!guild)throw Error('The selected department bot is not installed or ready in this server.');
 const channel=await guild.channels.fetch(channelId);if(!channel||channel.type!==ChannelType.GuildVoice)throw Error('Configured destination must be a standard voice channel.');
 const me=await guild.members.fetchMe();const permissions=channel.permissionsFor(me);if(!permissions?.has(['Connect','Speak']))throw Error('The bot needs Connect and Speak in the configured voice channel.');
 const key=voiceRouteKey(guildId,channelId);
 let state=connections.get(key);if(state&&state.botKey!==bot.key){connections.delete(key);state.connection.destroy();state=null;}
 if(!state){for(const [otherKey,other] of connections){if(other.guildId===guildId&&other.botKey===bot.key&&other.channelId!==channelId){connections.delete(otherKey);other.connection.destroy();}}const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Stop}});const connection=joinVoiceChannel({guildId,channelId,group:bot.key,adapterCreator:guild.voiceAdapterCreator,selfDeaf:!inputEnabled,selfMute:false});connection.subscribe(player);state={connection,player,channelId,guildId,botKey:bot.key,gateway:bot.client,tail:Promise.resolve()};connections.set(key,state);if(inputEnabled)setupReceiver(guildId,state);connection.on('error',error=>{console.error('Discord voice connection error',key,String(error?.message||error).slice(0,160));if(connections.get(key)===state){connections.delete(key);try{connection.destroy()}catch{}}});connection.on(VoiceConnectionStatus.Disconnected,()=>{if(connections.get(key)===state){connections.delete(key);try{connection.destroy()}catch{}}});}
 return ensureConnectionReady({connections,key,state,readyStatus:VoiceConnectionStatus.Ready,wait:()=>entersState(state.connection,VoiceConnectionStatus.Ready,15_000)});
}
function play(req,{priority=0}={}){const scope=queueKey(req.guildId,req.voiceChannelId);return inGuild(scope,()=>{if(queueKey(req.guildId,req.voiceChannelId)!==scope)throw Error('Voice route changed; retry delivery.');return playDelivery(req);},{priority});}
async function playDelivery(req){
 const {guildId,agencyCode,eventId,voiceChannelId,audioBase64,authorizedUserIds}=req;
 if(!/^\d{15,22}$/.test(guildId||'')||!dispatchEventId(eventId))throw Error('Invalid dispatch identifiers.');
 if(!/^[A-Z0-9_-]{1,20}$/.test(agencyCode||''))throw Error('Invalid agency code.');
 const route=routeFor(guildId,agencyCode,voiceChannelId);
 if(route.voice_channel_id!==voiceChannelId)throw Error('Voice channel route changed.');
 if(!Array.isArray(authorizedUserIds)||authorizedUserIds.length>100||authorizedUserIds.some(id=>!/^\d{15,22}$/.test(String(id))))throw Error('Authorized on-duty listener list is required.');
 if(!/^[A-Za-z0-9+/]+=*$/.test(audioBase64||''))throw Error('A prepared audio file is required.');
 const audio=Buffer.from(audioBase64,'base64');if(audio.length<64||audio.length>(req.audioFormat==='pcm'?24:4)*1024*1024)throw Error('Audio is empty or exceeds the playback size limit.');
 const key=`${guildId}:${eventId}:${voiceChannelId}`;if(recent.has(key))return {played:false,duplicate:true};
 const state=await voiceFor(guildId,route.voice_channel_id);
 const voiceChannel=await state.gateway.guilds.cache.get(guildId).channels.fetch(route.voice_channel_id);
 const authorized=new Set(authorizedUserIds.map(String));
 const listeners=[...voiceChannel.members.values()].filter(member=>!member.user.bot);
 if(listeners.length===0)throw Error('No opted-in responders are present in the voice channel.');
 if(listeners.some(member=>!authorized.has(member.id)))throw Error('Voice dispatch paused: an unauthorized listener is in the channel.');
 state.tail=state.tail.catch(()=>{}).then(async()=>{
  if(typeof req.authorizeForPlayback==='function'){
   const current=await req.authorizeForPlayback();
   if(!Array.isArray(current)||!current.length||current.length>100||current.some(id=>typeof id!=='string'||!/^\d{15,22}$/.test(id)))throw Error('Voice authorization changed while waiting for playback.');
   authorized.clear();for(const id of current)authorized.add(id);
  }
  return playToAudience({player:state.player,gateway:state.gateway,channel:voiceChannel,resource:createAudioResource(Readable.from(audio),{inputType:req.audioFormat==='pcm'?StreamType.Raw:StreamType.Arbitrary}),guildId,channelId:voiceChannelId,authorized,idleEvent:AudioPlayerStatus.Idle});
 });
 await state.tail;recent.set(key,Date.now());for(const [k,t] of recent)if(Date.now()-t>15*60_000)recent.delete(k);
 return {played:true,guildId,agencyCode};
}

function localSpeech(text){return new Promise((resolve,reject)=>{const child=spawn('espeak-ng',['-v',process.env.VOICE_NAME||'en-us+f3','-s',process.env.VOICE_SPEED||'155','--stdout',text],{stdio:['ignore','pipe','ignore']});const chunks=[];let size=0;child.stdout.on('data',b=>{size+=b.length;if(size>2*1024*1024){child.kill();reject(Error('Synthesized voice message is too large.'));}else chunks.push(b);});child.once('error',reject);child.once('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(Error('Speech synthesis failed.')));});}
async function say(text,voiceId){
 const apiKey=process.env.ELEVENLABS_API_KEY;
 if(apiKey){
  try{return await synthesizeElevenLabs({text,apiKey,voiceId:selectedDispatchVoice(voiceId,process.env.ELEVENLABS_VOICE_ID||'DODLEQrClDo8wCz460ld'),modelId:process.env.ELEVENLABS_MODEL_ID||'eleven_multilingual_v2'});}
  catch(e){console.error('ElevenLabs TTS failed; using local voice.',String(e.message||e).slice(0,120));}
 }
 return localSpeech(text);
}
async function sayDelivery(delivery,text,{notice=false}={}){
 const pcm=await prepareRadioSpeech(text,{decode:decodePcm,speak:async segment=>{
 const response=await fetch(controlUrl,{method:'POST',headers:{Authorization:`Bearer ${workerKey}`,'Content-Type':'application/json'},body:JSON.stringify({action:'speech',id:delivery.id,text:segment,notice:notice===true}),signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error('Selected dispatch voice unavailable ('+response.status+').');
 const audio=Buffer.from(await response.arrayBuffer());if(audio.length<100||audio.length>4000000)throw Error('Invalid dispatch speech recording.');return audio;
 }});return wavFromPcm(pcm);
}
const makeSpeech=dispatchBody;
async function control(action,extra={}){const response=await fetch(action==='routes'?voiceRouteUrl:controlUrl,{method:'POST',headers:{Authorization:`Bearer ${workerKey}`,'Content-Type':'application/json'},body:JSON.stringify({action,...extra}),signal:AbortSignal.timeout(20_000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Voice control endpoint failed.');return data;}
const presencePublisher=createPresencePublisher();
const syncRoutes=createPresenceRouteSync({capture:()=>voicePresence(connections,bots),refresh:syncRoutesOnce,after:()=>ensureSpeechReady(),active:()=>!shuttingDown});
async function syncRoutesOnce(presence){const publication=presencePublisher.request(presence);try{const response=await fetch(voiceRouteUrl,{method:'POST',headers:{Authorization:`Bearer ${workerKey}`,'Content-Type':'application/json'},body:JSON.stringify({action:'routes',...publication.payload}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Voice routes endpoint rejected request ('+response.status+')');const data=await response.json();if(!Array.isArray(data.routes))throw Error('Invalid routes payload');publication.acknowledge();const wanted=new Map(flattenVoiceRoutes(data.routes).map(r=>[voiceRouteKey(String(r.guild_id),r.voice_channel_id),r]));for(const [key,state] of connections){if((!wanted.has(key)||routeBot(wanted.get(key)).key!==state.botKey)){state.connection.destroy();connections.delete(key);}}routes.clear();for(const [key,r] of wanted)routes.set(key,r);lastRouteSyncAt=Date.now();for(const r of idleVoiceRoutes()){try{await inGuild(queueKey(r.guild_id,r.voice_channel_id),()=>{const chosen=idleVoiceRoutes().find(x=>String(x.guild_id)===String(r.guild_id)&&routeBot(x).key===routeBot(r).key);return chosen?voiceFor(String(chosen.guild_id),chosen.voice_channel_id):undefined;});}catch(e){console.error('Voice route unavailable',voiceRouteKey(r.guild_id,r.voice_channel_id),String(e.message||e));}}}catch(e){console.error('Voice route sync failed',String(e.message||e));}}
async function preflightAudience(delivery,verified){const guildId=String(delivery.guild_id),channelId=String(delivery.voice_channel_id);routeFor(guildId,delivery.agency_code,channelId);const state=await voiceFor(guildId,channelId);const channel=await state.gateway.guilds.cache.get(guildId).channels.fetch(channelId);const ids=[...channel.members.values()].filter(m=>!m.user.bot).map(m=>String(m.id));if(!ids.length)throw Error('No opted-in responders are present in the voice channel.');const allowed=new Set((verified.authorized_user_ids||[]).map(String));if(!ids.every(id=>allowed.has(id)))throw Error('Voice dispatch paused: an unauthorized listener is in the channel.');}
async function deliver(){if(shuttingDown)return;try{const {deliveries=[]}=await control('claim');lastEventPollAt=Date.now();await Promise.all(deliveries.map(async d=>{try{if(selectedDispatchVoice(d.voice_id))lastVoiceChoice.set(String(d.guild_id),selectedDispatchVoice(d.voice_id));const result=await deliverAudienceBound(d,{plan:id=>control('delivery_plan',{id}),audience:()=>currentDeliveryAudience(d),makeSpeech,makeOpening:dispatchOpening,say:(text,voice,notice)=>sayDelivery(d,text,{notice}),assemble:assembleDispatchAudio,decode:decodePcm,play:req=>play(req,{priority:1})});if(!result.played){await control('ack',{id:d.id,ok:false,error:'delivery_no_longer_active',retry_seconds:60});return;}rememberTransmission(lastAnnouncements,d,result);await control('ack',{id:d.id,ok:true});console.log('Voice dispatch delivered',String(d.id),String(d.voice_channel_id));}catch(e){await control('ack',{id:d.id,ok:false,error:String(e.message||'voice_failed').slice(0,80),retry_seconds:60}).catch(()=>{});console.error('Voice dispatch failed',String(d.id),String(e.message||e));}}));}catch(e){console.error('Voice event poll failed',String(e.message||e));}}


// v43.30 optional receive pipeline. Explicit opt-in must be recorded by the CAD route
// and the Discord speaker must appear on the route's verified on-duty allowlist.
// Do not silently listen to arbitrary Discord conversations.
function allowedSpeakers(guildId,channelId){return voicePolicy(routes.get(voiceRouteKey(guildId,channelId)),guildId).speakers;}
function allowedListeners(guildId,channelId){return voicePolicy(routes.get(voiceRouteKey(guildId,channelId)),guildId).listeners;}
function wavFromPcm(pcm){
 const header=Buffer.alloc(44),channels=2,rate=48000,bits=16;
 header.write('RIFF',0);header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);
 header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(channels,22);
 header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*channels*bits/8,28);
 header.writeUInt16LE(channels*bits/8,32);header.writeUInt16LE(bits,34);
 header.write('data',36);header.writeUInt32LE(pcm.length,40);
 return Buffer.concat([header,pcm]);
}
async function transcribeWav(audio,scope){return speechConfig.provider==='cad-relay'?sessionSpeech.transcribe(audio,scope):transcribeAudio({audio,config:speechConfig});}
async function transcribe(pcm,scope){return transcribeWav(wavFromPcm(pcm),scope);}
function ensureSpeechReady(){if(!inputEnabled||speechTestFlight||speechSelfTest==='passed')return;let scope;for(const route of routes.values()){const state=connections.get(voiceRouteKey(route.guild_id,route.voice_channel_id));const members=state?.gateway.guilds.cache.get(String(route.guild_id))?.channels.cache.get(String(route.voice_channel_id))?.members;const userId=route.voice_listen_enabled===true&&route.authorized_user_ids?.find(id=>members?.has(String(id)));if(userId){scope={guildId:String(route.guild_id),channelId:String(route.voice_channel_id),userId:String(userId)};break;}}if(!scope){speechSelfTest='waiting_for_opt_in';return;}speechSelfTest='pending';speechTestFlight=(async()=>{try{const sample=await localSpeech(wakePhrase+', radio check.');let text;if(speechConfig.provider==='cad-relay'){const stream=sessionSpeech.openInput(scope);stream.write(stereoToMono(await decodePcm(sample)));text=await stream.finish();}else{text=await transcribeWav(sample,scope);}if(parseVoiceCommand(text,wakePhrase)?.action!=='radio_check')throw Error('Synthetic command was not recognized.');speechSelfTest='passed';console.log(JSON.stringify({speechSelfTest:'passed',provider:speechConfig.provider}));}catch(error){speechSelfTest='failed';console.error('Synthetic speech check failed:',String(error.message||error).slice(0,140));}finally{speechTestFlight=null;}})();}
async function replyInGuild(guildId,channelId,userId,message,expectedScopeTag=null){
 const state=connections.get(voiceRouteKey(guildId,channelId));
 if(!state)return;
 const r=routeFor(guildId,routes.get(voiceRouteKey(guildId,state.channelId))?.agency_code||'ALL',state.channelId);
 if(!canListen(voicePolicy(routes.get(voiceRouteKey(guildId,state.channelId)),guildId),userId))return;
 const permitted=Array.isArray(r.authorized_listener_ids)?r.authorized_listener_ids.map(String):[];
 if(!permitted.includes(String(userId)))return;
 const audience=audienceStatus(r,state.gateway.guilds.cache.get(guildId)?.channels.cache.get(channelId)?.members);
 if(!audience.playback_ready)throw Error(audience.blocked_listeners?'Voice dispatch paused: a listener needs CAD linking, on-duty department access and voice alerts.':'No authorized listeners are present.');
 const replyText=String(message).replace(/[\x00-\x1F]/g,' ');
 const replyScope={guildId,channelId,userId};let replyTag=expectedScopeTag;
 const verifyReplyScope=async()=>{const current=await sessionSpeech.scope(replyScope);if(current?.allowed!==true||!/^[a-f0-9]{64}$/.test(current.scope_tag||''))throw Error('VOICE_SCOPE_REVOKED');if(replyTag&&replyTag!==current.scope_tag)throw Error('VOICE_IDENTITY_CHANGED');replyTag=current.scope_tag;};
 await verifyReplyScope();

 return sessionSpeech.withDesk(replyScope,async desk=>{
 const voice=desk.voice_id;
 const synthesisStart=Date.now();const audio=await prepareRadioSpeech(replyText,{decode:decodePcm,speak:segment=>sessionSpeech.speak(segment,voice,{guildId,channelId,userId},desk.lease_id)});
 console.log(JSON.stringify({voiceReplyTiming:{synthesisMs:Date.now()-synthesisStart}}));
 await play({guildId,agencyCode:r.agency_code,eventId:String(BigInt(Date.now())*1000000n+BigInt(Math.floor(Math.random()*1000000))),voiceChannelId:r.voice_channel_id,authorizedUserIds:permitted,audioFormat:'pcm',audioBase64:audio.toString('base64'),authorizeForPlayback:async()=>{await verifyReplyScope();const latest=routes.get(voiceRouteKey(guildId,channelId));if(!canListen(voicePolicy(latest,guildId),userId))throw Error('VOICE_SCOPE_REVOKED');const current=new Set((latest?.authorized_listener_ids||[]).map(String));const intersection=permitted.filter(id=>current.has(id));if(!intersection.includes(String(userId)))throw Error('VOICE_SCOPE_REVOKED');return intersection;}});
 });
}
// A repeat is a fresh authorization, not a replay to everybody currently on the route.
async function repeatLastDispatch(guildId,channelId,userId){
 try{
  const result=await sessionSpeech.withDesk({guildId,channelId,userId},desk=>repeatTransmission({
   entry:lastAnnouncements.get(voiceRouteKey(guildId,channelId)),guildId,channelId,userId,
   validate:id=>control('repeat_validate',{id}),
   audience:async()=>{
    const state=connections.get(voiceRouteKey(guildId,channelId));
    if(!state)return [];
    const channel=await state.gateway.guilds.cache.get(guildId)?.channels.fetch(channelId);
    return [...(channel?.members?.values()||[])].filter(member=>!member.user.bot).map(member=>String(member.id));
   },
   synthesize:(text,voice)=>prepareRadioSpeech(text,{decode:decodePcm,
    speak:segment=>sessionSpeech.speak(segment,desk.voice_id,{guildId,channelId,userId},desk.lease_id)}),
   isVoiceApproved:voice=>selectedDispatchVoice(voice)===voice,
   playbackId:()=>String(BigInt(Date.now())*1000000n+BigInt(Math.floor(Math.random()*1000000))),
   play
  }));
  if(result.played)return;
 }catch(error){console.warn('Dispatch repeat unavailable; fresh authority or audio could not be confirmed.');}
 // This generic response contains no cached incident data. Existing input/room checks remain.
 return replyInGuild(guildId,channelId,userId,'No previous transmission is currently authorized for everyone in this channel.');
}

// Capture the actual current humans after resolving this existing configured department route.
async function currentDeliveryAudience(delivery){
 const guildId=String(delivery.guild_id),channelId=String(delivery.voice_channel_id);
 routeFor(guildId,delivery.agency_code,channelId);
 const state=await voiceFor(guildId,channelId);
 const channel=await state.gateway.guilds.cache.get(guildId)?.channels.fetch(channelId);
 return [...(channel?.members?.values()||[])].filter(member=>!member.user.bot).map(member=>String(member.id));
}

const dispatchAgent=createDispatchAgent({
 scope:scope=>sessionSpeech.scope(scope),
 interpret:(text,history,scope)=>sessionSpeech.interpret(text,history,scope),
 isActive:scope=>{
  const routeKey=voiceRouteKey(scope.guildId,scope.channelId),state=connections.get(routeKey);
  const present=state?.gateway.guilds.cache.get(scope.guildId)?.channels.cache.get(scope.channelId)?.members;
  return !!state&&present?.has(scope.userId)===true&&canListen(voicePolicy(routes.get(routeKey),scope.guildId),scope.userId);
 },
 reply:(scope,text,tag)=>replyInGuild(scope.guildId,scope.channelId,scope.userId,text,tag),
 repeat:scope=>repeatLastDispatch(scope.guildId,scope.channelId,scope.userId),
 execute:async(scope,command,requestId,scopeTag)=>{
  if(!cadCommandUrl)throw Object.assign(Error('CAD command endpoint unavailable'),{definitive:true});
  const target=new URL(cadCommandUrl);
  if(target.protocol!=='https:'||target.origin!==new URL(controlUrl).origin)throw Object.assign(Error('Untrusted CAD command origin'),{definitive:true});
  const response=await fetch(target,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+workerKey},body:JSON.stringify({guild_id:scope.guildId,channel_id:scope.channelId,user_id:scope.userId,action:'command',source:'discord-voice',command,request_id:requestId,scope_tag:scopeTag}),signal:AbortSignal.timeout(12000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(Error('CAD action not confirmed'),{definitive:response.status>=400&&response.status<500&&result?.definitive===true});
  return result;
 },wake:wakePhrase
});
async function handleVoiceCommand(guildId,channelId,userId,text){
 return dispatchAgent.handle({guildId:String(guildId),channelId:String(channelId),userId:String(userId)},text);
}
function cryptoRandomId(){return randomUuid()}

function setupReceiver(guildId,state){
 const receiver=state.connection.receiver;
 if(!receiver)return;
 receiver.speaking.on('start',async(userId)=>{
  if(shuttingDown||speechSelfTest!=='passed')return;
  const routeKey=voiceRouteKey(guildId,state.channelId);
  const key=routeKey+':'+userId;
  if(receiving.has(key)||!canListen(voicePolicy(routes.get(routeKey),guildId),userId))return;
  const channel=state.gateway.guilds.cache.get(guildId)?.channels.cache.get(state.channelId);
  const member=channel?.members?.get(userId);
  if(!member||member.user.bot||!canListen(voicePolicy(routes.get(routeKey),guildId),userId))return;
  receiving.add(key);let inputStream;
  try{
   const opus=receiver.subscribe(userId,{end:{behavior:EndBehaviorType.AfterSilence,duration:650}});
   const decoder=new prism.opus.Decoder({frameSize:960,channels:2,rate:48000});
   const pcm=[],cap=48000*2*2*12;let size=0;const captureStart=Date.now(),stream=inputStream=speechConfig.provider==='cad-relay'?sessionSpeech.openInput({guildId,channelId:state.channelId,userId}):null;
   opus.pipe(decoder);
   for await(const part of decoder){
    size+=part.length;if(size>cap||connections.get(routeKey)!==state||!canListen(voicePolicy(routes.get(routeKey),guildId),userId)){stream?.cancel();opus.destroy();break;}if(stream)stream.write(stereoToMono(part));else pcm.push(part);
   }
   if(connections.get(routeKey)!==state||size<48000*2*2*0.4||size>cap||!canListen(voicePolicy(routes.get(routeKey),guildId),userId)){stream?.cancel();return;}
   const captureMs=Date.now()-captureStart,recognitionStart=Date.now();
   const transcript=stream?await stream.finish():await transcribe(Buffer.concat(pcm),{guildId,channelId:state.channelId,userId});
   console.log(JSON.stringify({voiceInputTiming:{captureMs,recognitionMs:Date.now()-recognitionStart,recognizedAction:parseVoiceCommand(transcript,wakePhrase)?.action||'none'}}));
   if(transcript)await handleVoiceCommand(guildId,state.channelId,userId,transcript);
  }catch(e){console.warn('Speech input could not be handled:',String(e.message||e).slice(0,140))}
  finally{inputStream?.cancel();receiving.delete(key)}
 });
}

for(const bot of bots){bot.client.on('voiceStateUpdate',()=>{clearTimeout(presenceTimer);presenceTimer=setTimeout(()=>void syncRoutes(),250);});bot.client.once('ready',()=>{console.log(JSON.stringify({service:'midnight-cad-voice-worker',ready:true,identity:bot.key}));void syncRoutes();});bot.client.on('error',()=>console.error('Discord gateway connection error',bot.key));}

const server=http.createServer(async(req,res)=>{
 if(req.url==='/health'&&req.method==='GET')return respond(res,200,{service:'Midnight CAD voice worker',version:workerPackage.version,presenceSync:presencePublisher.stats(),configuredBotIdentities:bots.length,readyBotIdentities:bots.filter(b=>b.client.isReady()).length,routeSyncHealthy:Date.now()-lastRouteSyncAt<90000,eventPollingHealthy:Date.now()-lastEventPollAt<45000,ready:client.isReady(),speechOutputProvider:'cad-selected-voice',speechProvider:speechConfig.provider,requestedSpeechProvider:process.env.VOICE_STT_PROVIDER||'auto',speechSelfTest,speechRecognitionReady:speechSelfTest==='passed',speechRecognitionCredentialConfigured:Boolean(speechConfig.apiKey),speechSessionRelay:speechConfig.provider==='cad-relay',speechInputMode:speechConfig.provider==='cad-relay'?'streaming':'batch',voiceInputRequested:process.env.VOICE_INPUT_ENABLED==='true',cadCommandsEnabled:Boolean(cadCommandUrl),connectedGuilds:new Set([...connections.values()].map(s=>s.guildId)).size,connectedVoiceChannels:connections.size,voiceInputConfigured:inputEnabled,enabledVoiceRoutes:[...routes.values()].filter(r=>r.voice_listen_enabled===true).length});
 if(!['/v1/dispatch','/v1/fleet'].includes(req.url)||req.method!=='POST')return respond(res,404,{error:'Not found'});
 if(!authorized(req))return respond(res,401,{error:'Unauthorized'});
 if(req.url==='/v1/fleet'){
  try{const input=await readJson(req),{guildId}=fleetInput(input);if(!client.guilds.cache.has(guildId))return respond(res,404,{error:'Main CAD bot is not installed in this server.'});
   if(input.action==='reconnect')await reconnectFleetBot({input,bots,routes,connections,inGuild,syncRoutes,voiceFor});
   const branding=input.action==='branding'?await applyFleetBranding({guildId,botKey:input.bot_key,bots}):null;
   return respond(res,200,{...fleetReport({guildId,bots,routes,connections,speechReady:speechSelfTest==='passed'}),...(branding?{branding}:{})});
  }catch(e){return respond(res,400,{error:String(e.message||'Fleet control failed').slice(0,180)});}
 }
 try{return respond(res,200,await play(await readJson(req)));}catch(e){return respond(res,400,{error:String(e.message||'Voice dispatch failed').slice(0,180)});}
});
server.listen(port,'0.0.0.0');
async function retire(){if(shuttingDown)return;shuttingDown=true;clearTimeout(presenceTimer);const timeout=setTimeout(()=>process.exit(0),1500);timeout.unref();await closeVoiceWorker({connections,bots,server});clearTimeout(timeout);process.exit(0);}
process.once('SIGTERM',()=>void retire());process.once('SIGINT',()=>void retire());
await client.login(token);
await Promise.allSettled(bots.slice(1).map(async bot=>{try{await bot.client.login(bot.token);}catch{console.error('Companion bot login failed:',bot.key);}}));
ensureSpeechReady();
void (async()=>{while(true){await delay(5_000);await deliver();}})();
setInterval(()=>void syncRoutes(),30_000).unref();


