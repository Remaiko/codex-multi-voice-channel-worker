/** One bot voice session per guild. Other guilds remain independent. */
export function createGuildQueue(){
 const tails=new Map();
 return function run(guildId,task){
  const key=String(guildId),previous=tails.get(key)||Promise.resolve();
  const current=previous.catch(()=>{}).then(task);tails.set(key,current);
  const clear=()=>{if(tails.get(key)===current)tails.delete(key);};
  current.then(clear,clear);return current;
 };
}
export function idleRoutes(routes,connections){
 const selected=new Map();
 for(const route of routes){const id=String(route.guild_id);if(!selected.has(id))selected.set(id,route);}
 for(const state of connections){const match=routes.find(r=>String(r.guild_id)===String(state.guildId)&&r.voice_channel_id===state.channelId);if(match)selected.set(String(state.guildId),match);}
 return [...selected.values()];
}

