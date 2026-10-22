/** Publish only currently connected human listeners; the database verifies their eligibility. */
export function voicePresence(connections,bots){
 const members=[];
 for(const state of connections.values()){
  const bot=bots.find(b=>b.key===state.botKey),channel=bot?.client.guilds.cache.get(state.guildId)?.channels.cache.get(state.channelId);
  for(const member of channel?.members?.values()||[])if(!member.user.bot)members.push({guild_id:String(state.guildId),channel_id:String(state.channelId),discord_id:String(member.id)});
 }
 return members;
}
