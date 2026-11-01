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

test('duress aborts ordinary traffic in every department but leaves another server alone',async()=>{
 const run=createRadioScheduler(),seen=[],other=deferred();
 const ordinary=route=>run('g',route,signal=>new Promise((resolve,reject)=>{seen.push('start '+route);signal.addEventListener('abort',()=>{seen.push('stop '+route);reject(signal.reason);},{once:true});})).catch(e=>e.code);
 const a=ordinary('bcso'),b=ordinary('sasp'),c=run('other','a',async signal=>{await other.promise;assert.equal(signal.aborted,false);});await tick();
 const panic=run('g','federal',()=>seen.push('panic'),{kind:'emergency',event:'99'});await panic;assert.deepEqual(await Promise.all([a,b]),['RADIO_EMERGENCY_PREEMPTED','RADIO_EMERGENCY_PREEMPTED']);assert.deepEqual(seen,['start bcso','start sasp','stop bcso','stop sasp','panic']);other.resolve();await c;
});
test('duress waits for interrupted playback cleanup instead of overlapping an uncooperative source',async()=>{
 const run=createRadioScheduler(),cleanup=deferred(),seen=[];let signal;
 const active=run('g','a',async current=>{signal=current;seen.push('active');await cleanup.promise;seen.push('cleanup');});await tick();
 const panic=run('g','b',()=>seen.push('panic'),{kind:'emergency',event:'99'});await tick();assert.equal(signal.aborted,true);assert.deepEqual(seen,['active']);cleanup.resolve();await Promise.all([active,panic]);assert.deepEqual(seen,['active','cleanup','panic']);
});
test('an active emergency fans out to its other channels before the next emergency event',async()=>{
 const run=createRadioScheduler(),hold=deferred(),seen=[];
 const first=run('g','a',async signal=>{seen.push('first');await hold.promise;assert.equal(signal.aborted,false);},{kind:'emergency',event:'1'});await tick();
 const next=run('g','b',()=>seen.push('second'),{kind:'emergency',event:'2'});
 const fanout=run('g','c',()=>seen.push('first other channel'),{kind:'emergency',event:'1'});await tick();assert.deepEqual(seen,['first','first other channel']);hold.resolve();await Promise.all([first,next,fanout]);assert.deepEqual(seen,['first','first other channel','second']);
});
test('emergency supersedes a normal callout group and that group resumes before waiting routine traffic',async()=>{
 const run=createRadioScheduler(),seen=[];
 const first=run('g','a',signal=>new Promise((resolve,reject)=>{seen.push('call started');signal.addEventListener('abort',()=>{seen.push('call stopped');reject(signal.reason);},{once:true});}),{kind:'announcement',event:'1'}).catch(e=>e.code);await tick();
 const routine=run('g','c',()=>seen.push('routine'));
 const call=run('g','a',()=>seen.push('remaining call'),{kind:'announcement',event:'1'});
 const panic=run('g','b',()=>seen.push('panic'),{kind:'emergency',event:'2'});await Promise.all([first,routine,call,panic]);assert.deepEqual(seen,['call started','call stopped','panic','remaining call','routine']);
});
test('caller revocation reaches an active scheduler signal and removes its listener on cleanup',async()=>{
 const run=createRadioScheduler(),controller=new AbortController();let signal,removed=0;const remove=controller.signal.removeEventListener.bind(controller.signal);controller.signal.removeEventListener=(...args)=>{removed++;return remove(...args);};
 const active=run('g','a',current=>new Promise((resolve,reject)=>{signal=current;current.addEventListener('abort',()=>reject(current.reason),{once:true});}),{signal:controller.signal});const denied=assert.rejects(active,/permission lost/);await tick();controller.abort(Error('permission lost'));await denied;assert.equal(signal.aborted,true);assert.equal(removed,1);assert.equal(await run('g','a',()=>42),42);
});
test('a rejected emergency cannot strand the barrier or execute its waiting routine job twice',async()=>{
 const run=createRadioScheduler(),hold=deferred(),seen=[];const current=run('g','a',()=>hold.promise,{kind:'emergency',event:'1'});
 const denied=assert.rejects(run('g','b',()=>{throw Error('audience revoked');},{kind:'emergency',event:'2'}),/audience revoked/);
 const routine=run('g','c',()=>seen.push('routine'));hold.resolve();await Promise.all([current,denied,routine]);assert.deepEqual(seen,['routine']);
});

test('a full ordinary queue admits duress by displacing one waiting ordinary job',async()=>{
 const run=createRadioScheduler({maxPending:1}),seen=[];
 const active=run('g','a',signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))).catch(e=>e.code);await tick();
 const displaced=run('g','a',()=>seen.push('forbidden ordinary')).catch(e=>e.code);
 const panic=run('g','b',()=>seen.push('panic'),{kind:'emergency',event:'99'});await panic;
 assert.equal(await displaced,'RADIO_EMERGENCY_QUEUE_REPLACED');assert.equal(await active,'RADIO_EMERGENCY_PREEMPTED');assert.deepEqual(seen,['panic']);
});
test('a queue already full of emergencies stays bounded without canceling an active emergency',async()=>{
 const run=createRadioScheduler({maxPending:1}),hold=deferred(),seen=[];
 const first=run('g','a',async signal=>{await hold.promise;assert.equal(signal.aborted,false);},{kind:'emergency',event:'1'});await tick();
 const second=run('g','b',()=>seen.push('second'),{kind:'emergency',event:'2'});
 await assert.rejects(run('g','c',()=>seen.push('forbidden third'),{kind:'emergency',event:'3'}),/busy/);hold.resolve();await Promise.all([first,second]);assert.deepEqual(seen,['second']);
});
