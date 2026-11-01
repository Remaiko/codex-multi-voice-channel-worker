/** Shared-server callout barrier. A ready announcement waits for transmissions
 * already admitted, then holds routine traffic across all department routes.
 * Duress stops admitted ordinary playback and waits for its cleanup before
 * starting. An active emergency finishes before another emergency event.
 * The same event can fan out on distinct bot routes; a route never overlaps.
 * This single-worker scheduler does not grant audience access or replay speech.
 */
export function createRadioScheduler({maxPending=128,pendingTimeoutMs=45000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(!Number.isInteger(maxPending)||maxPending<1||!Number.isInteger(pendingTimeoutMs)||pendingTimeoutMs<1)throw Error('Invalid radio queue limit.');
 const servers=new Map();
 function pump(key,state){
  function start(job){
   clearTimer(job.timer);state.waiting.splice(state.waiting.indexOf(job),1);state.active.set(job.route,job);
   const finish=()=>{job.parent?.removeEventListener('abort',job.abort);state.active.delete(job.route);pump(key,state);};
   Promise.resolve().then(()=>{if(job.signal.aborted)throw job.signal.reason||Error('Radio transmission cancelled.');return job.task(job.signal);}).then(value=>{job.resolve(value);finish();},error=>{job.reject(error);finish();});
  }
  const emergency=state.waiting.find(job=>job.kind==='emergency');
  if(emergency&&state.group?.kind!=='emergency'){
   for(const job of state.active.values())if(job.kind!=='emergency'){
    const reason=Error('Emergency radio traffic. Ordinary playback was interrupted.');reason.code='RADIO_EMERGENCY_PREEMPTED';job.controller.abort(reason);
   }
   // Cancellation does not imply playback has stopped. Wait for every admitted
   // task to finish cleanup, including one that cannot immediately honor abort.
   if(state.active.size)return;
   state.group={kind:'emergency',event:emergency.event};
  }
  if(state.group!==null){
   for(const job of [...state.waiting])if(job.kind===state.group.kind&&job.event===state.group.event&&!state.active.has(job.route))start(job);
   if(state.active.size||state.waiting.some(job=>job.kind===state.group.kind&&job.event===state.group.event))return;
   state.group=null;
   if(state.waiting.some(job=>job.kind==='emergency')){pump(key,state);return;}
  }
  const announcement=state.waiting.find(job=>job.kind==='announcement');
  if(announcement){
   if(state.active.size)return;
   state.group={kind:'announcement',event:announcement.event};pump(key,state);return;
  }
  for(const job of [...state.waiting])if(!state.active.has(job.route))start(job);
  if(!state.active.size&&!state.waiting.length&&servers.get(key)===state)servers.delete(key);
 }
 return function schedule(guildId,routeId,task,{kind='routine',event=null,signal}={}){
  if(typeof task!=='function'||!['routine','announcement','emergency'].includes(kind)||typeof guildId!=='string'||!guildId||guildId.length>100||typeof routeId!=='string'||!routeId||routeId.length>200||(kind!=='routine'&&(typeof event!=='string'||!event||event.length>100)))return Promise.reject(Error('Invalid radio scheduling request.'));
  if(signal?.aborted)return Promise.reject(signal.reason||Error('Radio transmission cancelled.'));
  let state=servers.get(guildId);
  if(!state){state={active:new Map(),waiting:[],group:null};servers.set(guildId,state);}
  if(state.waiting.length>=maxPending){
   const displaced=kind==='emergency'?(state.waiting.findLast(job=>job.kind==='routine')||state.waiting.findLast(job=>job.kind==='announcement')):null;
   if(!displaced)return Promise.reject(Error('Radio traffic is busy. Retry shortly.'));
   const reason=Error('Ordinary radio request displaced by emergency traffic. Repeat when the channel is clear.');reason.code='RADIO_EMERGENCY_QUEUE_REPLACED';
   state.waiting.splice(state.waiting.indexOf(displaced),1);clearTimer(displaced.timer);displaced.parent?.removeEventListener('abort',displaced.abort);displaced.controller.abort(reason);displaced.reject(reason);
  }
  const promise=new Promise((resolve,reject)=>{
   const controller=new AbortController(),job={route:routeId,task,kind,event,resolve,reject,parent:signal,controller,signal:controller.signal};state.waiting.push(job);
   const remove=error=>{const at=state.waiting.indexOf(job);if(at<0)return;state.waiting.splice(at,1);clearTimer(job.timer);signal?.removeEventListener('abort',job.abort);reject(error);pump(guildId,state);};
   job.abort=()=>{const reason=signal.reason||Error('Radio transmission cancelled.');controller.abort(reason);remove(reason);};
   signal?.addEventListener('abort',job.abort,{once:true});
   job.timer=setTimer(()=>remove(Error('Radio traffic wait expired. Retry shortly.')),pendingTimeoutMs);
   job.timer?.unref?.();
  });
  pump(guildId,state);return promise;
 };
}
