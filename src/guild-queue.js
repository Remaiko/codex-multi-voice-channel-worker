/** One transmission per route key. Ready callouts precede waiting routine
 * traffic; the active transmission always finishes. Equal priority stays FIFO.
 * Callers own authorization and must recheck it when their task actually runs.
 */
export function createGuildQueue(){
 const routes=new Map();let sequence=0;
 return function run(routeId,task,{priority=0}={}){
  if(typeof task!=='function'||!Number.isInteger(priority)||priority<0||priority>2)return Promise.reject(Error('Invalid voice queue task.'));
  const key=String(routeId);let state=routes.get(key);
  if(!state){state={active:false,scheduled:false,waiting:[]};routes.set(key,state);}
  function pump(){
   state.scheduled=false;
   if(state.active)return;
   const next=state.waiting.shift();
   if(!next){if(routes.get(key)===state)routes.delete(key);return;}
   state.active=true;
   const finish=()=>{state.active=false;pump();};
   Promise.resolve().then(next.task).then(value=>{next.resolve(value);finish();},error=>{next.reject(error);finish();});
  }
  const current=new Promise((resolve,reject)=>{state.waiting.push({task,priority,sequence:sequence++,resolve,reject});});
  state.waiting.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);
  if(!state.active&&!state.scheduled){state.scheduled=true;queueMicrotask(pump);}
  return current;
 };
}
export function idleRoutes(routes,connections,botFor=()=> 'main'){
 const selected=new Map();
 for(const route of routes){const id=String(route.guild_id)+':'+botFor(route);if(!selected.has(id))selected.set(id,route);}
 for(const state of connections){const match=routes.find(r=>String(r.guild_id)===String(state.guildId)&&r.voice_channel_id===state.channelId&&botFor(r)===(state.botKey||'main'));if(match)selected.set(String(state.guildId)+':'+botFor(match),match);}
 return [...selected.values()];
}

