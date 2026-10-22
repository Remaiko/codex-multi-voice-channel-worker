export async function deliverValidated(delivery,{validate,makeSpeech,say,assemble,play,checkAudience=async()=>{},makeOpening=()=>''}){
 const before=await validate(delivery.id);if(before?.active!==true)return {played:false};
 await checkAudience(delivery,before);
 const openingText=makeOpening(delivery),opening=openingText?await say(openingText,delivery.voice_id):null;
 const speech=makeSpeech(delivery),spoken=await say(speech,delivery.voice_id),audio=await assemble(delivery,spoken,{opening});
 const fresh=await validate(delivery.id);if(fresh?.active!==true)return {played:false};
 await play({guildId:delivery.guild_id,agencyCode:delivery.agency_code,eventId:delivery.event_id,voiceChannelId:delivery.voice_channel_id,authorizedUserIds:fresh.authorized_user_ids,audioFormat:'pcm',audioBase64:audio.toString('base64')});
 return {played:true,speech};
}