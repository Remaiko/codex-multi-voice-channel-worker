import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {tuneRadioChannel} from '../src/radio-tuning.js';
import {createDispatchAgent} from '../src/dispatch-agent.js';
import L from '../src/radio-language.cjs';
const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const G='111111111111111111',CH='222222222222222222',U='333333333333333333',OTHER='444444444444444444',TAG='a'.repeat(64);
function fixture(intent=L.clarify('Which postal are you at?')){
 const replies=[],interpretations=[],writes=[],tunes=[],key=G+':'+CH;
 const members=new Map([[U,{}],[OTHER,{}]]);
 const guild={channels:{cache:new Map([[CH,{members}]])}};
 const state={gateway:{guilds:{cache:new Map([[G,guild]])}}};
 const c={createDispatchAgent,tuneRadioChannel,routes:new Map(),connections:new Map([[key,state]]),voiceRouteKey:(g,ch)=>g+':'+ch,voicePolicy:()=>({}),canListen:()=>true,wakePhrase:'dispatch',
  sessionSpeech:{scope:async()=>({allowed:true,scope_tag:TAG}),interpret:async(text,history,scope)=>{interpretations.push({text,history:[...history],scope});return{...intent,scope_tag:TAG};}},
  replyInGuild:async(g,ch,user,text,tag)=>replies.push({g,ch,user,text,tag}),repeatLastDispatch:async()=>{},
  control:async(action,body)=>{tunes.push({action,...body});return{changed:true,guild_id:body.guild_id,channel_id:body.channel_id,radio_net:body.net,scope_tag:body.scope_tag};},syncRoutes:async()=>{},radioNets:{net:()=>tunes.at(-1)?.net},
  cadCommandUrl:'https://cad.invalid/api/voice-command',controlUrl:'https://cad.invalid/api/voice',workerKey:'fixture-key',
  fetch:async(url,options)=>{const body=JSON.parse(options.body);writes.push({url:String(url),headers:options.headers,...body});return{ok:true,json:async()=>({recognized:true,command:body.command,request_id:body.request_id,scope_tag:body.scope_tag,outcome:'confirmed',reply:'Server-confirmed status.'})};},URL,AbortSignal};
 vm.createContext(c);
 const start=source.indexOf('const dispatchAgent=createDispatchAgent('),end=source.indexOf('function setupReceiver',start);
 assert.ok(start>=0&&end>start,'current production integration must be present');
 vm.runInContext(source.slice(start,end),c);
 return{c,replies,interpretations,writes,tunes,run:(text,user=U)=>c.handleVoiceCommand(G,CH,user,text)};
}
test('ordinary language after the wake word receives a clarification without a CAD write',async()=>{
 const f=fixture();await f.run('Central, I need someone to check this situation');
 assert.equal(f.interpretations.length,1);assert.equal(f.writes.length,0);assert.match(f.replies[0].text,/Which postal/);assert.equal(f.replies[0].tag,TAG);
});
test('two responders have separate conversation histories',async()=>{
 const f=fixture();await f.run('Central, first report');await f.run('Central, second report',OTHER);
 assert.equal(f.interpretations[1].history.length,0);assert.equal(f.interpretations[1].scope.userId,OTHER);
});
test('unknown model actions cannot call CAD endpoints or announce success',async()=>{
 const f=fixture({action:'grant_admin'});const result=await f.run('Central, make me an administrator');
 assert.equal(f.writes.length,0);assert.equal(f.replies.some(r=>r.text.includes('Server-confirmed')),false);assert.ok(result?.unavailable||f.replies.length===1);
});
test('natural status update carries current actor scope and matching receipt through the authorized endpoint',async()=>{
 const f=fixture();const result=await f.run('Central, mark me en route');
 assert.equal(result.completed,1);assert.equal(f.writes.length,1);const write=f.writes[0];
 assert.equal(write.command,'set status en_route');assert.equal(write.user_id,U);assert.equal(write.guild_id,G);assert.equal(write.channel_id,CH);
 assert.equal(write.scope_tag,TAG);assert.equal(write.headers.authorization,'Bearer fixture-key');assert.match(write.request_id,/^[a-f0-9-]+-0$/);
 assert.equal(f.replies[0].text,'Server-confirmed status.');
});
test('unauthorized speakers never reach the interpreter or CAD',async()=>{
 const f=fixture();f.c.canListen=()=>false;await f.run('Central hello');
 assert.equal(f.interpretations.length,0);assert.equal(f.writes.length,0);assert.equal(f.replies.length,0);
});
test('a command endpoint outside the trusted control origin is refused',async()=>{
 const f=fixture();f.c.cadCommandUrl='https://other.invalid/api/voice-command';const result=await f.run('Central, mark me busy');
 assert.equal(f.writes.length,0);assert.equal(result.rejected,true);assert.match(f.replies[0].text,/rejected/);
});

test('production voice handler tunes the actual speaker channel without a model or CAD incident write',async()=>{const f=fixture();await f.run('Central, switch this channel to Tac 2');assert.equal(f.interpretations.length,0);assert.equal(f.writes.length,0);assert.deepEqual(f.tunes,[{action:'radio_net',guild_id:G,channel_id:CH,user_id:U,net:'radio:tac2',scope_tag:TAG}]);assert.match(f.replies[0].text,/entire voice channel.*Tac 2/);});
