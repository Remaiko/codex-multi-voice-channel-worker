import {createHash} from 'node:crypto';

// Reviewed public artwork only. Neither URLs nor application IDs come from callers.
export const brandingRevision='department-artwork-2026-10-23';
export const brandingPresets=Object.freeze({
 FIRE_EMS:{id:'1562560263033716847',image:'fire-ems',avatar:['c2158ed665754d2256187010daad6b590e3d5fe8',28426],banner:['b9dd08e4188c53538d20003ce46dcfe946624797',102596]},
 BCSO:{id:'1562560881160888513',image:'bcso',avatar:['009edf499946711d4f6b8be999833ecbe7869a81',32774],banner:['f25ea04d837af7d81ea12268ad013ef2cea2f6ea',97024]},
 SASP:{id:'1562561216541499492',image:'sasp',avatar:['5797cc88e5590e44651b47f28ce654232dc8bb5c',29594],banner:['35a7afb7e2b11586090f1db2888dd9dd473545d8',95126]},
 LSPD:{id:'1562562413893656616',image:'lspd',avatar:['3d0613d1fd16ef168d64b7799ee12781f48cccb8',29800],banner:['89e3676e713dbde7484f342912a7e146731a0bff',97620]},
 FEDERAL:{id:'1562562500501971015',image:'federal',avatar:['0177e8718f887647a45814c4d108798fb94d69d5',33982],banner:['54cb0e76a04f2fa5780488c3a3217d09b141cc10',90702]}
});
export function validateArtwork(bytes,[hash,size]){
 if(bytes.length!==size||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw Error('Saved bot artwork is invalid.');
 const digest=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 if(digest!==hash)throw Error('Saved bot artwork changed. Refresh after its release is verified.');
 return bytes;
}
async function loadArtwork(preset,type,fetcher){
 const [hash,size]=preset[type],path=type==='avatar'?'avatars':'banners';
 const response=await fetcher('https://midnight-cad-discord-test.vercel.app/'+path+'/'+preset.image+'.webp',{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body||Number(response.headers.get('content-length')||0)>size)throw Error('Saved bot artwork could not be loaded.');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>size)throw Error('Saved bot artwork is too large.');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 return validateArtwork(Buffer.concat(chunks),[hash,size]);
}
export function createFleetBranding({fetcher=fetch,load=loadArtwork}={}){
 const pending=new Map(),applied=new Map();
 return async function applyBranding({guildId,botKey,bots}){
  const preset=brandingPresets[botKey],bot=bots.find(b=>b.key===botKey);
  if(!preset)throw Error('Choose one of the five department bots.');
  if(!bot?.client.isReady()||!bot.client.guilds.cache.has(guildId))throw Error('This department bot is not ready in this server.');
  if(bot.client.user?.id!==preset.id)throw Error('Bot identity does not match its saved department artwork.');
  const user=bot.client.user,key=preset.id+':'+brandingRevision;
  const receipt=applied.get(key);
  if(receipt&&receipt.avatar===user.avatar&&receipt.banner===user.banner)return {...receipt,reused:true};
  if(pending.has(key))return pending.get(key);
  const work=(async()=>{
   const [avatar,banner]=await Promise.all(['avatar','banner'].map(type=>load(preset,type,fetcher)));
   // One profile update avoids a half-applied avatar/banner pair. Voice sessions are untouched.
   let updated;try{updated=await user.edit({avatar,banner});}catch(error){throw Object.assign(Error(error?.status===429?'Discord is rate limiting profile updates. Try again shortly.':'Discord could not apply the department profile. Try again shortly.'),{status:error?.status===429?429:503});}
   const result={bot_key:botKey,revision:brandingRevision,avatar:updated.avatar,banner:updated.banner,applied:true};
   applied.set(key,result);return result;
  })();
  pending.set(key,work);try{return await work;}finally{pending.delete(key);}
 };
}
