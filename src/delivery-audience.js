/** A Discord room has one shared stream: never speak full details to a mixed audience.
 * The server, not the browser/worker, supplies the original targets and current attachments.
 * This applies only to deliveries the existing queue already authorized and selected.
 */
const snowflake=/^\d{15,22}$/;
const eventId=/^[1-9]\d{0,21}$/;
const modes=new Set(['routine_new','attached_update','manual','emergency','resource_request','supervisor_request','dispatch_request','attached_request']);
const uniqueIds=x=>Array.isArray(x)&&x.length<=100&&x.every(id=>typeof id==='string'&&snowflake.test(id))&&new Set(x).size===x.length;
export function audienceDecision(delivery,plan,present){
 if(plan?.active!==true||![1,2].includes(plan.policy_version)||!modes.has(plan.mode)||
  !eventId.test(String(delivery.id||''))||!eventId.test(String(delivery.event_id||''))||
  !snowflake.test(String(delivery.guild_id||''))||!snowflake.test(String(delivery.voice_channel_id||''))||
  typeof plan.voice_id!=='string'||!plan.voice_id.trim()||plan.voice_id.length>80||String(plan.delivery_id)!==String(delivery.id)||
  String(plan.event_id)!==String(delivery.event_id)||plan.guild_id!==String(delivery.guild_id)||
  plan.voice_channel_id!==String(delivery.voice_channel_id)||
  !uniqueIds(plan.authorized_user_ids)||!uniqueIds(plan.full_user_ids)||!uniqueIds(plan.notice_user_ids)||
  !uniqueIds(present)||!present.length||
  !plan.full_user_ids.every(id=>plan.authorized_user_ids.includes(id))||
  !plan.notice_user_ids.every(id=>plan.authorized_user_ids.includes(id)&&!plan.full_user_ids.includes(id))||
  !present.every(id=>plan.authorized_user_ids.includes(id)))return null;
 if(present.every(id=>plan.full_user_ids.includes(id)))return {mode:'full',voice_id:plan.voice_id,authorized:[...plan.full_user_ids]};
 // Mixed full/notice routine rooms hear only the generic notice. Other mixed rooms stay silent.
 if(plan.mode==='routine_new'&&plan.kind==='new'&&plan.notice_text==='New call entry.'&&
  plan.notice_voice_id==='EXAVITQu4vr4xnSDxMaL'&&
  present.every(id=>plan.full_user_ids.includes(id)||plan.notice_user_ids.includes(id)))
  return {mode:'notice',voice_id:plan.notice_voice_id,authorized:[...plan.full_user_ids,...plan.notice_user_ids]};
 return null;
}
export async function deliverAudienceBound(delivery,{plan,audience,makeSpeech,makeOpening=()=>'',say,assemble,decode,play}){
 const first=audienceDecision(delivery,await plan(delivery.id),await audience());
 if(!first)return {played:false,reason:'audience_not_authorized'};
 let speech,audio;
 if(first.mode==='notice'){
  speech='New call entry.';
  audio=await decode(await say(speech,first.voice_id,true));
 }else{
  speech=makeSpeech(delivery);const openingText=makeOpening(delivery);
  const opening=openingText?await say(openingText,first.voice_id,false):null;
  const spoken=await say(speech,first.voice_id,false);audio=await assemble(delivery,spoken,{opening});
 }
 const final=audienceDecision(delivery,await plan(delivery.id),await audience());
 if(!final||final.mode!==first.mode||final.voice_id!==first.voice_id)return {played:false,reason:'audience_changed'};
 if(!Buffer.isBuffer(audio)||!audio.length||audio.length>24*1024*1024)throw Error('Invalid prepared dispatch audio.');
 const result=await play({guildId:String(delivery.guild_id),agencyCode:delivery.agency_code,
  eventId:String(delivery.event_id),voiceChannelId:String(delivery.voice_channel_id),
  authorizedUserIds:final.authorized,audioFormat:'pcm',audioBase64:audio.toString('base64'),
  authorizeForPlayback:async()=>{
   const live=audienceDecision(delivery,await plan(delivery.id),await audience());
   return live&&live.mode===final.mode&&live.voice_id===final.voice_id?live.authorized:null;
  }});
 if(result?.played!==true&&result?.duplicate!==true)return {played:false};
 return {played:true,mode:final.mode,duplicate:result?.duplicate===true,speech,authorized_user_ids:final.authorized};
}
