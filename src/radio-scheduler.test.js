import test from 'node:test';import assert from 'node:assert/strict';
import {createRadioScheduler} from './radio-scheduler.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('a ready callout waits for active speech then blocks routine traffic in every department',async()=>{
 const run=createRadioScheduler(),active=deferred(),call=deferred(),seen=[];
 const a=run('guild','federal',async()=>{seen.push('active');await active.promise;seen.push('active end');});await tick();
 const waiting=run('guild','federal',()=>seen.push('waiting reply'));
 const announcement=run('guild','bcso',async()=>{seen.push('call');await call.promise;seen.push('call end');},{kind:'announcement',event:'145'});
 const other=run('guild','sasp',()=>seen.push('other department reply'));
 await tick();assert.deepEqual(seen,['active']);active.resolve();await tick();assert.deepEqual(seen,['active','active end','call']);
 call.resolve();await Promise.all([a,waiting,announcement,other]);assert.deepEqual(seen,['active','active end','call','call end','waiting reply','other department reply']);
});
test('one callout event fans out across routes and all wait for its last channel to finish',async()=>{
 const run=createRadioScheduler(),a=deferred(),b=deferred(),seen=[];
 const x=run('guild','bcso',async()=>{seen.push('bcso');await a.promise;},{kind:'announcement',event:'145'});
 const y=run('guild','sasp',async()=>{seen.push('sasp');await b.promise;},{kind:'announcement',event:'145'});
 const reply=run('guild','federal',()=>seen.push('reply'));await tick();assert.deepEqual(seen,['bcso','sasp']);
 a.resolve();await tick();assert.deepEqual(seen,['bcso','sasp']);b.resolve();await Promise.all([x,y,reply]);assert.deepEqual(seen,['bcso','sasp','reply']);
});
test('different callout events cannot talk over each other while same-event duplicate routes serialize',async()=>{
 const run=createRadioScheduler(),hold=deferred(),seen=[];
 const a=run('g','bot',async()=>{seen.push('first');await hold.promise;},{kind:'announcement',event:'1'});
 const b=run('g','bot',()=>seen.push('same route'),{kind:'announcement',event:'1'});
 const c=run('g','other',()=>seen.push('next event'),{kind:'announcement',event:'2'});
 await tick();assert.deepEqual(seen,['first']);hold.resolve();await Promise.all([a,b,c]);assert.deepEqual(seen,['first','same route','next event']);
});
test('routine responders can use distinct routes concurrently and another server stays independent',async()=>{
 const run=createRadioScheduler(),hold=deferred(),seen=[];
 const a=run('one','a',async()=>{seen.push('one a');await hold.promise;});
 const b=run('one','b',async()=>{seen.push('one b');await hold.promise;});
 await run('two','a',()=>seen.push('two call'),{kind:'announcement',event:'1'});assert.deepEqual(seen,['one a','one b','two call']);hold.resolve();await Promise.all([a,b]);
});
test('revocation or playback failure releases the barrier without playing denied speech',async()=>{
 const run=createRadioScheduler(),hold=deferred(),seen=[];let allowed=true;
 const active=run('g','a',()=>hold.promise);await tick();
 const call=run('g','b',()=>{if(!allowed)throw Error('revoked');seen.push('forbidden');},{kind:'announcement',event:'1'});
 const denied=assert.rejects(call,/revoked/),reply=run('g','c',()=>seen.push('reply'));allowed=false;hold.resolve();await Promise.all([active,denied,reply]);assert.deepEqual(seen,['reply']);
});
test('bounded waiting traffic rejects excess work and recovers after the channel clears',async()=>{
 const run=createRadioScheduler({maxPending:1}),hold=deferred();const active=run('g','a',()=>hold.promise);
 const waiting=run('g','a',()=>1);await assert.rejects(run('g','a',()=>2),/busy/);hold.resolve();await Promise.all([active,waiting]);assert.equal(await run('g','a',()=>3),3);
});
test('malformed jobs cannot reserve or block a server',async()=>{
 const run=createRadioScheduler();for(const opts of [{kind:'fake'},{kind:'announcement'},{kind:'announcement',event:''}])await assert.rejects(run('g','a',()=>{},opts));assert.equal(await run('g','a',()=>42),42);
});
test('overdue waiting jobs expire without playback and do not keep routine traffic blocked',async()=>{
 const timers=new Map();let next=0;const run=createRadioScheduler({setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
 const hold=deferred(),seen=[];const active=run('g','a',()=>hold.promise);await tick();
 const call=run('g','b',()=>seen.push('stale call'),{kind:'announcement',event:'1'}),denied=assert.rejects(call,/wait expired/);
 const reply=run('g','c',()=>seen.push('reply'));const first=[...timers.entries()][0];timers.delete(first[0]);first[1]();await denied;await tick();
 assert.deepEqual(seen,['reply']);hold.resolve();await Promise.all([active,reply]);assert.equal(timers.size,0);
});
test('cancelled waiting speech is removed immediately and cannot hold up a ready callout',async()=>{const run=createRadioScheduler(),hold=deferred(),cancel=new AbortController(),seen=[];const active=run('g','a',()=>hold.promise);await tick();const waiting=run('g','b',()=>seen.push('stale speech'),{kind:'announcement',event:'1',signal:cancel.signal});const denied=assert.rejects(waiting,/reservation lost/);const routine=run('g','b',()=>seen.push('routine'));cancel.abort(Error('reservation lost'));await denied;await routine;assert.deepEqual(seen,['routine']);hold.resolve();await active;});
test('an aborted job is rejected before it reserves a server',async()=>{const run=createRadioScheduler(),cancel=new AbortController();cancel.abort(Error('cancelled'));await assert.rejects(run('g','a',()=>assert.fail('started'),{signal:cancel.signal}),/cancelled/);assert.equal(await run('g','a',()=>42),42);});
