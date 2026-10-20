/** Pure, deterministic voice permissions and wake-word parsing helpers. */
export function discordId(value){return /^\d{15,22}$/.test(String(value||''));}
export function allowedSpeakers(route, inputEnabled){
 if(!inputEnabled || route?.voice_listen_enabled!==true || !Array.isArray(route.authorized_user_ids))return new Set();
 return new Set(route.authorized_user_ids.filter(discordId).map(String));
}
export function allowedListeners(route){
 return new Set(Array.isArray(route?.authorized_listener_ids)?route.authorized_listener_ids.filter(discordId).map(String):[]);
}
export function voiceCommand(transcript,wake='dispatch'){
 const text=String(transcript||'').toLowerCase().replace(/\s+/g,' ').trim();
 const phrase=String(wake||'dispatch').toLowerCase().trim();
 if(!phrase||(!text.startsWith(phrase+',')&&!text.startsWith(phrase+' ')))return null;
 const command=text.slice(phrase.length).replace(/^[,\s]+/,'');
 if(!command)return null;
 if(/^(radio check|check in|are you there|respond|hello)\b/.test(command))return {kind:'radio-check'};
 if(/^(repeat|say again|repeat last call|repeat transmission)\b/.test(command))return {kind:'repeat'};
 return {kind:'broker',transcript:String(transcript||'')};
}
