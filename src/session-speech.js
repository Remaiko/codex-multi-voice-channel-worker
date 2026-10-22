import {transcribeAudio} from './speech-recognition.js';
import {randomUUID} from 'node:crypto';
import {createRealtimeInput} from './realtime-speech.js';
export function createSessionSpeech({controlUrl,workerKey,fetchImpl=fetch}){
 const request=async(scope,session_action,extra={})=>{
  const r=await fetchImpl(controlUrl,{method:'POST',headers:{Authorization:'Bearer '+workerKey,'Content-Type':'application/json'},body:JSON.stringify({action:'session',session_action,guild_id:scope.guildId,channel_id:scope.channelId,user_id:scope.userId,request_id:randomUUID(),...extra}),signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw Error('Authorized radio speech session unavailable ('+r.status+').');return r;
 };
 return {
  async interpret(text,history,scope){const r=await request(scope,'interpret',{text,history});return r.json();},
  openInput(scope,options={}){return createRealtimeInput({...options,tokenPromise:request(scope,'token',{realtime:true}).then(r=>r.json()).then(session=>session.token)});},
  async transcribe(audio,scope){const r=await request(scope,'token'),session=await r.json();if(typeof session.token!=='string'||session.token.length<10)throw Error('Invalid radio speech session.');return transcribeAudio({audio,config:{provider:'elevenlabs',token:session.token,model:'scribe_v2'},fetchImpl});},
  async speak(text,voiceId,scope){const r=await request(scope,'speak',{text,voice_id:voiceId}),audio=Buffer.from(await r.arrayBuffer());if(audio.length<100||audio.length>4000000)throw Error('Invalid radio reply recording.');return audio;}
 };
}
