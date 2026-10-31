/** Shared-server callout barrier. A ready announcement waits for transmissions
 * already admitted, then holds routine traffic across all department routes.
 * The same event can fan out on distinct bot routes; a route never overlaps.
 * This single-worker scheduler does not grant audience access or replay speech.
 */
export function createRadioScheduler({maxPending=128,pendingTimeoutMs=45000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(!Number.isInteger(maxPending)||maxPending<1||!Number.isInteger(pendingTimeoutMs)||pendingTimeoutMs<1)throw Error('Invalid radio queue limit.');
 const servers=new Map();
 function pump(key,state){
  function start(job){
   clearTimer(job.timer);state.waiting.splice(state.waiting.indexOf(job),1);state.active.set(job.route,job);
   const finish=()=>{state.active.delete(job.route);pump(key,state);};
   Promise.resolve().then(job.task).then(value=>{job.resolve(value);finish();},error=>{job.reject(error);finish();});
  }
  if(state.group!==null){
   for(const job of [...state.waiting])if(job.kind==='announcement'&&job.event===state.group&&!state.active.has(job.route))start(job);
   if(state.active.size||state.waiting.some(job=>job.kind==='announcement'&&job.event===state.group))return;
   state.group=null;
  }
  const announcement=state.waiting.find(job=>job.kind==='announcement');
  if(announcement){
   if(state.active.size)return;
   state.group=announcement.event;pump(key,state);return;
  }
  for(const job of [...state.waiting])if(!state.active.has(job.route))start(job);
  if(!state.active.size&&!state.waiting.length&&servers.get(key)===state)servers.delete(key);
 }
 return function schedule(guildId,routeId,task,{kind='routine',event=null}={}){
  if(typeof task!=='function'||!['routine','announcement'].includes(kind)||typeof guildId!=='string'||!guildId||guildId.length>100||typeof routeId!=='string'||!routeId||routeId.length>200||(kind==='announcement'&&(typeof event!=='string'||!event||event.length>100)))return Promise.reject(Error('Invalid radio scheduling request.'));
  let state=servers.get(guildId);
  if(!state){state={active:new Map(),waiting:[],group:null};servers.set(guildId,state);}
  if(state.waiting.length>=maxPending)return Promise.reject(Error('Radio traffic is busy. Retry shortly.'));
  const promise=new Promise((resolve,reject)=>{
   const job={route:routeId,task,kind,event,resolve,reject};state.waiting.push(job);
   job.timer=setTimer(()=>{const at=state.waiting.indexOf(job);if(at<0)return;state.waiting.splice(at,1);reject(Error('Radio traffic wait expired. Retry shortly.'));pump(guildId,state);},pendingTimeoutMs);
   job.timer?.unref?.();
  });
  pump(guildId,state);return promise;
 };
}
