import http from 'node:http';
import {Readable} from 'node:stream';
import prism from 'prism-media';
import {timingSafeEqual,randomUUID as randomUuid} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Client,GatewayIntentBits,ChannelType} from 'discord.js';
import {AudioPlayerStatus,NoSubscriberBehavior,StreamType,EndBehaviorType,createAudioPlayer,createAudioResource,joinVoiceChannel,entersState,VoiceConnectionStatus} from '@discordjs/voice';
import {voicePolicy,canListen,canBroadcast,parseVoiceCommand,describeVoiceResult} from './voice-policy.js';
import {flattenVoiceRoutes,voiceRouteKey} from './voice-routes.js';
import {createGuildQueue,idleRoutes} from './guild-queue.js';
import {synthesizeElevenLabs} from './elevenlabs.js';

const token=process.env.DISCORD_BOT_TOKEN;
const workerKey=process.env.VOICE_WORKER_KEY||'';
const port=Number(process.env.PORT||8080);
const maxBody=5*1024*1024;
if(!token)throw Error('DISCORD_BOT_TOKEN is required.');
if(!/^[a-f0-9]{64}$/.test(workerKey))throw Error('VOICE_WORKER_KEY must be a private 64-character hex key.');

// Maintain one connection per configured channel, including multiple channels
// in the same guild. Routes are loaded only from the trusted CAD service.
const controlUrl=process.env.VOICE_CONTROL_URL||'https://midnight-cad-discord-test.vercel.app/api/voice';
const voiceRouteUrl=process.env.VOICE_ROUTE_URL||controlUrl;
const voiceCommandUrl=process.env.VOICE_COMMAND_URL||new URL('/api/voice-command',controlUrl).href;
const cadCommandUrl=process.env.VOICE_COMMANDS_ENABLED==='true'?voiceCommandUrl:'';
const routes=new Map();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
const connections=new Map();
const inGuild=createGuildQueue();
const recent=new Map();
const recentReplies=new Map();
const lastAnnouncements=new Map();
const receiving=new Set();
const cooldowns=new Map();
const recentSpeech=new Map();
let lastRouteSyncAt=0,lastEventPollAt=0;
const inputEnabled=process.env.VOICE_INPUT_ENABLED==='true' && Boolean(process.env.OPENAI_API_KEY);
const wakePhrase=(process.env.VOICE_WAKE_PHRASE||'dispatch').toLowerCase();

function respond(res,status,value){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
function authorized(req){const got=Buffer.from(req.headers.authorization||'');const want=Buffer.from(`Bearer ${workerKey}`);return got.length===want.length&&timingSafeEqual(got,want);}
function readJson(req){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',b=>{size+=b.length;if(size>maxBody){reject(Error('body too large'));req.destroy();return;}chunks.push(b);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('invalid JSON'));}});req.on('error',reject);});}
function routeFor(guildId,agencyCode,channelId){const route=routes.get(voiceRouteKey(guildId,channelId));if(!route||!/^\d{15,22}$/.test(route.voice_channel_id||''))throw Error('Voice dispatch is not configured for this channel.');if(route.agency_code!=='ALL'&&route.agency_code!==agencyCode)throw Error('No active voice route for this agency.');return route;}
async function voiceFor(guildId,channelId){
 const guild=client.guilds.cache.get(guildId);if(!guild)throw Error('The bot is not installed in that server.');
 const channel=await guild.channels.fetch(channelId);if(!channel||channel.type!==ChannelType.GuildVoice)throw Error('Configured destination must be a standard voice channel.');
 const me=await guild.members.fetchMe();const permissions=channel.permissionsFor(me);if(!permissions?.has(['Connect','Speak']))throw Error('The bot needs Connect and Speak in the configured voice channel.');
 const key=voiceRouteKey(guildId,channelId);
 let state=connections.get(key);
 if(!state){for(const [otherKey,other] of connections){if(other.guildId===guildId&&other.channelId!==channelId){connections.delete(otherKey);other.connection.destroy();}}const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Stop}});const connection=joinVoiceChannel({guildId,channelId,adapterCreator:guild.voiceAdapterCreator,selfDeaf:!inputEnabled,selfMute:false});connection.subscribe(player);state={connection,player,channelId,guildId,tail:Promise.resolve()};connections.set(key,state);if(inputEnabled)setupReceiver(guildId,state);connection.on('error',error=>{console.error('Discord voice connection error',key,String(error?.message||error).slice(0,160));if(connections.get(key)===state){connections.delete(key);try{connection.destroy()}catch{}}});connection.on(VoiceConnectionStatus.Disconnected,()=>{if(connections.get(key)===state){connections.delete(key);try{connection.destroy()}catch{}}});}
 await entersState(state.connection,VoiceConnectionStatus.Ready,15_000);return state;
}
function play(req){return inGuild(req.guildId,()=>playDelivery(req));}
async function playDelivery(req){
 const {guildId,agencyCode,eventId,voiceChannelId,audioBase64,authorizedUserIds}=req;
 if(!/^\d{15,22}$/.test(guildId||'')||!/^\d{15,22}$/.test(String(eventId||'')))throw Error('Invalid dispatch identifiers.');
 if(!/^[A-Z0-9_-]{1,20}$/.test(agencyCode||''))throw Error('Invalid agency code.');
 const route=routeFor(guildId,agencyCode,voiceChannelId);
 if(route.voice_channel_id!==voiceChannelId)throw Error('Voice channel route changed.');
 if(!Array.isArray(authorizedUserIds)||authorizedUserIds.length>100||authorizedUserIds.some(id=>!/^\d{15,22}$/.test(String(id))))throw Error('Authorized on-duty listener list is required.');
 if(!/^[A-Za-z0-9+/]+=*$/.test(audioBase64||''))throw Error('A prepared audio file is required.');
 const audio=Buffer.from(audioBase64,'base64');if(audio.length<64||audio.length>4*1024*1024)throw Error('Audio must be between 64 bytes and 4 MB.');
 const key=`${guildId}:${eventId}:${voiceChannelId}`;if(recent.has(key))return {played:false,duplicate:true};
 const state=await voiceFor(guildId,route.voice_channel_id);
 const voiceChannel=await client.guilds.cache.get(guildId).channels.fetch(route.voice_channel_id);
 const authorized=new Set(authorizedUserIds.map(String));
 const listeners=[...voiceChannel.members.values()].filter(member=>!member.user.bot);
 if(listeners.length===0)throw Error('No opted-in responders are present in the voice channel.');
 if(listeners.some(member=>!authorized.has(member.id)))throw Error('Voice dispatch paused: an unauthorized listener is in the channel.');
 state.tail=state.tail.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{
  const onIdle=()=>{cleanup();resolve();},onError=e=>{cleanup();reject(e);};
  let timer;const checkAudience=()=>{const members=[...voiceChannel.members.values()].filter(m=>!m.user.bot).map(m=>m.id);if(!canBroadcast({listeners:authorized},members)){cleanup();state.player.stop(true);reject(Error('Voice audience authorization changed.'));}};
  function cleanup(){clearTimeout(timer);client.off('voiceStateUpdate',onVoiceState);state.player.off(AudioPlayerStatus.Idle,onIdle);state.player.off('error',onError);}
  const onVoiceState=(oldState,newState)=>{if(newState.guild.id===guildId&&(oldState.channelId===voiceChannelId||newState.channelId===voiceChannelId))checkAudience();};
  client.on('voiceStateUpdate',onVoiceState);timer=setTimeout(()=>{cleanup();state.player.stop(true);reject(Error('Voice playback timed out.'));},90000);
  state.player.once(AudioPlayerStatus.Idle,onIdle);state.player.once('error',onError);
  state.player.play(createAudioResource(Readable.from(audio),{inputType:StreamType.Arbitrary}));
 }));
 await state.tail;recent.set(key,Date.now());for(const [k,t] of recent)if(Date.now()-t>15*60_000)recent.delete(k);
 return {played:true,guildId,agencyCode};
}

function localSpeech(text){return new Promise((resolve,reject)=>{const child=spawn('espeak-ng',['-v',process.env.VOICE_NAME||'en-us+f3','-s',process.env.VOICE_SPEED||'155','--stdout',text],{stdio:['ignore','pipe','ignore']});const chunks=[];let size=0;child.stdout.on('data',b=>{size+=b.length;if(size>2*1024*1024){child.kill();reject(Error('Synthesized voice message is too large.'));}else chunks.push(b);});child.once('error',reject);child.once('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(Error('Speech synthesis failed.')));});}
async function say(text){
 const apiKey=process.env.ELEVENLABS_API_KEY;
 if(apiKey){
  try{return await synthesizeElevenLabs({text,apiKey,voiceId:process.env.ELEVENLABS_VOICE_ID||'21m00Tcm4TlvDq8ikWAM',modelId:process.env.ELEVENLABS_MODEL_ID||'eleven_multilingual_v2'});}
  catch(e){console.error('ElevenLabs TTS failed; using local voice.',String(e.message||e).slice(0,120));}
 }
 return localSpeech(text);
}
function makeSpeech(delivery){const p=delivery.payload||{},t=delivery.templates||{},kind=['new','update','duress','amber'].includes(delivery.kind)?delivery.kind:'update';const defaults={new:'Units needed: {call_type}. Priority {priority}. {location}, postal {postal}. {details}. Call {call_id}.',update:'Units attached to {call_type} at {location}. Updated information: {details}. Status {status}.',duress:'Duress alert. {call_type}. {location}, postal {postal}. {details}. Call {call_id}.',amber:'Amber alert. {call_type}. {location}, postal {postal}. {details}. Call {call_id}.'};const values={call_id:delivery.call_id||delivery.event_id||'',call_type:p.call_type||'incident',priority:p.priority||'unassigned',location:p.location||'',postal:p.postal||'unknown',status:p.status||'',details:p.narrative||p.details||'',agency:delivery.agency_code||''};const expand=template=>String(template||'').replace(/\{([a-z_]+)\}/gi,(_,key)=>values[key.toLowerCase()]||'').replace(/\s+([.,!?])/g,'$1').replace(/(?:\s*\.\s*){2,}/g,'. ').trim();const prefix=Object.hasOwn(t,'prefix')?t.prefix:'Dispatch, attention units',eventText=Object.hasOwn(t,kind)?t[kind]:defaults[kind],suffix=Object.hasOwn(t,'suffix')?t.suffix:'';const pieces=[expand(prefix),expand(eventText),expand(suffix)].filter(Boolean);return pieces.join('. ').replace(/(?:\s*\.\s*){2,}/g,'. ').slice(0,850);}
async function control(action,extra={}){const response=await fetch(action==='routes'?voiceRouteUrl:controlUrl,{method:'POST',headers:{Authorization:`Bearer ${workerKey}`,'Content-Type':'application/json'},body:JSON.stringify({action,...extra}),signal:AbortSignal.timeout(20_000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Voice control endpoint failed.');return data;}
async function syncRoutes(){try{const response=await fetch(voiceRouteUrl,{method:'POST',headers:{Authorization:`Bearer ${workerKey}`,'Content-Type':'application/json'},body:JSON.stringify({action:'routes'}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Voice routes endpoint rejected request ('+response.status+')');const data=await response.json();if(!Array.isArray(data.routes))throw Error('Invalid routes payload');const wanted=new Map(flattenVoiceRoutes(data.routes).map(r=>[voiceRouteKey(String(r.guild_id),r.voice_channel_id),r]));for(const [key,state] of connections){if(!wanted.has(key)){state.connection.destroy();connections.delete(key);}}routes.clear();for(const [key,r] of wanted)routes.set(key,r);lastRouteSyncAt=Date.now();for(const r of idleRoutes([...routes.values()],[...connections.values()])){try{await inGuild(r.guild_id,()=>{const chosen=idleRoutes([...routes.values()],[...connections.values()]).find(x=>String(x.guild_id)===String(r.guild_id));return chosen?voiceFor(String(chosen.guild_id),chosen.voice_channel_id):undefined;});}catch(e){console.error('Voice route unavailable',voiceRouteKey(r.guild_id,r.voice_channel_id),String(e.message||e));}}}catch(e){console.error('Voice route sync failed',String(e.message||e));}}
async function deliver(){try{const {deliveries=[]}=await control('claim');lastEventPollAt=Date.now();await Promise.all(deliveries.map(async d=>{try{const speech=makeSpeech(d),audio=await say(speech);await play({guildId:d.guild_id,agencyCode:d.agency_code,eventId:d.event_id,voiceChannelId:d.voice_channel_id,authorizedUserIds:d.authorized_user_ids,audioBase64:audio.toString('base64')});lastAnnouncements.set(voiceRouteKey(String(d.guild_id),String(d.voice_channel_id)),speech);await control('ack',{id:d.id,ok:true});}catch(e){await control('ack',{id:d.id,ok:false,error:String(e.message||'voice_failed').slice(0,80),retry_seconds:60}).catch(()=>{});console.error('Voice dispatch failed',String(d.id),String(e.message||e));}}));}catch(e){console.error('Voice event poll failed',String(e.message||e));}}


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
async function transcribe(pcm){
 const body=new FormData();body.set('model',process.env.VOICE_STT_MODEL||'gpt-4o-mini-transcribe');
 body.set('file',new Blob([wavFromPcm(pcm)],{type:'audio/wav'}),'radio.wav');
 const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{
  method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},body,
  signal:AbortSignal.timeout(25000)
 });
 if(!r.ok)throw Error('Speech recognition unavailable ('+r.status+')');
 const data=await r.json();return String(data.text||'').slice(0,500).trim();
}
async function replyInGuild(guildId,channelId,userId,message){
 const state=connections.get(voiceRouteKey(guildId,channelId));
 if(!state)return;
 const r=routeFor(guildId,routes.get(voiceRouteKey(guildId,state.channelId))?.agency_code||'ALL',state.channelId);
 if(!canListen(voicePolicy(routes.get(voiceRouteKey(guildId,state.channelId)),guildId),userId))return;
 const permitted=Array.isArray(r.authorized_listener_ids)?r.authorized_listener_ids.map(String):[];
 if(!permitted.includes(String(userId)))return;
 const audio=await say(String(message).replace(/[\x00-\x1F]/g,' ').slice(0,450));
 await play({guildId,agencyCode:r.agency_code,eventId:String(BigInt(Date.now())*1000000n+BigInt(Math.floor(Math.random()*1000000))),voiceChannelId:r.voice_channel_id,authorizedUserIds:permitted,audioBase64:audio.toString('base64')});
}
async function handleVoiceCommand(guildId,channelId,userId,text){
 const route=routes.get(voiceRouteKey(guildId,channelId)),policy=voicePolicy(route,guildId);
 if(!canListen(policy,userId))return;
 const now=Date.now(),key=voiceRouteKey(guildId,channelId)+':'+userId;
 if((cooldowns.get(key)||0)>now)return;
 cooldowns.set(key,now+2500);
 const cmd=parseVoiceCommand(text,wakePhrase);
 if(!cmd)return;
 if(cmd.action==='radio_check')return replyInGuild(guildId,channelId,userId,'Dispatch copies. Radio check acknowledged.');
 if(cmd.action==='repeat')return replyInGuild(guildId,channelId,userId,lastAnnouncements.get(voiceRouteKey(guildId,channelId))||'No previous dispatch message is available to repeat.');
 // The response is authorized by the CAD server using the Guild/Discord user link.
 // Do not pass through or trust caller-supplied user roles or account identifiers.
 if(!cadCommandUrl)return replyInGuild(guildId,channelId,userId,'Dispatch copies. CAD voice lookup is not configured.');
 if(!['status','calls','units','call'].includes(cmd.action))return replyInGuild(guildId,channelId,userId,'Dispatch received. That voice command is not yet enabled in CAD.');
 try{
  const target=new URL(cadCommandUrl);
  if(target.protocol!=='https:'||target.origin!==new URL(controlUrl).origin)throw Error('Voice command endpoint must match trusted CAD origin');
  const response=await fetch(target,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+workerKey},body:JSON.stringify({guild_id:guildId,user_id:userId,action:'command',source:'discord-voice',command:cmd.action==='units'?'available units':cmd.action==='calls'?'active calls':cmd.action==='call'?'call '+cmd.id:'my status',request_id:cryptoRandomId()}),signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(String(data.error||'CAD radio lookup unavailable').slice(0,120));
  const speech=typeof data.reply==='string'?data.reply:describeVoiceResult(cmd,data.data);
  return replyInGuild(guildId,channelId,userId,speech);
 }catch(e){console.warn('CAD voice command error:',String(e.message||e).slice(0,90));return replyInGuild(guildId,channelId,userId,'Dispatch copies. CAD lookup is unavailable. Try again later.');}
}
function cryptoRandomId(){return randomUuid()}
function setupReceiver(guildId,state){
 const receiver=state.connection.receiver;
 if(!receiver)return;
 receiver.speaking.on('start',async(userId)=>{
  const routeKey=voiceRouteKey(guildId,state.channelId);
  const key=routeKey+':'+userId;
  if(receiving.has(key)||!canListen(voicePolicy(routes.get(routeKey),guildId),userId))return;
  const channel=await client.guilds.cache.get(guildId)?.channels.fetch(state.channelId).catch(()=>null);
  const member=channel?.members?.get(userId);
  if(!member||member.user.bot||!canListen(voicePolicy(routes.get(routeKey),guildId),userId))return;
  receiving.add(key);
  try{
   const opus=receiver.subscribe(userId,{end:{behavior:EndBehaviorType.AfterSilence,duration:950}});
   const decoder=new prism.opus.Decoder({frameSize:960,channels:2,rate:48000});
   const pcm=[],cap=48000*2*2*12;let size=0;
   opus.pipe(decoder);
   for await(const part of decoder){
    size+=part.length;if(size>cap){opus.destroy();break;}pcm.push(part);
   }
   if(connections.get(routeKey)!==state||size<48000*2*2*0.4||size>cap||!canListen(voicePolicy(routes.get(routeKey),guildId),userId))return;
   const transcript=await transcribe(Buffer.concat(pcm));
   if(transcript)await handleVoiceCommand(guildId,state.channelId,userId,transcript);
  }catch(e){console.warn('Speech input could not be handled:',String(e.message||e).slice(0,140))}
  finally{receiving.delete(key)}
 });
}

client.once('ready',()=>{console.log(JSON.stringify({service:'midnight-cad-voice-worker',ready:true,bot:client.user.username}));void syncRoutes();});
client.on('error',()=>console.error('Discord gateway connection error'));
const server=http.createServer(async(req,res)=>{
 if(req.url==='/health'&&req.method==='GET')return respond(res,200,{service:'Midnight CAD voice worker',version:'0.4.0',routeSyncHealthy:Date.now()-lastRouteSyncAt<90000,eventPollingHealthy:Date.now()-lastEventPollAt<45000,ready:client.isReady(),speechRecognitionCredentialConfigured:Boolean(process.env.OPENAI_API_KEY),voiceInputRequested:process.env.VOICE_INPUT_ENABLED==='true',cadCommandsEnabled:Boolean(cadCommandUrl),connectedGuilds:new Set([...connections.values()].map(s=>s.guildId)).size,connectedVoiceChannels:connections.size,voiceInputConfigured:inputEnabled,enabledVoiceRoutes:[...routes.values()].filter(r=>r.voice_listen_enabled===true).length});
 if(req.url!=='/v1/dispatch'||req.method!=='POST')return respond(res,404,{error:'Not found'});
 if(!authorized(req))return respond(res,401,{error:'Unauthorized'});
 try{return respond(res,200,await play(await readJson(req)));}catch(e){return respond(res,400,{error:String(e.message||'Voice dispatch failed').slice(0,180)});}
});
server.listen(port,'0.0.0.0');
await client.login(token);
void (async()=>{while(true){await delay(5_000);await deliver();}})();
setInterval(()=>void syncRoutes(),30_000).unref();


