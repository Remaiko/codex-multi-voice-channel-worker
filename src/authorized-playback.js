import {canBroadcast} from './voice-policy.js';
/** Recheck the live audience for the entire transmission and remove all listeners. */
export function playToAudience({player,gateway,channel,resource,guildId,channelId,authorized,idleEvent='idle',timeoutMs=90000,signal}){
 return new Promise((resolve,reject)=>{
  let timer,done=false;
  const cleanup=()=>{clearTimeout(timer);gateway.off('voiceStateUpdate',onState);player.off(idleEvent,onIdle);player.off('error',onError);signal?.removeEventListener('abort',onAbort);};
  const finish=(error)=>{if(done)return;done=true;cleanup();if(error){try{player.stop(true);}catch{}reject(error);}else resolve();};
  const onIdle=()=>finish(),onError=error=>finish(error),onAbort=()=>finish(signal.reason instanceof Error?signal.reason:Error('Dispatcher playback cancelled.'));
  const check=()=>{const ids=[...channel.members.values()].filter(m=>!m.user.bot).map(m=>m.id);if(!canBroadcast({listeners:authorized},ids)){finish(Error('Voice audience authorization changed.'));return false;}return true;};
  const onState=(before,after)=>{if(after.guild?.id===guildId&&(before.channelId===channelId||after.channelId===channelId))check();};
  gateway.on('voiceStateUpdate',onState);player.once(idleEvent,onIdle);player.once('error',onError);
  timer=setTimeout(()=>finish(Error('Voice playback timed out.')),timeoutMs);
  signal?.addEventListener('abort',onAbort,{once:true});
  try{if(signal?.aborted)onAbort();else if(check())player.play(resource);}catch(error){finish(error);}
 });
}

