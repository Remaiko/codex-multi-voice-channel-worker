import {setTimeout as pause} from 'node:timers/promises';
import {transcribeAudio} from './speech-recognition.js';
import {randomUUID} from 'node:crypto';
import keeper from './dispatcher-lease.cjs';
import {createRealtimeInput} from './realtime-speech.js';
export function createSessionSpeech({controlUrl,workerKey,fetchImpl=fetch,wait=pause,setTimer=setTimeout,clearTimer=clearTimeout}){
 const request=async(scope,session_action,extra={},timeoutMs=45000,signal)=>{
  const r=await fetchImpl(controlUrl,{method:'POST',headers:{Authorization:'Bearer '+workerKey,'Content-Type':'application/json'},body:JSON.stringify({action:'session',session_action,guild_id:scope.guildId,channel_id:scope.channelId,user_id:scope.userId,request_id:randomUUID(),...extra}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
  if(!r.ok)throw Object.assign(Error('Authorized radio speech session unavailable ('+r.status+').'),{status:r.status});return r;
 };
 return {
  async withDesk(scope,task){const leaseId=randomUUID();let desk,ordinaryWaits=0;try{for(let attempt=0;attempt<150;attempt++){const r=await request(scope,'desk',{mode:'claim',lease_id:leaseId});desk=await r.json();if(desk.ready===true&&desk.lease_id===leaseId&&typeof desk.voice_id==='string')break;if(desk.ready!==false)throw Error('Dispatcher ownership could not be verified.');if(desk.blocked_by!=='callout'&&++ordinaryWaits>=30)break;desk=null;await wait(2000);}if(!desk||desk.ready!==true)throw Error('All dispatchers are busy. Retry the radio request shortly.');return await keeper.withLease({lease:desk,setTimer,clearTimer,renew:async signal=>{const r=await request(scope,'desk',{mode:'check',lease_id:leaseId},12000,signal);return r.json();}},control=>task({...desk,...control}));}finally{await request(scope,'desk',{mode:'release',lease_id:leaseId},5000).catch(()=>{});}},
  async scope(scope){const r=await request(scope,'scope');return r.json();},
  async interpret(text,history,scope){const r=await request(scope,'interpret',{text,history,language_version:8});return r.json();},
  openInput(scope,options={}){return createRealtimeInput({...options,tokenPromise:request(scope,'token',{realtime:true}).then(r=>r.json()).then(session=>session.token)});},
  async transcribe(audio,scope){const r=await request(scope,'token'),session=await r.json();if(typeof session.token!=='string'||session.token.length<10)throw Error('Invalid radio speech session.');return transcribeAudio({audio,config:{provider:'elevenlabs',token:session.token,model:'scribe_v2'},fetchImpl});},
  async speak(text,voiceId,scope,leaseId,signal){const r=await request(scope,'speak',{text,voice_id:voiceId,...(leaseId?{lease_id:leaseId}:{})},45000,signal),audio=Buffer.from(await r.arrayBuffer());if(audio.length<100||audio.length>4000000)throw Error('Invalid radio reply recording.');return audio;}
 };
}
