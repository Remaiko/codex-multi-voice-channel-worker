import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {brandingPresets,createFleetBranding,validateArtwork} from './fleet-branding.js';
const guildId='910947550650060800';
function fixture(key='BCSO'){
 let edits=0,loads=0;const user={id:brandingPresets[key].id,avatar:'old',banner:'old',async edit(data){edits++;assert.deepEqual(Object.keys(data).sort(),['avatar','banner']);assert.ok(Buffer.isBuffer(data.avatar));this.avatar='new-avatar';this.banner='new-banner';return this;}};
 const bots=[{key,token:'private-token',client:{user,isReady:()=>true,guilds:{cache:new Map([[guildId,{}]])}}}];
 const apply=createFleetBranding({load:async()=>{loads++;await new Promise(resolve=>setTimeout(resolve,5));return Buffer.from('fixture');}});
 return {apply,bots,user,get edits(){return edits;},get loads(){return loads;},input:{guildId,botKey:key,bots}};
}
test('only reviewed five identities can receive profiles, including guild/readiness checks',async()=>{
 const f=fixture();await assert.rejects(f.apply({...f.input,botKey:'main'}),/five department/);await assert.rejects(f.apply({...f.input,guildId:'999999999999999999'}),/not ready/);
 f.user.id='1562561216541499492';await assert.rejects(f.apply(f.input),/identity/);assert.equal(f.edits,0);assert.equal(f.loads,0);
});
test('concurrent requests across servers share one update and matching revision is reused',async()=>{
 const f=fixture();f.bots[0].client.guilds.cache.set('999999999999999999',{});
 const [a,b]=await Promise.all([f.apply(f.input),f.apply({...f.input,guildId:'999999999999999999'})]);assert.deepEqual(a,b);assert.equal(f.edits,1);assert.equal(f.loads,2);
 assert.equal((await f.apply(f.input)).reused,true);assert.equal(f.edits,1);assert.doesNotMatch(JSON.stringify(a),/private-token|fixture/);
 f.user.avatar='externally-changed';await f.apply(f.input);assert.equal(f.edits,2);
});
test('failed provider updates do not poison retry and cannot expose credentials',async()=>{
 const f=fixture();const edit=f.user.edit;f.user.edit=async()=>{throw Error('private-token');};await assert.rejects(f.apply(f.input),error=>!error.message.includes('private-token'));
 f.user.edit=edit;assert.equal((await f.apply(f.input)).applied,true);
});
test('artwork rejects truncated, substituted and non-WebP bytes before Discord update',()=>{
 const good=Buffer.from('RIFF0000WEBPfixture');const hash=createHash('sha1').update(Buffer.from('blob '+good.length+'\0')).update(good).digest('hex');
 assert.equal(validateArtwork(good,[hash,good.length]),good);
 assert.throws(()=>validateArtwork(good,[hash,good.length+1]),/invalid/);assert.throws(()=>validateArtwork(Buffer.from('xxxx0000WEBPfixture'),[hash,good.length]),/invalid/);assert.throws(()=>validateArtwork(good,['0'.repeat(40),good.length]),/changed/);
});
test('artwork download cannot redirect or exceed its pinned byte count',async()=>{
 const f=fixture(),observed=[];
 const apply=createFleetBranding({fetcher:async(url,options)=>{observed.push({url,options});return new Response(new Uint8Array(32775),{headers:{'content-length':'32775'}});}});
 await assert.rejects(apply(f.input),/could not be loaded|invalid/);assert.equal(f.edits,0);assert.ok(observed.every(r=>r.url.startsWith('https://midnight-cad-discord-test.vercel.app/')&&r.options.redirect==='error'&&r.options.signal));
});
