const nets=new Set(['radio','radio:patrol2','radio:tac1','radio:tac2','radio:fire1','radio:fire2']);
export function routeNet(route){
 if(!route)return null;
 if(route.radio_net!==undefined)return nets.has(route.radio_net)?route.radio_net:null;
 return ['FIRE_EMS','FIRE','EMS','FEMA','WILDFIRE'].includes(route.agency_code)?'radio:fire1':'radio';
}
export const primaryNet=net=>['radio','radio:tac1','radio:fire1'].includes(net);
export const netChanged=()=>Object.assign(Error('Radio net changed; automatic callout discarded.'),{code:'RADIO_NET_CHANGED'});
/** A shared Discord voice connection has one audible net for the entire room.
 * Retuning invalidates both waiting and playing automatic callouts. It never
 * cancels interactive replies, changes audience authority or replays old audio.
 */
export function createRadioNetGuard(){
 let routes=new Map();const active=new Set(),key=(guild,channel)=>guild+':'+channel;
 const current=(guild,channel)=>routeNet(routes.get(key(guild,channel)));
 return {
  update(next){routes=new Map(next);for(const item of active)if(current(item.guild,item.channel)!==item.net)item.controller.abort(netChanged());},
  net:current,
  async run(guild,channel,net,task,{signal}={}){
   if(!primaryNet(net)||current(guild,channel)!==net)throw netChanged();
   const controller=new AbortController(),item={guild,channel,net,controller};active.add(item);
   const abort=()=>controller.abort(signal.reason||Error('Callout cancelled.'));
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   const assertCurrent=()=>{if(controller.signal.aborted)throw controller.signal.reason;if(current(guild,channel)!==net)throw netChanged();};
   try{assertCurrent();const value=await task({signal:controller.signal,assertCurrent});assertCurrent();return value;}
   finally{active.delete(item);signal?.removeEventListener('abort',abort);}
  }
 };
}
