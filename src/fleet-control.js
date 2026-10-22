import {selectVoiceBot} from './bot-pool.js';
import {audienceStatus} from './voice-audience.js';
const id=/^\d{15,22}$/;
export const companions=['FIRE_EMS','BCSO','SASP','LSPD','FEDERAL'];
const labels={main:'Main CAD bot',FIRE_EMS:'Fire & EMS',BCSO:'BCSO',SASP:'SASP',LSPD:'LSPD',FEDERAL:'Federal'};
export function fleetInput(input){
 if(!input||!id.test(String(input.guild_id||'')))throw Error('Choose a valid server.');
 if(!['status','reconnect'].includes(input.action))throw Error('Unsupported fleet action.');
 if(input.action==='reconnect'&&!['main',...companions].includes(input.bot_key))throw Error('Choose a dispatch bot.');
 return {guildId:String(input.guild_id),action:input.action,botKey:input.bot_key};
}
export function fleetReport({guildId,bots,routes,connections,speechReady=false}){
 const list=[...routes.values()].filter(r=>String(r.guild_id)===guildId);
 return {speech_ready:speechReady,bots:['main',...companions].map(key=>{
  const bot=bots.find(b=>b.key===key),guild=bot?.client.guilds.cache.get(guildId);
  return {key,name:labels[key],application_id:bot?.client.user?.id||null,configured:!!bot,ready:!!bot?.client.isReady(),installed:!!guild,
   routes:list.filter(r=>selectVoiceBot(bots,r)?.key===key).map(r=>({channel_id:String(r.voice_channel_id),department:r.agency_code})),
   connections:[...connections.values()].filter(c=>c.guildId===guildId&&c.botKey===key).map(c=>({channel_id:c.channelId,status:c.connection.state.status,...audienceStatus(list.find(r=>String(r.voice_channel_id)===c.channelId),guild?.channels?.cache.get(c.channelId)?.members)}))};
 })};
}
export async function reconnectFleetBot({input,bots,routes,connections,inGuild,syncRoutes,voiceFor}){
 const {guildId,botKey}=fleetInput(input),bot=bots.find(b=>b.key===botKey);
 if(!bot?.client.isReady()||!bot.client.guilds.cache.has(guildId))throw Error('This department bot is not ready in this server.');
 await syncRoutes();
 const assigned=[...routes.values()].filter(r=>String(r.guild_id)===guildId&&selectVoiceBot(bots,r)?.key===botKey);
 if(!assigned.length)throw Error('Save an active voice channel for this bot first.');
 // The guild-and-identity queue prevents a reconnect from cutting off a delivery.
 return inGuild(guildId+':'+botKey,async()=>{
  const target=assigned.find(r=>[...connections.values()].some(c=>c.guildId===guildId&&c.botKey===botKey&&c.channelId===r.voice_channel_id))||assigned[0];
  if(selectVoiceBot(bots,routes.get(guildId+':'+target.voice_channel_id))?.key!==botKey)throw Error('The route changed. Refresh and retry.');
  for(const [key,c]of connections)if(c.guildId===guildId&&c.botKey===botKey){connections.delete(key);c.connection.destroy();}
  await voiceFor(guildId,target.voice_channel_id);
  return {reconnected:true,bot_key:botKey};
 });
}
