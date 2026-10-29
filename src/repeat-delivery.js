/** Confidential radio repeats remain bound to the original audience and fresh server authority.
 * No Discord, HTTP, provider or environment access is performed by this module.
 */
const ID=/^[1-9]\d{0,21}$/;
const USER=/^\d{15,22}$/;
const TTL=15*60_000;
const key=(guild,channel)=>`${guild}:${channel}`;
function ids(value){return Array.isArray(value)&&value.length>0&&value.length<=100&&
  value.every(x=>typeof x==='string'&&USER.test(x))&&new Set(value).size===value.length;}
export function rememberTransmission(cache,delivery,result,{now=Date.now}={}){
  if(!(cache instanceof Map)||result?.played!==true||result.duplicate===true||
     !ID.test(String(delivery?.id||''))||!ID.test(String(delivery?.event_id||''))||
     !USER.test(String(delivery?.guild_id||''))||!USER.test(String(delivery?.voice_channel_id||''))||
     !ids(result.authorized_user_ids)||typeof result.speech!=='string'||
     !result.speech.trim()||result.speech.length>1500)return false;
  if(result.mode==='notice'){cache.delete(key(String(delivery.guild_id),String(delivery.voice_channel_id)));return false;}
  const time=now();if(!Number.isFinite(time))return false;
  for(const[k,v]of cache)if(!v||time-v.recorded_at>=TTL||time<v.recorded_at)cache.delete(k);
  const entry=Object.freeze({delivery_id:String(delivery.id),event_id:String(delivery.event_id),
    guild_id:String(delivery.guild_id),channel_id:String(delivery.voice_channel_id),
    agency_code:String(delivery.agency_code||'ALL'),speech:result.speech,
    authorized_user_ids:Object.freeze([...result.authorized_user_ids]),recorded_at:time});
  cache.set(key(entry.guild_id,entry.channel_id),entry);
  while(cache.size>256)cache.delete(cache.keys().next().value);
  return true;
}
function plan(entry,fresh,audience,requester,{guildId,channelId,now,isVoiceApproved}){
  if(!entry||typeof entry!=='object'||entry.guild_id!==guildId||entry.channel_id!==channelId||
     !Number.isFinite(entry.recorded_at)||now()<entry.recorded_at||now()-entry.recorded_at>=TTL||
     fresh?.active!==true||fresh.guild_id!==guildId||fresh.voice_channel_id!==channelId||
     String(fresh.delivery_id)!==entry.delivery_id||String(fresh.event_id)!==entry.event_id||
     !ids(fresh.authorized_user_ids)||!ids(entry.authorized_user_ids)||
     !Array.isArray(audience)||audience.length===0||audience.some(x=>!USER.test(String(x)))||
     typeof isVoiceApproved!=='function'||!isVoiceApproved(fresh.voice_id))return null;
  const allowed=entry.authorized_user_ids.filter(id=>fresh.authorized_user_ids.includes(id));
  if(!allowed.includes(requester)||!audience.includes(requester)||!audience.every(id=>allowed.includes(id)))return null;
  return {authorized:allowed,voice_id:fresh.voice_id};
}
export async function repeatTransmission({entry,guildId,channelId,userId,validate,audience,synthesize,play,
  isVoiceApproved,playbackId,now=Date.now}){
  const denied={played:false,reason:'no_authorized_previous_transmission'};
  // Reject malformed, expired and foreign cache entries before any backend/provider work.
  if(!entry||typeof entry!=='object'||entry.guild_id!==guildId||entry.channel_id!==channelId||
     !ids(entry.authorized_user_ids)||!entry.authorized_user_ids.includes(userId)||
     !ID.test(entry.delivery_id)||!ID.test(entry.event_id)||
     typeof entry.speech!=='string'||!entry.speech.trim()||entry.speech.length>1500||
     !Number.isFinite(entry.recorded_at)||now()-entry.recorded_at>=TTL||now()<entry.recorded_at)return denied;
  const scope={guildId,channelId,now,isVoiceApproved};
  const initial=plan(entry,await validate(entry.delivery_id),await audience(),userId,scope);
  if(!initial)return denied;
  const audio=await synthesize(entry.speech,initial.voice_id);
  // Revocation, attachment changes and newly joined listeners during TTS must win.
  const final=plan(entry,await validate(entry.delivery_id),await audience(),userId,scope);
  if(!final||final.voice_id!==initial.voice_id||!Buffer.isBuffer(audio)||!audio.length)return denied;
  const eventId=String(playbackId());if(!ID.test(eventId))throw Error('Invalid repeat playback identifier.');
  const result=await play({guildId,voiceChannelId:channelId,agencyCode:entry.agency_code,
    eventId,authorizedUserIds:final.authorized,audioFormat:'pcm',audioBase64:audio.toString('base64'),
    authorizeForPlayback:async()=>{
      const live=plan(entry,await validate(entry.delivery_id),await audience(),userId,scope);
      return live&&live.voice_id===final.voice_id?live.authorized:null;
    }});
  if(result?.played!==true&&result?.duplicate!==true)return denied;
  return {played:true,duplicate:result?.duplicate===true};
}
