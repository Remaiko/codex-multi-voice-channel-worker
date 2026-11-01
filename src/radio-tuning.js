const names={radio:'Patrol 1','radio:patrol2':'Patrol 2','radio:tac1':'Tac 1','radio:tac2':'Tac 2','radio:fire1':'Fire 1','radio:fire2':'Fire 2'};
export function parseRadioTuning(text){
 if(typeof text!=='string'||text.length>160)return null;
 const match=/^(?:dispatch|central)[\s,:;-]+(?:switch|tune|change|set) (?:(?:this|our|the) (?:voice )?channel )?to (patrol|tac|fire) (1|2|one|two)[.!]?$/i.exec(text.trim());
 if(!match)return null;const number=['1','one'].includes(match[2].toLowerCase())?'1':'2',family=match[1].toLowerCase();
 return family==='patrol'&&number==='1'?'radio':'radio:'+family+number;
}
/** Only a confirmed, currently authorized whole-channel tuning can be spoken.
 * Ambiguous personal tuning and ordinary conversation stay with the agent.
 */
export async function tuneRadioChannel({scope,text,isActive,authorize,tune,refresh,reply}){
 const net=parseRadioTuning(text);if(!net)return false;
 if(!isActive(scope))throw Error('VOICE_SCOPE_REVOKED');
 const before=await authorize(scope);if(!isActive(scope)||before?.allowed!==true||!/^[a-f0-9]{64}$/.test(before.scope_tag||''))throw Error('VOICE_SCOPE_REVOKED');
 const result=await tune(scope,net,before.scope_tag);
 if(result?.changed!==true||result.guild_id!==scope.guildId||result.channel_id!==scope.channelId||result.radio_net!==net||result.scope_tag!==before.scope_tag)throw Error('Radio channel tuning was not confirmed.');
 const after=await authorize(scope);if(!isActive(scope)||after?.allowed!==true||after.scope_tag!==before.scope_tag)throw Error('VOICE_SCOPE_REVOKED');
 await refresh(scope,net);
 await reply(scope,'This entire voice channel is now on '+names[net]+'. '+(net.endsWith('2')?'Automatic callouts remain on the primary nets.':'Automatic callouts are enabled on this primary net.'),before.scope_tag);
 return true;
}
