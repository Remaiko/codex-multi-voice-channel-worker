import test from 'node:test';import assert from 'node:assert/strict';import {createGuildQueue,idleRoutes} from './guild-queue.js';
test('same guild waits until the previous channel transmission finishes',async()=>{const run=createGuildQueue(),seen=[];let release;const wait=new Promise(r=>release=r);const a=run('one',async()=>{seen.push('a-start');await wait;seen.push('a-end');});const b=run('one',async()=>seen.push('b'));await Promise.resolve();await Promise.resolve();assert.deepEqual(seen,['a-start']);release();await Promise.all([a,b]);assert.deepEqual(seen,['a-start','a-end','b']);});
test('a different server can transmit while another server is busy',async()=>{const run=createGuildQueue();let release;const a=run('one',()=>new Promise(r=>release=r));let other=false;await run('two',()=>{other=true;});assert.equal(other,true);release();await a;});
test('a failed transmission does not poison the next channel request',async()=>{const run=createGuildQueue();await assert.rejects(run('one',()=>{throw Error('network');}));assert.equal(await run('one',()=>42),42);});
test('route refresh keeps the current channel instead of cycling every channel',()=>{const routes=[{guild_id:'one',voice_channel_id:'a'},{guild_id:'one',voice_channel_id:'b'},{guild_id:'two',voice_channel_id:'c'}];assert.deepEqual(idleRoutes(routes,[{guildId:'one',channelId:'b'}]).map(r=>r.voice_channel_id),['b','c']);});

test('a new callout overtakes waiting replies without cutting off the active transmission',async()=>{
 const run=createGuildQueue(),seen=[];let release,started;
 const began=new Promise(r=>started=r),hold=new Promise(r=>release=r);
 const active=run('server:bot',async()=>{seen.push('active start');started();await hold;seen.push('active end');});await began;
 const reply1=run('server:bot',()=>seen.push('reply 1'));
 const reply2=run('server:bot',()=>seen.push('reply 2'));
 const callout=run('server:bot',()=>seen.push('new call'),{priority:1});
 assert.deepEqual(seen,['active start']);release();await Promise.all([active,reply1,reply2,callout]);
 assert.deepEqual(seen,['active start','active end','new call','reply 1','reply 2']);
});
test('equal-priority callouts stay ordered and independent routes do not block each other',async()=>{
 const run=createGuildQueue(),seen=[];let release,started;const began=new Promise(r=>started=r);
 const active=run('one',()=>new Promise(r=>{release=r;started();}));await began;
 const a=run('one',()=>seen.push('call A'),{priority:1}),b=run('one',()=>seen.push('call B'),{priority:1}),c=run('one',()=>seen.push('routine'));
 await run('two',()=>seen.push('independent'));
 assert.deepEqual(seen,['independent']);release();await Promise.all([active,a,b,c]);
 assert.deepEqual(seen,['independent','call A','call B','routine']);
});
test('queued traffic rechecks revoked authority and failure still releases the channel',async()=>{
 const run=createGuildQueue(),seen=[];let release,started,allowed=true;const began=new Promise(r=>started=r);
 const active=run('one',()=>new Promise(r=>{release=r;started();}));await began;
 const callout=run('one',()=>{if(!allowed)throw Error('audience revoked');seen.push('unauthorized audio');},{priority:1});
 const denied=assert.rejects(callout,/audience revoked/);
 const reply=run('one',()=>seen.push('authorized reply'));allowed=false;release();await Promise.all([active,denied,reply]);
 assert.deepEqual(seen,['authorized reply']);assert.equal(await run('one',()=>42),42);
});
test('invalid priority never enters the playback queue',async()=>{
 const run=createGuildQueue();let played=false;
 for(const priority of [-1,3,Infinity,NaN,'1'])await assert.rejects(run('one',()=>{played=true;},{priority}));
 assert.equal(played,false);assert.equal(await run('one',()=>7),7);
});

