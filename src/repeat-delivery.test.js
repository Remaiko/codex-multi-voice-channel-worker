import test from 'node:test';import assert from 'node:assert/strict';
import {rememberTransmission,repeatTransmission} from './repeat-delivery.js';
import {deliverValidated} from './delivery-validation.js';
const guild='100000000000000001',channel='200000000000000001',alice='300000000000000001',bob='300000000000000002';
const voice='DODLEQrClDo8wCz460ld';
const delivery={id:'71',event_id:'45',guild_id:guild,voice_channel_id:channel,agency_code:'BCSO'};
function fixture(){let time=1000000;const cache=new Map();
 const first={played:true,speech:'Private fictional incident details.',authorized_user_ids:[alice]};
 assert.equal(rememberTransmission(cache,delivery,first,{now:()=>time}),true);
 const entry=cache.get(`${guild}:${channel}`),calls={validate:0,synthesize:0,play:[]};
 const fresh={active:true,delivery_id:'71',event_id:'45',guild_id:guild,voice_channel_id:channel,authorized_user_ids:[alice],voice_id:voice};
 const options={entry,guildId:guild,channelId:channel,userId:alice,now:()=>time,
  validate:async()=>{calls.validate++;return structuredClone(fresh);},audience:async()=>[alice],
  synthesize:async()=>{calls.synthesize++;return Buffer.from('fictional pcm');},
  play:async args=>{calls.play.push(args);return {played:true};},
  isVoiceApproved:v=>v===voice,playbackId:()=>123456};
 return {options,fresh,calls,cache,first,time:v=>time=v};}
test('repeat revalidates twice and preserves original allowed recipients',async()=>{const f=fixture();const r=await repeatTransmission(f.options);assert.equal(r.played,true);assert.equal(f.calls.validate,2);assert.deepEqual(f.calls.play[0].authorizedUserIds,[alice]);});
test('a newly authorized caller cannot replay someone else\'s cached transmission',async()=>{const f=fixture();f.options.userId=bob;f.fresh.authorized_user_ids.push(bob);f.options.audience=async()=>[alice,bob];assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.validate,0);assert.equal(f.calls.synthesize,0);});
test('joining bystander prevents replay even when currently eligible for generic radio',async()=>{const f=fixture();f.options.audience=async()=>[alice,bob];f.fresh.authorized_user_ids.push(bob);assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.synthesize,0);});
test('revocation during speech preparation prevents playback',async()=>{const f=fixture();f.options.synthesize=async()=>{f.fresh.active=false;return Buffer.from('pcm');};assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.play.length,0);});
test('a listener joining during speech preparation prevents playback',async()=>{const f=fixture();let joined=false;f.options.synthesize=async()=>{joined=true;return Buffer.from('pcm');};f.options.audience=async()=>joined?[alice,bob]:[alice];assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.play.length,0);});
test('foreign community, channel, event and delivery references fail closed',async()=>{for(const patch of[{guild_id:'900000000000000001'},{voice_channel_id:'900000000000000002'},{event_id:'99'},{delivery_id:'99'}]){const f=fixture();Object.assign(f.fresh,patch);assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.synthesize,0);}});
test('empty channel, missing requester and malformed audience do not synthesize',async()=>{for(const values of[[],[bob],['bad']]){const f=fixture();f.options.audience=async()=>values;assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.synthesize,0);}});
test('original recipients also need current server permission',async()=>{const f=fixture();f.fresh.authorized_user_ids=[bob];assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.synthesize,0);});
test('unapproved voice never silently falls back to another voice',async()=>{const f=fixture();f.fresh.voice_id='unexpected';assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.synthesize,0);});
test('voice setting changing during TTS refuses the stale recording',async()=>{const f=fixture();f.options.isVoiceApproved=()=>true;f.options.synthesize=async()=>{f.fresh.voice_id='new-approved';return Buffer.from('pcm');};assert.equal((await repeatTransmission(f.options)).played,false);});
test('expired cache and backwards clock are rejected before provider use',async()=>{for(const time of[1900000,999999]){const f=fixture();f.time(time);assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.validate,0);}});
test('failed, duplicate and unbound deliveries never replace the remembered transmission',()=>{const f=fixture();for(const result of[{...f.first,played:false},{...f.first,duplicate:true},{...f.first,authorized_user_ids:[]}])assert.equal(rememberTransmission(f.cache,delivery,result),false);assert.equal(f.cache.size,1);});
test('cache captures recipients immutably and bounds its size',()=>{const f=fixture();f.first.authorized_user_ids.push(bob);assert.deepEqual(f.options.entry.authorized_user_ids,[alice]);for(let n=0;n<300;n++)rememberTransmission(f.cache,{...delivery,voice_channel_id:String(200000000000000001n+BigInt(n))},{...f.first,authorized_user_ids:[alice]},{now:()=>1000000});assert.equal(f.cache.size,256);});
test('legacy unscoped text cache is never treated as an authorized transmission',async()=>{const f=fixture();f.options.entry='old private text';assert.equal((await repeatTransmission(f.options)).played,false);assert.equal(f.calls.validate,0);});
test('provider and authorization failures cannot trigger playback',async()=>{for(const target of['validate','synthesize']){const f=fixture();f.options[target]=async()=>{throw Error('fixture failure');};await assert.rejects(repeatTransmission(f.options),/fixture failure/);assert.equal(f.calls.play.length,0);}});
test('failed underlying playback is not acknowledged as delivered',async()=>{const r=await deliverValidated(delivery,{validate:async()=>({active:true,authorized_user_ids:[alice]}),makeSpeech:()=> 'fixture',say:async()=>Buffer.from('voice'),assemble:async()=>Buffer.from('pcm'),play:async()=>({played:false})});assert.equal(r.played,false);});
test('delivered transmission exposes only the fresh audience for replay binding',async()=>{let reads=0;const r=await deliverValidated(delivery,{validate:async()=>({active:true,authorized_user_ids:++reads===1?[alice,bob]:[alice]}),makeSpeech:()=> 'fixture',say:async()=>Buffer.from('voice'),assemble:async()=>Buffer.from('pcm'),play:async()=>({played:true})});assert.deepEqual(r.authorized_user_ids,[alice]);});

test('a newly played generic notice clears the older private repeat without caching notice text',()=>{const f=fixture();assert.equal(rememberTransmission(f.cache,delivery,{...f.first,mode:'notice',speech:'New call entry.'}),false);assert.equal(f.cache.size,0);});
test('unconfirmed playback receipts cannot acknowledge a repeated transmission',async()=>{for(const value of[null,{}, {played:'true'},{duplicate:'true'}]){const f=fixture();f.options.play=async()=>value;assert.equal((await repeatTransmission(f.options)).played,false);}});

test('replay permission is checked again after entering the serialized playback slot',async()=>{const f=fixture();f.options.play=async args=>{f.fresh.active=false;return {played:(await args.authorizeForPlayback())!==null};};assert.equal((await repeatTransmission(f.options)).played,false);});
