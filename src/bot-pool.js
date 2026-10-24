/** Optional department/channel bot identities share one trusted CAD control plane. */
export function botCredentials(mainToken,raw){
 const result=[{key:'main',token:mainToken}];if(!raw)return result;
 let entries;try{entries=JSON.parse(raw);}catch{throw Error('VOICE_COMPANION_BOT_TOKENS must be a JSON object.');}
 if(!entries||Array.isArray(entries)||typeof entries!=='object'||Object.keys(entries).length>20)throw Error('Configure at most 20 named companion bots.');
 const seen=new Set([mainToken]);for(const [key,token]of Object.entries(entries)){
  if(!/^(?:[A-Z][A-Z0-9_-]{0,19}|[0-9]{15,22})$/.test(key)||typeof token!=='string'||token.length<20||token.length>512||seen.has(token))throw Error('Invalid or duplicated companion bot configuration.');
  seen.add(token);result.push({key,token});
 }return result;
}
const law=new Set(['ATF','BCSO','CBPO','DOC','HSI','ICE','LSPD','SASP','SGW','STATE','USBP','USMS','IAA','FBI','DEA','USSS','NCIS','DHS']);
const federal=new Set(['ATF','CBPO','HSI','ICE','USBP','USMS','IAA','FBI','DEA','USSS','NCIS','DHS']);
export function companionConfiguration(env){
 let entries={};if(env.VOICE_COMPANION_BOT_TOKENS){try{entries=JSON.parse(env.VOICE_COMPANION_BOT_TOKENS);}catch{throw Error('Invalid companion bot JSON configuration.');}if(!entries||Array.isArray(entries)||typeof entries!=='object')throw Error('Companion bot configuration must be an object.');}
 for(const [name,value]of Object.entries(env)){if(name.startsWith('VOICE_BOT_TOKEN_')&&value){const key=name.slice('VOICE_BOT_TOKEN_'.length);if(entries[key]&&entries[key]!==value)throw Error('Conflicting companion bot credential sources.');entries[key]=value;}}
 return JSON.stringify(entries);
}
export function selectVoiceBot(bots,route){
 const key=String(route?.voice_channel_id||''),department=String(route?.agency_code||'ALL');
 return bots.find(b=>b.key===key)||bots.find(b=>b.key===department)||
  (['FIRE','EMS','FEMA','WILDFIRE'].includes(department)?bots.find(b=>b.key==='FIRE_EMS'):null)||
  (federal.has(department)?bots.find(b=>b.key==='FEDERAL'):null)||
  (law.has(department)?bots.find(b=>b.key==='LE'):null)||bots.find(b=>b.key==='main');
}

