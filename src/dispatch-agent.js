import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import languageModule from './radio-language.cjs';
const {clean,createLanguage,emergencySignal,emergencyAction,validatePlan,canonicalCommand,WRITES}=languageModule;
const book=JSON.parse(readFileSync(new URL('./radio_codes.json',import.meta.url),'utf8'));
const language=createLanguage(book);
const snowflake=/^\d{15,22}$/;
const yes=/^(?:yes(?: please|,? go ahead)?|yeah(?:,? go ahead)?|yep|confirm(?:ed)?|affirm(?:ative)?|that's correct|that is correct|correct|do it|go ahead|proceed|10-4|ten four)[.!]?$/i;
const no=/^(?:no(?:,? cancel(?: it)?)?|negative|cancel(?: it| that| the request)?|never mind|nevermind|forget (?:it|that)|disregard(?: that| (?:my )?last request)?|10-22|ten twenty two)[.!]?$/i;
const retry=/^(?:retry|retry it|try (?:it |that )?again|retry (?:the |my )?(?:last |previous )?request|recover (?:the |my )?(?:last |previous )?(?:request|receipt))[.!]?$/i;
const keyOf=s=>[s.guildId,s.channelId,s.userId].join(':');
function addressed(text,wake='dispatch'){
 const escaped=String(wake).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const m=new RegExp('^(?:hey |okay |ok )?(?:(?:unit )?[a-z]{1,5}[ -]?\\d{1,4}(?: to)?[, ]+)?(?:dispatch|central|'+escaped+')[\\s,:;.!-]+','i').exec(text);
 return m?text.slice(m[0].length).trim():null;
}
function describe(s){return ({set_status:'set your unit '+(s.status||'').replaceAll('_',' '),attach:'attach your unit to call '+s.id,detach:'detach only your unit from call '+s.id,close_call:'close call '+s.id+' for all attached units',call:'read call '+(s.id||'details'),caller_card:'read caller information for call '+s.id,caller_thread:'read caller messages for call '+s.id,call_resources:'read requested resources for call '+s.id,response_plan:'read the response plan for call '+s.id,run_name:'check the name '+s.query,run_plate:'check plate '+s.query,run_dl:'check driver license '+s.query,run_vin:'check VIN '+s.query,run_person_record:'check the criminal record for '+s.query,set_location:'update your saved location to '+s.query,trace:'start the fictional caller trace for call '+s.id,trace_advance:'advance your caller trace for call '+s.id,location:'read your last saved unit location',status:'read your status',calls:'read active calls',units:'read available units',duress:'activate your duress',officer_down:'activate officer-down emergency traffic and request EMS/backup',clear_duress:'clear your active duress',patrol_activity:'record your patrol activity: '+s.query,go_off_duty:'take your unit off duty',request_backup:'request backup on call '+s.id+(s.query?' '+s.query:''),request_supervisor:'request a supervisor on call '+s.id,request_emergency_traffic:'request emergency radio traffic on call '+s.id,request_secondary_channel:'request a secondary radio channel for call '+s.id,request_fire:'request fire on call '+s.id,request_ems:'request EMS on call '+s.id,request_tow:'request tow on call '+s.id,request_coroner:'request a coroner on call '+s.id,request_traffic_control:'request traffic control on call '+s.id,request_scene_security:'request scene security on call '+s.id,request_transport:'request transport on call '+s.id,request_investigate:'request an investigator on call '+s.id,add_note:'add a CAD note to call '+s.id,caller_contact:'send the caller a message on call '+s.id,dispatch_best:'assign the best eligible unit to call '+s.id,auto_services:'run automatic service selection for call '+s.id,set_response_plan:'set the response plan for call '+s.id+' to '+s.query,assign_unit:'assign unit '+s.query+' to call '+s.id,detach_unit:'detach unit '+s.query+' from call '+s.id,update_service:'set '+s.query+' on call '+s.id,cancel_resource:'clear the '+s.query+' resource request on call '+s.id,dispatch_update:'add updated information to call '+s.id,caller_update:'add caller-advised information to call '+s.id,broadcast_call:'broadcast call '+s.id+' using '+s.query,create_call:'create a new CAD call from the supplied type, priority, postal, area, location and narrative',unit_update:'broadcast your unit update on call '+s.id})[s.action];}
/** Bounded, account-scoped conversation and fixed-plan execution. No provider credentials
 * or raw database access. All tool effects go through the existing authorized CAD gateway. */
export function createDispatchAgent({scope:readScope,interpret,execute,reply,repeat,isActive=()=>true,now=Date.now,id=randomUUID,wake='dispatch',maxSessions=200,confirmationMs=60000,historyMs=90000}={}){
 for(const f of [readScope,interpret,execute,reply,repeat])if(typeof f!=='function')throw Error('Dispatch integration dependency missing');
 const sessions=new Map(),inflight=new Map();
 function get(key){const s=sessions.get(key);if(s&&(s.pending||now()-s.at<=historyMs))return s;if(sessions.has(key))sessions.delete(key);return null;}
 function remember(key,s){
  if(s.ephemeral)return;
  if(!sessions.has(key)&&sessions.size>=maxSessions){const evict=[...sessions].find(([,v])=>!v.pending);if(!evict)throw Error('RECOVERY_CAPACITY_REACHED');sessions.delete(evict[0]);}
  s.at=now();sessions.set(key,s);
 }
 function clear(scope){sessions.delete(keyOf(scope));const run=inflight.get(keyOf(scope));if(run)run.cancelled=true;}
 async function fresh(scope,tag=null){
  if(!isActive(scope))throw Error('LOCAL_SCOPE_REVOKED');let value;
  try{value=await readScope(scope);}catch(error){throw Error(error?.status===401||error?.status===403?'VOICE_SCOPE_REVOKED':'AUTHORIZATION_UNAVAILABLE');}
  if(!isActive(scope)||value?.allowed===false)throw Error('VOICE_SCOPE_REVOKED');
  if(value?.allowed!==true||!/^[a-f0-9]{64}$/.test(value.scope_tag||''))throw Error('AUTHORIZATION_UNAVAILABLE');
  if(tag&&value.scope_tag!==tag)throw Error('VOICE_IDENTITY_CHANGED');return value.scope_tag;
 }
 async function say(scope,text,tag){await fresh(scope,tag);return reply(scope,clean(text).slice(0,650),tag);}
 async function perform(scope,state,run){
  const key=keyOf(scope),pending=state.pending;
  if(!pending||pending.expires<now()&&!pending.uncertain){state.pending=null;return await say(scope,'That action review expired. Please repeat your request.',state.tag);}
  // A resumed execution owns late completions; an interrupted older run cannot append
  // the same receipt twice or overwrite recovery state after the retry has confirmed it.
  pending.executor=run;
  // Freeze every step/request identifier before the first write. Never re-plan a retry.
  for(let i=pending.next;i<pending.steps.length;i++){
   if(run.cancelled){return {cancelled:true,completed:pending.results.length};}
   await fresh(scope,state.tag);
   if(run.cancelled)return {cancelled:true,completed:pending.results.length};
   const current=pending.steps[i];
   try{
    const command=canonicalCommand(current);
    pending.sentIndex=i;
    const result=await execute(scope,command,pending.requestIds[i],state.tag);
    if(pending.executor!==run)return {cancelled:true,completed:pending.results.length};
    if(!result||result.recognized!==true||result.scope_tag!==state.tag||result.request_id!==pending.requestIds[i]||result.command!==command||!['confirmed','clarification'].includes(result.outcome)||typeof result.reply!=='string'||!result.reply.trim()||result.reply.length>1000)throw Error('UNCONFIRMED_CAD_RESULT');
    // A server clarification is not a success receipt; do not run dependent steps.
    if(result.outcome==='clarification'||/\b(?:which call|no active assigned call|multiple active assignments|not found in your server|clear the emergency through CAD)\b/i.test(result.reply)){
     state.pending=null;remember(key,state);await say(scope,result.reply,state.tag);return {clarification:true,completed:pending.results.length};
    }
    pending.results.push(clean(result.reply));pending.next=i+1;pending.uncertain=false;
    if(current.action==='go_off_duty') {
     // A confirmed off-duty write intentionally revokes the very voice scope that authorized it.
     // Treat the matching server receipt as the terminal success and do not require or speak through
     // a scope that must now be invalid. Going off duty is validated as a standalone action.
     const results=pending.results.slice();state.pending=null;state.paused=null;state.awaiting=false;
     state.history=[...state.history,{role:'user',content:pending.text,scope_tag:state.tag},{role:'assistant',content:results.join(' ').slice(0,700),scope_tag:state.tag}].slice(-4);
     remember(key,state);return {completed:results.length,scopeEnded:true};
    }
    if(run.cancelled)return {cancelled:true,completed:pending.results.length};
    await fresh(scope,state.tag);
   }catch(error){
    if(pending.executor!==run)return {cancelled:true,completed:pending.results.length};
    if(run.cancelled){pending.uncertain=error.definitive!==true;pending.suspended=true;return {cancelled:true,completed:pending.results.length};}
    if(/SCOPE|IDENTITY|REVOKED/.test(String(error.message))){clear(scope);return {denied:true};}
    if(error.definitive===true){state.pending=null;remember(key,state);await say(scope,(pending.results.length?pending.results.length+' earlier action(s) were confirmed. ':'')+'CAD rejected the next action. Later actions were not sent. Review CAD before changing the request.',state.tag);return {rejected:true,completed:pending.results.length};}
    pending.uncertain=true;remember(key,state);
    if(state.ephemeral){await say(scope,'Your emergency result is unconfirmed. Check your CAD emergency indicator; repeating an own-unit distress request uses the existing active emergency when present.',state.tag);return {uncertain:true,recovery_retained:false};}
    await say(scope,(pending.results.length?pending.results.length+' earlier action(s) were confirmed. ':'')+'The next result is unconfirmed. Say Dispatch, retry last request to recover the same request. Later actions have not been sent.',state.tag);
    return {uncertain:true,completed:pending.results.length};
   }
  }
  const results=pending.results.slice();state.pending=state.paused||null;state.paused=null;if(state.pending)state.pending.suspended=true;
  state.history=[...state.history,{role:'user',content:pending.text,scope_tag:state.tag},{role:'assistant',content:results.join(' ').slice(0,700),scope_tag:state.tag}].slice(-4);state.awaiting=false;remember(key,state);
  // Report actual backend replies, not model promises. Separate short replies keep all results audible.
  for(const result of results){if(run.cancelled)break;await say(scope,result,state.tag);}
  return {completed:results.length};
 }
 async function handle(scope,input){
  if(!scope||!['guildId','channelId','userId'].every(k=>snowflake.test(String(scope[k]||''))))return {ignored:true};
  if(typeof input!=='string'||!input.trim()||input.length>700||!isActive(scope))return {ignored:true};
  const text=clean(input),key=keyOf(scope),prior=get(key),body=addressed(text,wake),emergency=emergencyAction(body??text),urgent=!!emergency;
  const bareFollowup=prior?.awaiting&&now()-prior.at<=30000;
  if(!urgent&&body===null&&!(prior?.pending&&(yes.test(text)||no.test(text)||retry.test(text)))&&!bareFollowup)return {ignored:true};
  // Emergencies are never dropped by the ordinary cooldown or wait for an LLM.
  const active=inflight.get(key);if(active&&!urgent)return {busy:true};if(active&&urgent)active.cancelled=true;
  const run={cancelled:false};inflight.set(key,run);
  try{
   const tag=await fresh(scope);let state=prior?.tag===tag?prior:{tag,at:now(),history:[],pending:null,awaiting:false};
   if(prior&&prior.tag!==tag)sessions.delete(key);
   const request=body??text;
   if(!urgent&&!sessions.has(key)&&sessions.size>=maxSessions&&![...sessions.values()].some(v=>!v.pending))return {busy:true,reason:'recovery_capacity'};
   if(urgent){
    // Backend own-unit duress is idempotent/already-active aware. Do not let an interrupted
    // ordinary plan execute more steps after the emergency. Its uncertain receipt is retained.
    if(['duress','officer_down'].includes(state.pending?.steps?.[0]?.action))return await perform(scope,state,run);
    const displaced=state.pending;if(displaced){displaced.suspended=true;if(displaced.sentIndex>=displaced.next)displaced.uncertain=true;}const requestId=id();
    const emergencyState={...state,paused:displaced,ephemeral:!sessions.has(key)&&sessions.size>=maxSessions&&![...sessions.values()].some(v=>!v.pending),pending:{steps:[{action:emergency||'duress',status:null,id:null,query:null}],requestIds:[requestId+'-0'],text,next:0,results:[],expires:now()+confirmationMs,uncertain:false}};
    const result=await perform(scope,emergencyState,run);
    return result;
   }
   if(state.pending){
    if(no.test(request)){
     if(state.pending.uncertain)return await say(scope,'That request may already have reached CAD. I cannot undo or discard an unconfirmed result. Say retry last request to recover its receipt.',tag);
     state.pending=null;state.awaiting=false;remember(key,state);return await say(scope,'Unsent actions cancelled. Earlier confirmed actions have not been undone.',tag);
    }
    if(state.pending.suspended){
     if(!retry.test(request))return await say(scope,'The earlier request was paused for your emergency. Review CAD, then say retry last request to recover that same request.',tag);
     state.pending.suspended=false;
    }
    if(state.pending.uncertain&&!retry.test(request))return await say(scope,'The earlier result is still unconfirmed. Say retry last request before starting another action.',tag);
    if((state.pending.uncertain&&retry.test(request))||(!state.pending.uncertain&&yes.test(request)))return await perform(scope,state,run);
    return await say(scope,'A request is waiting for review. Say confirm or cancel.',tag);
   }
   if(retry.test(request))return await say(scope,'There is no recoverable request in this worker session. Check CAD history before submitting a new action; I will not recreate an unknown request.',tag);
   if(yes.test(request))return await say(scope,'There is no pending review for this session. Please state the action you want.',tag);
   const local=language.local(request,{});
   if(local?.action==='repeat')return await repeat(scope);
   let outcome;
   // Reference-only and fully specified simple commands need no model or full context fetch.
   if(local&&local.action!=='clarify'&&(local.action!=='plan'||local.steps.every(s=>!['attach','detach','call','caller_card','caller_thread','call_resources','response_plan','close_call','trace','trace_advance','request_backup','request_supervisor','request_emergency_traffic','request_secondary_channel','request_fire','request_ems','request_tow','request_coroner','request_traffic_control','request_scene_security','request_transport','request_investigate','add_note','caller_contact','dispatch_best','auto_services','set_response_plan','assign_unit','detach_unit','update_service','cancel_resource','dispatch_update','caller_update','broadcast_call','unit_update'].includes(s.action))))outcome=local;
   else{
    outcome=await interpret(request,state.history,scope);
    if(outcome?.scope_tag!==tag)throw Error('VOICE_IDENTITY_CHANGED');
   }
   if(run.cancelled)return {cancelled:true};await fresh(scope,tag);
   outcome=validatePlan(outcome);
   if(outcome.action!=='plan'){
    state.awaiting=outcome.action==='clarify';state.history=[...state.history,{role:'user',content:text,scope_tag:tag},{role:'assistant',content:outcome.reply,scope_tag:tag}].slice(-4);remember(key,state);
    return await say(scope,outcome.reply||'No CAD action was requested.',tag);
   }
   const requestId=id();
   state.pending={steps:outcome.steps,requestIds:outcome.steps.map((_,i)=>requestId+'-'+i),text,next:0,results:[],expires:now()+confirmationMs,uncertain:false};state.awaiting=false;remember(key,state);
   if(outcome.confirmation){return await say(scope,'Please confirm: '+outcome.steps.map(describe).join('; ')+'. Say confirm or cancel.',tag);}
   return await perform(scope,state,run);
  }catch(error){
   const denied=/SCOPE|IDENTITY|REVOKED/.test(String(error.message));if(denied)clear(scope);
   // Transient authorization/provider failures cannot erase a potentially committed request.
   return {denied,unavailable:!denied,recovery_retained:!!sessions.get(key)?.pending,reason:denied?'authorization_changed':'interpretation_unavailable'};
  }finally{if(inflight.get(key)===run)inflight.delete(key);}
 }
 return {handle,clear,clearAll(){for(const run of inflight.values())run.cancelled=true;sessions.clear();},stats(){return {sessions:sessions.size,inflight:inflight.size};}};
}
export {addressed};
