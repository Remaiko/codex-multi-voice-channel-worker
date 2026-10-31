(function(root,make){const value=make();if(typeof module==='object'&&module.exports)module.exports=value;else root.MidnightDispatcherLease=value;})(globalThis,()=>{'use strict';
 // Keep exactly the claimed desk alive through synthesis, queueing and playback.
 // A failed renewal cancels the transmission; it must never claim a replacement.
 async function withLease({lease,renew,signal,setTimer=setTimeout,clearTimer=clearTimeout,intervalMs=30000,timeoutMs=10000},task){
  if(!lease||typeof lease.lease_id!=='string'||!lease.lease_id||typeof lease.voice_id!=='string'||!lease.voice_id||typeof renew!=='function'||typeof task!=='function'||!Number.isInteger(intervalMs)||intervalMs<1||!Number.isInteger(timeoutMs)||timeoutMs<1)throw Error('Invalid dispatcher reservation.');
  const controller=new AbortController();let done=false,timer,pending,renewalController;
  const reason=()=>controller.signal.reason instanceof Error?controller.signal.reason:Error('Dispatcher transmission cancelled.');
  const fail=error=>{if(!done&&!controller.signal.aborted)controller.abort(error instanceof Error?error:Error('Dispatcher reservation could not be verified.'));};
  const parentAbort=()=>fail(signal.reason||Error('Dispatcher transmission cancelled.'));
  const current=()=>{if(controller.signal.aborted)throw reason();};
  signal?.addEventListener('abort',parentAbort,{once:true});if(signal?.aborted)parentAbort();
  function check(){
   if(pending)return pending;
   try{current();}catch(error){return Promise.reject(error);}
   pending=(async()=>{
    const request=new AbortController();renewalController=request;let deadline,onAbort;
    const cancel=()=>request.abort(reason());controller.signal.addEventListener('abort',cancel,{once:true});
    try{
     const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(request.signal.reason instanceof Error?request.signal.reason:Error('Dispatcher renewal cancelled.'));request.signal.addEventListener('abort',onAbort,{once:true});});
     deadline=setTimer(()=>request.abort(Error('Dispatcher reservation renewal timed out.')),timeoutMs);deadline?.unref?.();
     const value=await Promise.race([Promise.resolve().then(()=>renew(request.signal)),cancelled]);current();
     if(value?.ready!==true||value.lease_id!==lease.lease_id||value.voice_id!==lease.voice_id)throw Error('Dispatcher reservation changed. Transmission stopped.');
     return value;
    }finally{clearTimer(deadline);controller.signal.removeEventListener('abort',cancel);request.signal.removeEventListener('abort',onAbort);if(renewalController===request)renewalController=null;}
   })().catch(error=>{fail(error);throw error;}).finally(()=>{pending=null;});
   return pending;
  }
  function schedule(){timer=setTimer(()=>{timer=null;void check().then(()=>{if(!done&&!controller.signal.aborted)schedule();},()=>{});},intervalMs);timer?.unref?.();}
  let onFailure;
  try{
   current();schedule();
   const failed=new Promise((_,reject)=>{onFailure=()=>reject(reason());controller.signal.addEventListener('abort',onFailure,{once:true});});
   const work=Promise.resolve().then(()=>{current();return task({signal:controller.signal,assertCurrent:check});});
   const value=await Promise.race([work,failed]);current();return value;
  }finally{
   done=true;clearTimer(timer);signal?.removeEventListener('abort',parentAbort);controller.signal.removeEventListener('abort',onFailure);
   renewalController?.abort(Error('Dispatcher transmission finished.'));
  }
 }
 return Object.freeze({withLease});
});
