import{randomUUID}from'node:crypto';
import{setTimeout as pause}from'node:timers/promises';
import keeper from'./dispatcher-lease.cjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=value=>/^[1-9]\d{0,18}$/.test(String(value||''));
export function groupCallouts(deliveries){
 const groups=new Map();for(const delivery of deliveries){const key=JSON.stringify([delivery.guild_id,String(delivery.event_id),delivery.kind==='duress']);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(delivery);}return[...groups.values()];
}
export function createCalloutReservations({control,wait=pause,newId=randomUUID,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(typeof control!=='function')throw Error('Callout control is required.');
 let closed=false;const active=new Map();
 return{async withGroup(deliveries,task){
  if(closed)throw Error('Callout coordinator is closed.');
  const first=deliveries?.[0];if(!Array.isArray(deliveries)||!deliveries.length||deliveries.length>128||typeof task!=='function'||!id(first?.id)||!id(first.event_id)||!/^\d{15,22}$/.test(String(first.guild_id))||deliveries.some(d=>!id(d.id)||String(d.event_id)!==String(first.event_id)||d.guild_id!==first.guild_id||d.kind==='duress'))throw Error('Invalid normal callout group.');
  const leaseId=newId();if(!uuid.test(leaseId))throw Error('Invalid callout reservation identity.');
  const controller=new AbortController();let finished;const completion=new Promise(resolve=>finished=resolve);active.set(controller,completion);
  const request=(mode,signal)=>control('callout_desk',{id:String(first.id),mode,lease_id:leaseId},{signal:signal?AbortSignal.any([controller.signal,signal]):controller.signal});
  const matched=desk=>desk?.ready===true&&desk.lease_id===leaseId&&typeof desk.voice_id==='string'&&desk.voice_id&&typeof desk.name==='string'&&typeof desk.playable==='boolean';
  let desk,work;
  try{
   for(let attempt=0;attempt<60;attempt++){if(controller.signal.aborted)throw controller.signal.reason;const result=await request('claim');if(matched(result)){desk=result;break;}if(result?.ready!==false||result.retry_after!==2)throw Error('Callout reservation could not be verified.');await wait(2000,undefined,{signal:controller.signal});}
   if(!desk)throw Error('Callout dispatcher is busy. Delivery will retry.');
   return await keeper.withLease({lease:desk,signal:controller.signal,setTimer,clearTimer,renew:async signal=>{const value=await request('check',signal);if(!matched(value))throw Error('Callout dispatcher changed.');return value;}},guard=>{
    let airGranted=false,startFlight;
    const waitForAir=()=>{
     if(guard.signal.aborted)return Promise.reject(guard.signal.reason||Error('Callout cancelled.'));
     if(airGranted)return guard.assertCurrent();
     if(!startFlight)startFlight=(async()=>{for(let attempt=0;attempt<60;attempt++){if(guard.signal.aborted)throw guard.signal.reason||Error('Callout cancelled.');const value=await request('start',guard.signal);if(!matched(value)||value.voice_id!==desk.voice_id)throw Error('Callout ownership changed.');if(value.playable){airGranted=true;return;}await wait(2000,undefined,{signal:guard.signal});}throw Error('Existing radio traffic did not drain before the callout deadline.');})();
     return startFlight;
    };
    work=Promise.resolve().then(()=>task({...desk,...guard,waitForAir}));return work;
   });
  }finally{controller.abort(Error('Callout transmission finished.'));if(work)await work.catch(()=>{});try{await Promise.resolve().then(()=>control('callout_desk',{id:String(first.id),mode:'release',lease_id:leaseId},{timeoutMs:5000})).catch(()=>{});}finally{active.delete(controller);finished();}}
 },async close(){closed=true;const pending=[...active.values()];for(const controller of active.keys())controller.abort(Error('Voice worker is retiring.'));await Promise.allSettled(pending);}};
}
