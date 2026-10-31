'use strict';
/* Shared server/worker language contract. The supplied CAD codebook, not a generic
 * police-code list, owns meanings. Recognition never writes to CAD. */
const STATUS = Object.freeze(['available','busy','en_route','on_scene','transporting','unavailable']);
const TOOLS = Object.freeze(['status','calls','units','location','call','caller_card','caller_thread','call_resources','response_plan','set_status','attach','detach','duress','officer_down','clear_duress','trace','trace_advance','close_call','run_name','run_plate','run_dl','run_vin','run_person_record','set_location','request_backup','request_supervisor','request_fire','request_ems','request_tow','request_coroner','request_traffic_control','request_scene_security','request_transport','request_investigate','request_emergency_traffic','request_secondary_channel','add_note','caller_contact','dispatch_best','auto_services','set_response_plan','assign_unit','detach_unit','update_service','cancel_resource','dispatch_update','caller_update','broadcast_call','create_call','unit_update','go_off_duty','patrol_activity']);
const WRITES = new Set(['set_status','attach','detach','duress','officer_down','clear_duress','trace','trace_advance','close_call','set_location','request_backup','request_supervisor','request_fire','request_ems','request_tow','request_coroner','request_traffic_control','request_scene_security','request_transport','request_investigate','request_emergency_traffic','request_secondary_channel','add_note','caller_contact','dispatch_best','auto_services','set_response_plan','assign_unit','detach_unit','update_service','cancel_resource','dispatch_update','caller_update','broadcast_call','create_call','unit_update','go_off_duty','patrol_activity']);
const RESOURCE_TOOLS = new Set(['request_backup','request_supervisor','request_fire','request_ems','request_tow','request_coroner','request_traffic_control','request_scene_security','request_transport','request_investigate','request_emergency_traffic','request_secondary_channel']);
const CALL_TOOLS = new Set(['call','caller_card','caller_thread','call_resources','response_plan','attach','detach','trace','trace_advance','close_call','add_note','caller_contact','dispatch_best','auto_services','set_response_plan','assign_unit','detach_unit','update_service','cancel_resource','dispatch_update','caller_update','broadcast_call','unit_update',...RESOURCE_TOOLS]);
const REQUIRED_CALL_TOOLS = new Set(['caller_card','caller_thread','call_resources','response_plan','attach','detach','add_note','caller_contact','dispatch_best','auto_services','set_response_plan','assign_unit','detach_unit','update_service','cancel_resource','dispatch_update','caller_update','broadcast_call','unit_update',...RESOURCE_TOOLS]);
const QUERY_TOOLS = new Set(['run_name','run_plate','run_dl','run_vin','run_person_record','set_location','add_note','caller_contact','set_response_plan','assign_unit','detach_unit','update_service','cancel_resource','dispatch_update','caller_update','broadcast_call','create_call','unit_update','patrol_activity']);
const SMALL = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = {twenty:20,thirty:30,forty:40,fourty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const DIGITS = Object.fromEntries(SMALL.slice(0,10).map((s,i)=>[s,String(i)]));Object.assign(DIGITS,{oh:'0',o:'0',niner:'9'});
const PHONETIC = Object.fromEntries('alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(' ').map((s,i)=>[s,String.fromCharCode(65+i)]));
Object.assign(PHONETIC,{alfa:'A',juliet:'J',whisky:'W','x-ray':'X',adam:'A',boy:'B',charles:'C',david:'D',edward:'E',frank:'F',george:'G',henry:'H',ida:'I',john:'J',king:'K',lincoln:'L',mary:'M',nora:'N',ocean:'O',paul:'P',queen:'Q',robert:'R',sam:'S',tom:'T',union:'U',william:'W',young:'Y',zebra:'Z'});
const clean = v => String(v??'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[\u2018\u2019]/g,"'").replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\s+/g,' ').trim();
const fail = message => { throw Error(message); };
function wordsNumber(value,{digits=false,max=999999999999999999n}={}){
 const s=clean(value).toLowerCase().replace(/-/g,' '),tokens=s.split(/\s+/).filter(Boolean);
 if(!tokens.length)return null;
 if(/^\d+$/.test(s))return BigInt(s)<=max?s:null;
 if(tokens.every(t=>Object.hasOwn(DIGITS,t)||/^\d$/.test(t))){const n=tokens.map(t=>DIGITS[t]??t).join('');return BigInt(n)<=max?n:null;}
 if(digits)return null;
 function under100(xs){
  if(xs.length===1&&SMALL.includes(xs[0]))return SMALL.indexOf(xs[0]);
  if(xs.length>=1&&xs.length<=2&&Object.hasOwn(TENS,xs[0])&&(xs.length===1||SMALL.slice(1,10).includes(xs[1])))return TENS[xs[0]]+(xs[1]?SMALL.indexOf(xs[1]):0);
  return null;
 }
 function under1000(xs){
  const n=under100(xs);if(n!==null)return n;
  if(!SMALL.slice(1,10).includes(xs[0])||xs[1]!=='hundred')return null;
  const tail=xs.slice(xs[2]==='and'?3:2);if(!tail.length)return SMALL.indexOf(xs[0])*100;
  const v=under100(tail);return v!==null&&v>0?SMALL.indexOf(xs[0])*100+v:null;
 }
 const k=tokens.indexOf('thousand');let n;
 if(k<0)n=under1000(tokens);
 else{const major=under1000(tokens.slice(0,k)),tail=tokens.slice(k+1).filter((t,i)=>!(i===0&&t==='and')),minor=tail.length?under1000(tail):0;n=major!==null&&major>0&&minor!==null?major*1000+minor:null;}
 return n!==null&&BigInt(n)<=max?String(n):null;
}
const NUMBER_WORD = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|niner|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred)';
function normalizeCodes(value){
 let s=clean(value).toLowerCase();
 // Longest bounded phrase first, never consume arbitrary words or a second code.
 s=s.replace(new RegExp('\\b(?:ten|10)[\\s.,-]+('+NUMBER_WORD+'(?:[ -]+'+NUMBER_WORD+'){0,2}|\\d{1,2})\\b','g'),(all,number)=>{const n=wordsNumber(number,{max:99n});return n!==null?'10-'+Number(n):all;});
 s=s.replace(/\b10-0+(\d)\b/g,'10-$1');
 s=s.replace(new RegExp('\\b(signal|code|priority)[ -]+('+NUMBER_WORD+'(?:[ -]+'+NUMBER_WORD+'){0,2}|\\d{1,3})\\b','g'),(all,kind,n)=>{const value=wordsNumber(n,{max:999n});return value!==null?kind+' '+(kind==='code'&&Number(value)===0?'zero':Number(value)):all;});
 return s.replace(/\b(?:eleven|11)[ -]+(?:forty[ -]+four|four[ -]+four|44)\b/g,'11-44').replace(/\bfifty[ -]+one[ -]+fifty\b/g,'51-50');
}
function plateQuery(value){
 const raw=clean(value).replace(/[.,]$/,'').replace(/^(?:plate|tag|registration)(?:\s+(?:number|is|reads))?\s+/i,'');
 const parts=raw.toLowerCase().replace(/\bx ray\b/g,'xray').split(/[\s,]+/);
 if(parts.length>1&&parts.every(t=>PHONETIC[t]||DIGITS[t]!==undefined||/^[a-z0-9]$/.test(t)))return parts.map(t=>PHONETIC[t]||DIGITS[t]||t.toUpperCase()).join('');
 if(/^[a-z0-9-]{2,12}$/i.test(raw))return raw.toUpperCase();
 return null; // Do not guess a plate from partly recognized spelling.
}
function locationQuery(value){
 const s=clean(value).replace(/[?!.]+$/,'').replace(/\b(?:postal(?: code)?|post code)\s+([a-z -]+)$/i,(all,spoken)=>{const n=wordsNumber(spoken);return n===null?all:'postal '+n;}).replace(/\bpostal(?: code)?\s+((?:zero|oh|one|two|three|four|five|six|seven|eight|nine|niner)(?:[ -]+(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|niner)){1,7})\b/ig,(_,n)=>'postal '+wordsNumber(n,{digits:true}));
 return s.length>=2&&s.length<=100&&/^[\p{L}0-9 '\u2019.,-]+$/u.test(s)?s:null;
}
const reply = text => ({action:'reply',reply:clean(text).slice(0,450),steps:[],confirmation:false});
const clarify = text => ({action:'clarify',reply:clean(text).slice(0,450),steps:[],confirmation:false});
const step = (action,fields={}) => ({action,status:null,id:null,query:null,...fields});
const plan = (steps,confirmation=false,source='rules') => ({action:'plan',reply:'',steps,confirmation,source});
const hasOtherTarget = s => /\b(?:mark|show|set|put|attach|assign|detach|clear)\s+(?:him|her|them|their|his|another|all units|unit\s+[a-z0-9-]+)/i.test(s);
const hypothetical = s => /\b(?:what (?:does|is|would|happens)|what's|how (?:do|can|would|should)|explain|define|meaning of|hypothetically|suppose|if i|practice|training example|quoted|quotation)\b/i.test(s);
const reported = s => /\b(?:he|she|they|caller|someone|suspect)\s+(?:said|says|reported|asked)|\b(?:yesterday|last week|earlier i was|i was|i used to be)\b/i.test(s);
function emergencySignal(value){
 let s=normalizeCodes(value).replace(/^(?:hey |okay |ok )?(?:dispatch|central)[\s,:;.!-]*/,'').trim();
 if(hypothetical(s)||reported(s)||/["\u201c\u201d]/.test(s)||/\b(?:no|not|never|don't|dont|doesn't|do not|cancel|deactivate|disable|false|accidental|explain|meaning|means|mean|supported|support)\b/.test(s))return false;
 for(let i=0;i<3;i++)s=s.replace(/^(?:please|can you|could you|would you|i need you to|i need to|i need|go ahead and)\s+/,'').replace(/\s+(?:for me|right now|now|please|immediately)$/,'').trim();
 if(/^(?:(?:unit )?[a-z]{1,5}[ -]?\d{1,4}[ ,:;-]+)?(?:may[ -]?day|10-99|officer[ -]down|duress)(?:[\s,!.:-].*)?$/.test(s))return true;
 if(/^1099(?:$|[ ,;]+(?:at|near|postal|post code|now|please|on)\b)/.test(s))return true;
 if(/^(?:(?:my |a |an |the )?(?:duress|10-99|1099)(?: (?:alert|signal|alarm))?|(?:activate|enable|trigger|start|raise|send|turn on|set off)(?: (?:my|the|a|an))? (?:duress|10-99|1099)(?: (?:alert|signal|alarm))?|(?:i am|i'm|mark me|show me|put me)(?: as| on| in)? (?:10-99|in duress|under duress)|(?:i have|i've got) (?:a )?10-99)(?:$|[,;]?\s+(?:at|near|postal|post code|for|now|please|immediately|on|and|i)\b)/.test(s))return true;
 if(/^(?:i(?:'m| am) (?:being shot at|under fire|taking fire|down)|i(?:'ve| have) been shot|my unit is (?:under fire|taking fire)|(?:i need )?(?:immediate |urgent )?(?:emergency assistance|emergency help))(?:$|[ ,;!.].*)$/.test(s))return true;
 return /^(?:activate|trigger|set|declare|hit)\s+(?:(?:my|own|the)\s+)?(?:officer\s+)?(?:duress|panic|emergency)(?:\s+(?:alarm|alert|button))?[.!]?$/.test(s)||/^(?:i am|i'm)\s+(?:in distress|officer down)(?:[\s,!.].*)?$/.test(s);
}
function emergencyAction(value){
 if(!emergencySignal(value))return null;
 const s=normalizeCodes(value);
 return /\bofficer[ -]down\b|\bi(?:'ve| have) been shot\b|\bi am down\b|\bi'm down\b/.test(s)?'officer_down':'duress';
}
function referenceIndex(book){
 if(!book||!Array.isArray(book.sections))fail('Valid CAD radio reference required');
 const entries=book.sections.flatMap(s=>s.entries||[]),index=new Map();
 for(const e of entries){if(typeof e.code!=='string'||typeof e.meaning!=='string')fail('Invalid CAD radio reference');index.set(normalizeCodes(e.code),e);for(const a of e.code.split(/\s*\/\s*/))if(a!==e.code&&!index.has(normalizeCodes(a)))index.set(normalizeCodes(a),e);}
 return {entries,index};
}
function callId(text){
 const s=normalizeCodes(text),m=/\b(?:call|incident)(?:\s+(?:number|#))?\s+(\d{1,18})(?!\d)\b/.exec(s);if(m&&BigInt(m[1])>0n)return String(BigInt(m[1]));
 const word=new RegExp('\\b(?:call|incident)(?: number)? ('+NUMBER_WORD+'(?:[ -]+(?:'+NUMBER_WORD+'|thousand|and)){0,9})(?=$|[,.;]| (?:and|then|please|for|at|to)\\b)','i').exec(s);
 if(word){const n=wordsNumber(word[1]);if(n!==null&&BigInt(n)>0n)return String(BigInt(n));}return null;
}
function activeCalls(context,assigned=false){
 const rows=assigned?(context?.assigned_calls||[]):[...(context?.assigned_calls||[]),...(context?.available_calls||[])];
 const out=new Map();for(const c of rows){if(c&&/^[1-9]\d{0,17}$/.test(String(c.id))&&!/^(?:closed|cleared|cancelled|canceled|archived)$/i.test(String(c.status||'')))out.set(String(c.id),c);}return [...out.values()];
}
function resolveCall(text,context,{assigned=false}={}){
 const id=callId(text);if(id)return {id};
 const all=activeCalls(context,assigned),s=normalizeCodes(text);
 if(/\b(?:my|current|this|that)\s+(?:active\s+|assigned\s+)?(?:call|incident|assignment)\b|\bmy assignment\b/.test(s)||/^(?:read|give|tell)(?: me)?(?: the| my)? (?:call )?(?:details|brief|briefing|information)(?: please| again)?$/.test(s)){
  const own=activeCalls(context,true);if(own.length===1)return {id:String(own[0].id)};if(!own.length)return {question:'Your unit has no current assignment. Which call should I use?'};
  return {question:'Your unit has multiple assignments. Which incident or location?'};
 }
 const stop=new Set('dispatch central please can could would you me my to the a an for of at on about with give read tell details information attach assign add put send detach remove take clear close resolve mark show set status en route scene responding from call incident again then and it this that let get see want need going head heading available busy'.split(' '));
 const tokens=[...new Set(s.replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(t=>t&&!stop.has(t)))];
 const aliases={crash:'collision',accident:'collision',wreck:'collision',domestic:'domestic',burglary:'burglary'};
 const words=v=>normalizeCodes(v).replace(/\b(?:crash|accident|wreck)\b/g,'collision').replace(/\b(?:rd)\b/g,'road').replace(/\b(?:st)\b/g,'street').split(/[^a-z0-9]+/).filter(Boolean);
 const wanted=tokens.map(t=>aliases[t]||t).filter(t=>t!=='up');
 const matches=wanted.length?all.filter(c=>{const hay=new Set(words([c.call_type,c.location,c.postal_code||c.postal].join(' ')));return wanted.every(t=>hay.has(t));}):[];
 if(matches.length===1)return {id:String(matches[0].id)};
 if(matches.length>1)return {question:'I found more than one matching call: '+matches.slice(0,3).map(c=>clean(c.call_type)+' at '+clean(c.location)).join('; ')+'. Which one?'};
 return {question:'Which call or incident location should I use?'};
}
function validateStep(value){
 if(!value||Array.isArray(value)||typeof value!=='object'||!TOOLS.includes(value.action))fail('Unsupported CAD action');
 const keys=Object.keys(value);if(keys.some(k=>!['action','status','id','query'].includes(k)))fail('Unexpected action fields');
 const v=step(value.action,{status:value.status??null,id:value.id??null,query:value.query??null});
 if(v.action==='set_status'?!STATUS.includes(v.status):v.status!==null)fail('Invalid status field');
 if(CALL_TOOLS.has(v.action)){if(v.id!==null&&(typeof v.id!=='string'||!/^[1-9]\d{0,17}$/.test(v.id)))fail('Invalid call ID');if(REQUIRED_CALL_TOOLS.has(v.action)&&v.id===null)fail('Explicit call ID required');}else if(v.id!==null)fail('Unexpected call ID');
 if(QUERY_TOOLS.has(v.action)){
  const max=['add_note','caller_contact','dispatch_update','caller_update','create_call'].includes(v.action)?800:v.action==='unit_update'?500:v.action==='patrol_activity'?140:100;
  if(typeof v.query!=='string'||v.query!==clean(v.query)||v.query.length<2||v.query.length>max||!/^[\p{L}0-9 '\u2019.,:;!?/#()&|_-]+$/u.test(v.query))fail('Invalid query');
  if(v.action==='run_plate'&&!/^[A-Z0-9-]{2,12}$/.test(v.query))fail('Invalid exact plate');
  if(v.action==='run_vin'&&!/^[A-Z0-9-]{3,30}$/.test(v.query))fail('Invalid VIN query');
  if(v.action==='run_dl'&&!/^[\p{L}0-9-]{4,100}$/u.test(v.query))fail('Invalid license query');
  if(['assign_unit','detach_unit'].includes(v.action)&&!/^[A-Z0-9 -]{1,40}$/.test(v.query))fail('Invalid callsign query');
  if(v.action==='set_response_plan'&&!/^(?:Primary response|Backup|Supervisor|Traffic control|Scene security|Fire response|EMS response|Transport|Investigate); Code [1-4]$/.test(v.query))fail('Invalid response plan');
  if(v.action==='update_service'&&!/^(?:LE|FIRE|EMS) (?:requested|assigned|en route|on scene|cleared)$/.test(v.query))fail('Invalid service update');
  if(v.action==='cancel_resource'&&!/^(?:backup|supervisor|fire|ems|tow|coroner|traffic control|scene security|transport|investigate|emergency traffic|secondary channel)$/.test(v.query))fail('Invalid resource cancellation');
  if(['dispatch_update','caller_update'].includes(v.action)&&v.query.length<20)fail('Incident update needs at least 20 characters');
  if(v.action==='broadcast_call'&&!/^(?:any available|supervisors|attached); (?:normal|emergency); notes (?:on|off)$/.test(v.query))fail('Invalid broadcast plan');
  if(v.action==='broadcast_call'&&/; emergency;/.test(v.query)&&!v.query.startsWith('any available;'))fail('Emergency broadcast must use any available audience');
  if(v.action==='create_call'){const parts=v.query.split(' | ');if(parts.length!==6||parts[0].length<2||parts[0].length>80||! /^[1-4]$/.test(parts[1])||parts[2].length<1||parts[2].length>16||parts[3].length<2||parts[3].length>80||parts[4].length<3||parts[4].length>160||parts[5].length<100||parts[5].split(/\s+/).length<18)fail('Invalid dispatcher-created call details');}
  if(v.action==='patrol_activity'&&!/^(?:start (?:building|perimeter); [\p{L}0-9 '\u2019.,/-]{2,100}|(?:complete|cancel) (?:building|perimeter)(?:; [\p{L}0-9 '\u2019.,/-]{2,100})?)$/u.test(v.query))fail('Invalid patrol activity');
  if(v.action==='unit_update'&&v.query.length<3)fail('Unit update needs at least 3 characters');
 }else if(RESOURCE_TOOLS.has(v.action)){
  if(v.query!==null&&!/^Code [1-4]$/.test(v.query))fail('Invalid response code');
 }else if(v.query!==null)fail('Unexpected query');
 return Object.freeze(v);
}
function validatePlan(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.steps)||value.steps.length>4)fail('Invalid action plan');
 if(Object.keys(value).some(k=>!['action','steps','reply','confirmation','source','scope_tag'].includes(k)))fail('Unexpected plan fields');
 if(!['plan','reply','clarify','cancel'].includes(value.action))fail('Invalid plan kind');
 const steps=value.steps.map(validateStep);
 if(value.action==='plan'?!steps.length:steps.length!==0)fail('Plan/action mismatch');
 if(typeof value.reply!=='string'||value.reply.length>450||/[\u0000-\u001f\u007f]/.test(value.reply))fail('Invalid plan reply');
 if(value.action==='plan'&&value.reply!=='')fail('Executable plans cannot carry unverified narrative acknowledgements');
 if(typeof value.confirmation!=='boolean')fail('Invalid confirmation flag');
 if(steps.some(s=>['duress','officer_down'].includes(s.action))&&(steps.length!==1||value.confirmation))fail('Emergency must be immediate and standalone');
 const statuses=steps.filter(s=>s.action==='set_status');if(statuses.length>1)fail('Conflicting status updates');
 if(new Set(steps.map(s=>JSON.stringify(s))).size!==steps.length)fail('Duplicate action');
 if(steps.some(s=>s.action==='close_call')&&steps.length>1)fail('Call closure must be reviewed separately');
 if(steps.some(s=>s.action==='go_off_duty')&&steps.length>1)fail('Going off duty must be reviewed separately');
 return {action:value.action,steps,reply:value.reply,confirmation:value.confirmation,source:value.source==='rules'?'rules':'model'};
}
function canonicalCommand(v){
 const s=validateStep(v);
 if(s.action==='set_status')return 'set status '+s.status;
 if(['run_name','run_plate','run_dl','run_vin','run_person_record','set_location'].includes(s.action))return ({run_name:'run name',run_plate:'run plate',run_dl:'run dl',run_vin:'run vin',run_person_record:'run person record',set_location:'set location'})[s.action]+' '+s.query;
 if(s.action==='call')return s.id?'call '+s.id:'my call details';
 if(s.action==='caller_card')return 'caller card call '+s.id;
 if(s.action==='caller_thread')return 'caller thread call '+s.id;
 if(s.action==='call_resources')return 'call resources call '+s.id;
 if(s.action==='response_plan')return 'response plan call '+s.id;
 if(['attach','detach'].includes(s.action))return s.action+' call '+s.id;
 if(s.action==='close_call')return 'close call'+(s.id?' '+s.id:'');
 if(s.action==='trace'||s.action==='trace_advance')return s.action+(s.id?' call '+s.id:'');
 if(RESOURCE_TOOLS.has(s.action))return 'request '+s.action.slice(8).replaceAll('_',' ')+' call '+s.id+(s.query?' '+s.query.toLowerCase():'');
 if(s.action==='add_note')return 'add note call '+s.id+' '+s.query;
 if(s.action==='caller_contact')return 'contact caller call '+s.id+' '+s.query;
 if(s.action==='dispatch_best')return 'dispatch best call '+s.id;
 if(s.action==='auto_services')return 'auto services call '+s.id;
 if(s.action==='set_response_plan')return 'set response plan call '+s.id+' '+s.query;
 if(s.action==='assign_unit')return 'assign unit '+s.query+' call '+s.id;
 if(s.action==='detach_unit')return 'detach unit '+s.query+' call '+s.id;
 if(s.action==='update_service')return 'update service call '+s.id+' '+s.query;
 if(s.action==='cancel_resource')return 'cancel resource '+s.query+' call '+s.id;
 if(s.action==='dispatch_update')return 'dispatch update call '+s.id+' '+s.query;
 if(s.action==='caller_update')return 'caller update call '+s.id+' '+s.query;
 if(s.action==='broadcast_call')return 'broadcast call '+s.id+' '+s.query;
 if(s.action==='create_call')return 'create call '+s.query;
 if(s.action==='unit_update')return 'unit update call '+s.id+' '+s.query;
 if(s.action==='patrol_activity')return 'patrol activity '+s.query;
 if(s.action==='go_off_duty')return 'go off duty';
 if(s.action==='clear_duress')return 'clear duress';
 if(s.action==='officer_down')return 'officer down';
 return s.action;
}
function createLanguage(book){
 const {entries,index}=referenceIndex(book);
 function codeReply(code){
  const key=normalizeCodes(code);if(/^signal (41|42)$/.test(key))return 'Signals 41 and 42 are retired in the CAD reference. Use plain language.';
  const e=index.get(key);return e?'In the CAD roleplay reference, '+e.code+' means '+e.meaning.replace(/\.$/,'')+'.':'That code is not defined in this CAD reference. Use plain language.';
 }
 function reference(text){
  const s=normalizeCodes(text).replace(/[?!.]+$/,'');
  const m=/^(?:what (?:does|is|are)|what's|define|explain|meaning of|remind me what)\s+(.+?)(?:\s+(?:mean|means|stand for))?$/.exec(s);if(!m)return null;
  const keys=m[1].split(/\s+and\s+|,\s*/).slice(0,3);if(!keys.every(k=>index.has(k)||/^(?:10-\d{1,3}|signal \d{1,3}|code \w+)$/.test(k)))return null;
  return reply(keys.map(codeReply).join(' '));
 }
 function ownCall(context){const own=activeCalls(context,true);return own.length===1?{id:String(own[0].id)}:own.length?{question:'Your unit has multiple assignments. Which incident or location?'}:{question:'Your unit has no current assignment. Which call should I use?'};}
 function targetCall(text,context,{assigned=true}={}){const direct=resolveCall(text,context,{assigned});if(direct.id)return direct;const explicit=callId(text);if(explicit)return {id:explicit};return ownCall(context);}
 function requestStep(action,text,context){const found=targetCall(text,context,{assigned:true});if(!found.id)return clarify(found.question);const m=/\bcode ([1-4])\b/.exec(normalizeCodes(text));return plan([step(action,{id:found.id,query:m?'Code '+m[1]:null})]);}
 function one(text,context){
  const original=clean(text),s=normalizeCodes(original).replace(/[?!.]+$/,'').replace(/^please\s+|\s+please$/g,'').replace(/^(?:can|could|would|will) you\s+/,'');
  if(!s)return null;
  const r=reference(s);if(r)return r;
  if(/^(?:cancel|never mind|nevermind|disregard(?: that| last(?: request| information)?)?|10-22|stop that)$/.test(s))return {action:'cancel',steps:[],reply:'Unsent request cancelled. Completed CAD actions have not been undone.',confirmation:false};
  if(/^(?:10-2|radio check|check in|are you there|hello|how do you read(?: me)?)$/.test(s))return reply('Dispatch copies. Radio check acknowledged.');
  if(s==='10-4')return reply('10-4. Dispatch copies.');
  if(s==='10-73')return plan([step('status')]);
  if(/^(?:am i|are we|is my unit|what(?:'s| is) my|check my)\b/.test(s)&&/status|available|on scene|en route|10-\d+|on duty/.test(s))return plan([step('status')]);
  if(/^(?:10-20|location|my location|where am i|what(?:'s| is) (?:my |our )?(?:10-20|location))$/.test(s))return plan([step('location')]);
  const callerThread=/^(?:read|show|give me|check)? ?(?:the )?(?:caller messages?|caller thread|caller conversation|911 messages?)(?: (?:on|for) (?:(?:my|the|this|that) )?(?:call|incident)(?:\s+([1-9]\d{0,17}))?)?$|^(?:what did|what has) (?:the )?caller (?:say|said|send|sent)(?: (?:on|for) (?:(?:my|the|this|that) )?(?:call|incident)(?:\s+([1-9]\d{0,17}))?)?$/i.exec(original);
  if(callerThread){const explicit=callerThread[1]||callerThread[2],found=explicit?{id:explicit}:ownCall(context);return found.id?plan([step('caller_thread',{id:found.id})]):clarify(found.question);}
  const resourcesRead=/^(?:(?:read|show|list|check)(?: me)? )?(?:the )?(?:resources|services|responding resources|requested resources)(?: (?:on|for))? (?:my |the |this |that )?(?:call|incident)?(?:\s+([1-9]\d{0,17}))?$|^(?:what|which) (?:resources|services)(?: are| have been)? (?:coming|responding|requested|assigned|on scene|on my call|on the call)(?: (?:on|for))? (?:call|incident)?(?:\s+([1-9]\d{0,17}))?$/i.exec(original);
  if(resourcesRead){const explicit=resourcesRead[1]||resourcesRead[2],found=explicit?{id:explicit}:ownCall(context);return found.id?plan([step('call_resources',{id:found.id})]):clarify(found.question);}
  const responseRead=/^(?:(?:read|show|check|give me) (?:the )?)?(?:response plan|response code)(?: (?:on|for))? (?:my |the |this |that )?(?:call|incident)?(?:\s+([1-9]\d{0,17}))?$|^(?:what(?:'s| is) (?:the )?|how are we )(?:response plan|response code|responding)(?: (?:on|for|to))? (?:my |the |this |that )?(?:call|incident)?(?:\s+([1-9]\d{0,17}))?$/i.exec(original);
  if(responseRead){const explicit=responseRead[1]||responseRead[2],found=explicit?{id:explicit}:ownCall(context);return found.id?plan([step('response_plan',{id:found.id})]):clarify(found.question);}
  if(hypothetical(s))return null;
  if(reported(s)||/["\u201c\u201d]/.test(s))return reply('That is a question or report, not an instruction to change CAD. Tell me the action you want for your own unit.');
  const activityText=original.replace(/(?: right now| now| at this time)[.!?]*$/i,'').replace(/[.!?]+$/,'');
  const activity=/^(?:(?:show|mark|put|log) (?:me|my|my unit)(?: as)? )?(?:i(?:'m| am) )?(starting|start|beginning|begin|conducting|doing|completing|complete|finished|finishing|finish|ending|end|canceling|cancelling|cancel)(?: my)? (?:a )?(building|perimeter) (?:checks?|inspections?)(?: (?:in|at|on|around) (.{2,100}))?$/i.exec(activityText);
  if(activity){const mode=/^(?:starting|start|beginning|begin|conducting|doing)$/i.test(activity[1])?'start':/^cancel/i.test(activity[1])?'cancel':'complete',kind=activity[2].toLowerCase(),place=activity[3]?clean(activity[3]):null;if(mode==='start'&&!place)return clarify('What area, road or subregion are you checking?');const query=mode+' '+kind+(place?'; '+place:'');try{return plan([validateStep(step('patrol_activity',{query}))]);}catch{return clarify('Give one short area or road name for your own checks.');}}
  const reportCodes=new Set(['10-5','10-10','10-11','10-12','10-13','10-14','10-15','10-16','10-17','10-24','10-25','10-26','10-30','10-37','10-38','10-39','10-40','10-43','10-46','10-47','10-48','10-49','10-50','10-55','10-56','10-57','10-58','10-60','10-61','10-62','10-63','10-64','10-65','10-66','10-67','10-68','10-70','10-80']);
  const reportCode=/^(10-(?:5|10|11|12|13|14|15|16|17|24|25|26|30|37|38|39|40|43|46|47|48|49|50|55|56|57|58|60|61|62|63|64|65|66|67|68|70|80))(?:[,:; -]+(.{2,420}))?$/.exec(s);
  if(reportCode&&reportCodes.has(reportCode[1])){const found=ownCall(context);if(!found.id)return clarify(found.question);const meaning=index.get(reportCode[1])?.meaning||reportCode[1],detail=reportCode[2]?clean(reportCode[2]):'';if(['10-5','10-43'].includes(reportCode[1])&&!detail)return clarify('What information should I relay to the units attached to your call?');if(reportCode[1]==='10-26'&&!detail)return clarify('What ETA should I relay to the units attached to your call?');return plan([step('unit_update',{id:found.id,query:(meaning+(detail?'. '+detail:'')).slice(0,500)})]);}
  const reportAliases=[['Shots fired',/^(?:shots fired|gunshots heard|taking gunfire)$/],['Foot pursuit',/^(?:foot pursuit|suspect is running|suspect fled on foot)$/],['Vehicle pursuit',/^(?:vehicle pursuit|in pursuit|pursuit in progress)$/],['Fight in progress',/^(?:fight in progress|active fight)$/],['Subject in custody',/^(?:subject in custody|one in custody|suspect in custody)$/],['Stolen vehicle',/^(?:stolen vehicle|vehicle is stolen)$/],['Suspicious person',/^(?:suspicious person|suspicious subject)$/],['Vehicle accident',/^(?:vehicle accident|traffic collision|vehicle collision)$/],['Fire',/^(?:active fire|structure fire|vehicle fire)$/],['Armed with gun',/^(?:armed with (?:a )?gun|subject has a gun)$/],['Armed with knife',/^(?:armed with (?:a )?knife|subject has a knife)$/],['Kidnapping',/^(?:kidnapping|possible kidnapping)$/],['Armed robbery',/^(?:armed robbery|robbery in progress)$/],['Reckless driver',/^(?:reckless driver|reckless vehicle)$/],['Intoxicated driver',/^(?:intoxicated driver|suspected dui|suspected dwi)$/],['Hit and run without injury',/^(?:hit and run|hit-and-run)$/]];
  for(const [meaning,re] of reportAliases)if(re.test(s)){const found=ownCall(context);return found.id?plan([step('unit_update',{id:found.id,query:meaning})]):clarify(found.question);}
  const unitUpdate=/^(?:(?:update|advise|tell) (?:dispatch|central|my call|the units|attached units)(?: (?:on|that))?|be advised|(?:update|information) for (?:my|the) call)\s*[:,-]?\s+(.{3,500})$/i.exec(original);
  if(unitUpdate){const found=ownCall(context);return found.id?plan([step('unit_update',{id:found.id,query:clean(unitUpdate[1])})]):clarify(found.question);}
  const createCall=/^(?:create|open|start) (?:a )?(?:call|incident) type (.{2,80}?) priority ([1-4]) postal ([A-Za-z0-9-]{1,16}) area (.{2,80}?) location (.{3,160}?) narrative (.{100,600})$/i.exec(original);
  if(createCall){const narrative=clean(createCall[6]);if(narrative.split(/\s+/).length<18)return clarify('Give at least 18 words of incident information so the CAD call has a complete dispatch narrative.');return plan([step('create_call',{query:[clean(createCall[1]),createCall[2],clean(createCall[3]),clean(createCall[4]),clean(createCall[5]),narrative].join(' | ')})],true);}
  if(/^(?:create|open|start) (?:a )?(?:call|incident) type /i.test(original))return clarify('Give call type, priority 1 through 4, postal, area, location, and at least 18 words / 100 characters of incident narrative. Nothing has been created.');
  const currentUpdate=/^(?:add|record|log|send|give)(?: (?:the|this))? (?:current information|updated information|dispatch update)(?: (?:to|on|for))? (?:call|incident) ([1-9]\d{0,17})\s*[:,-]?\s+(.{20,800})$/i.exec(original);
  if(currentUpdate)return plan([step('dispatch_update',{id:currentUpdate[1],query:clean(currentUpdate[2])})],true);
  const callerUpdate=/^(?:caller (?:advised|reported|stated|said)|add caller update)(?: (?:to|on|for))? (?:call|incident) ([1-9]\d{0,17})\s*[:,-]?\s+(.{20,800})$/i.exec(original);
  if(callerUpdate)return plan([step('caller_update',{id:callerUpdate[1],query:clean(callerUpdate[2])})],true);
  const cancelResource=/^(?:cancel|withdraw|disregard|clear) (?:the )?(backup|supervisor|fire|ems|tow|wrecker|coroner|traffic control|scene security|transport|investigator|investigate|emergency traffic|secondary channel|tac channel)(?: request)?(?: (?:on|for) (?:call|incident) ([1-9]\d{0,17}))?$/.exec(s);
  if(cancelResource){let resource=cancelResource[1];if(resource==='investigator')resource='investigate';if(resource==='wrecker')resource='tow';if(resource==='tac channel')resource='secondary channel';const found=cancelResource[2]?{id:cancelResource[2]}:ownCall(context);return found.id?plan([step('cancel_resource',{id:found.id,query:resource})],true):clarify(found.question);}
  const broadcast=/^(?:(?:dispatch|broadcast|rebroadcast|send) )?(?:call|incident) ([1-9]\d{0,17})(?: (?:to|for))? (any available units?|all available units?|supervisors?|attached units?)(?:,|\s)+(normal|routine|emergency)(?: traffic)?(?:,|\s)+(include|exclude|with|without|no) caller notes$/i.exec(original);
  if(broadcast){const audience=/supervisor/i.test(broadcast[2])?'supervisors':/attached/i.test(broadcast[2])?'attached':'any available',traffic=/emergency/i.test(broadcast[3])?'emergency':'normal',notes=/^(?:include|with)$/i.test(broadcast[4])?'on':'off';if(traffic==='emergency'&&audience!=='any available')return clarify('Emergency traffic is a broad any-available broadcast. Say any available units, or use normal traffic for a limited audience.');return plan([step('broadcast_call',{id:broadcast[1],query:`${audience}; ${traffic}; notes ${notes}`})],true);}
  const responsePlan=/^(?:set|change|update) (?:the )?response plan call ([1-9]\d{0,17}) (primary response|backup|supervisor|traffic control|scene security|fire response|ems response|transport|investigate) code ([1-4])$/.exec(s)||/^set call ([1-9]\d{0,17}) (primary response|backup|supervisor|traffic control|scene security|fire response|ems response|transport|investigate) code ([1-4])$/.exec(s);
  if(responsePlan){const types={'primary response':'Primary response','backup':'Backup','supervisor':'Supervisor','traffic control':'Traffic control','scene security':'Scene security','fire response':'Fire response','ems response':'EMS response','transport':'Transport','investigate':'Investigate'},type=types[responsePlan[2]];return plan([step('set_response_plan',{id:responsePlan[1],query:type+'; Code '+responsePlan[3]})],true);}
  const assignOther=/^(?:(?:assign|send|put) (?:unit )?|attach unit )((?:[a-z]{1,8}[ -]?\d{1,5}|\d{1,5})) (?:to|on) (.+)$/.exec(s);
  if(assignOther){const q=clean(assignOther[1]).toUpperCase(),target=clean(assignOther[2]);if(!/^(?:ME|MY UNIT)$/.test(q)){const found=resolveCall(target,context,{assigned:false});return found.id?plan([step('assign_unit',{id:found.id,query:q})],true):clarify(found.question);}}
  const serviceUpdate=/^(?:mark|set|update) (le|fire|ems) (requested|assigned|en route|on scene|cleared) (?:on|for) (?:call|incident) ([1-9]\d{0,17})$/.exec(s)||/^clear (le|fire|ems) (?:from|on) (?:call|incident) ([1-9]\d{0,17})$/.exec(s);
  if(serviceUpdate){const clearForm=serviceUpdate[3]===undefined,status=clearForm?'cleared':serviceUpdate[2],id=clearForm?serviceUpdate[2]:serviceUpdate[3];return plan([step('update_service',{id,query:serviceUpdate[1].toUpperCase()+' '+status})],true);}
  const detachOther=/^(?:detach|remove|clear) (?:unit )?((?:[a-z]{1,8}[ -]?\d{1,5}|\d{1,5})) (?:from|off) (.+)$/.exec(s);
  if(detachOther){const q=clean(detachOther[1]).toUpperCase(),target=clean(detachOther[2]);if(!/^(?:ME|MY UNIT)$/.test(q)){const found=resolveCall(target,context,{assigned:false});return found.id?plan([step('detach_unit',{id:found.id,query:q})],true):clarify(found.question);}}
  if(hasOtherTarget(s))return reply('Voice actions control only your verified unit. Use authorized dispatch controls to manage another unit.');
  if(/\b(?:do not|don't|never|not yet|hold off|without changing|without updating)\b/.test(s))return reply('Understood. I have not changed CAD.');
  if(/^(?:am i|is my unit|what(?:'s| is) my|check my)\b/.test(s)&&/status|available|on scene|en route|10-\d+|on duty/.test(s))return plan([step('status')]);
  if(/^(?:10-4|copy|copied|roger|acknowledged|affirmative|understood|thanks|thank you)$/.test(s))return reply('Dispatch copies.');
  if(/^(?:10-2|radio check|check in|are you there|hello|how do you read(?: me)?)$/.test(s))return reply('Dispatch copies. Radio check acknowledged.');
  if(/^(?:10-9|repeat(?: that| last(?: call| transmission)?)?|say again|repeat the last transmission)$/.test(s))return {action:'repeat'};
  if(/^(?:10-73|status|my status|unit status|duty status)$/.test(s))return plan([step('status')]);
  if(/^(?:what(?:'s| is) (?:my |our )?(?:10-20|location)|where am i)$/.test(s))return reply('Your saved location is available in CAD. I will not guess your current position.');
  if(/^(?:(?:show|list|read|give) (?:me )?(?:the )?)?(?:active|pending|open)?\s*calls$|^(?:any calls(?: pending)?|what calls are (?:active|pending|open))$/.test(s))return plan([step('calls')]);
  if(/^(?:(?:show|list|read|give) (?:me )?(?:the )?)?(?:(?:available|on duty) )?units$|^who(?:'s| is) (?:available|on duty)$/.test(s))return plan([step('units')]);
  if(/^(?:clear|cancel|deactivate|disable|turn off|stop) (?:my |the )?(?:duress|10-99|1099|panic|emergency)(?: (?:alert|signal|alarm))?$/.test(s))return plan([step('clear_duress')]);
  if(/^(?:go|take me|put me|mark me|clock me|show me) off duty$|^(?:end|close) my (?:duty|shift)$/.test(s))return plan([step('go_off_duty')],true);
  if(s==='10-42')return plan([step('go_off_duty')],true);
  if(s==='10-41')return reply('Your verified voice session is already on duty. To begin a new tour from off duty, sign on through CAD first.');
  if(/^(?:10-98|clear me|clear my call|i(?:'m| am) clear|assignment complete)$/.test(s)){
   const found=ownCall(context);return found.id?plan([step('detach',{id:found.id}),step('set_status',{status:'available'})]):clarify(found.question);
  }
  if(/^(?:caller card|caller information|caller info|10-88)(?:\s+for)?(?:\s+my)?(?:\s+call)?$/.test(s)){
   const found=ownCall(context);return found.id?plan([step('caller_card',{id:found.id})]):clarify(found.question);
  }
  const resourceRules=[
   ['request_backup',/^(?:10-32|backup|request backup|need backup|send backup|dispatch backup|(?:dispatch|send|get|roll|start) (?:me )?(?:another|an additional|additional) (?:car|unit)|send additional units?|need (?:another|more|extra) units?|need cover|send (?:me )?cover)(?:\b|\s)/],
   ['request_coroner',/^(?:10-34|request (?:the )?coroner|call (?:the )?coroner|send (?:the )?coroner|need (?:the )?coroner|(?:send|request|need) (?:the )?medical examiner)(?:\b|\s)/],
   ['request_tow',/^(?:10-51|request (?:a )?tow(?: truck)?|send (?:a )?tow(?: truck)?|need (?:a )?tow(?: truck)?|(?:send|get|need|request) (?:me )?(?:a )?(?:wrecker|flatbed|recovery truck))(?=\b|\s|$)/],
   ['request_ems',/^(?:10-52|request ems|request (?:an )?ambulance|send ems|send (?:an )?ambulance|need ems|need medical assistance|(?:send|get|need|request|start) (?:me )?(?:the )?(?:medics?|paramedics?))(?=\b|\s|$)/],
   ['request_fire',/^(?:10-53|request fire|request (?:the )?fire department|send fire|send (?:the )?fire department|need fire|(?:send|get|need|request|start) (?:me )?(?:an )?(?:engine|fire crew|fire truck))(?=\b|\s|$)/],
   ['request_supervisor',/^(?:10-71|request (?:a )?supervisor|send (?:a )?supervisor|need (?:a )?supervisor|request (?:a )?sergeant|send (?:a )?sergeant|(?:send|get|need|request) (?:me )?(?:a )?(?:boss|sarge|lieutenant|watch commander|shift supervisor))(?=\b|\s|$)/],
   ['request_emergency_traffic',/^(?:10-33|request emergency traffic|hold (?:the )?(?:air|traffic|channel)|clear (?:the )?(?:air|channel)|emergency traffic|lock (?:the )?radio)(?:\b|\s)/],
   ['request_secondary_channel',/^(?:10-86|request (?:a )?secondary channel|move (?:this|the incident|us) to (?:a )?secondary channel|need (?:a )?secondary channel|(?:give|move|put) (?:me|us|this|the incident) (?:on|to) (?:a )?(?:tac|tactical|secondary) channel|(?:give|move|put) (?:me|us) (?:on|to) tac)(?:\b|\s)/],
   ['request_traffic_control',/^(?:(?:request|send|need|get) traffic control|(?:send|get|need) (?:someone|a unit) to (?:handle|block|control) traffic)(?:\b|\s)/],
   ['request_scene_security',/^(?:(?:request|send|need|get) scene security|(?:lock|secure) (?:this|the) scene down|(?:set|get|establish) (?:a )?perimeter)(?:\b|\s)/],
   ['request_transport',/^(?:request|send|need|get) (?:a )?(?:transport(?: unit)?|prisoner transport|wagon)(?:\b|\s)/],
   ['request_investigate',/^(?:request|send|need|get) (?:an |a )?(?:investigator|detective)(?:\b|\s)/]
  ];
  // A single natural sentence may request several resources ("send fire and EMS").
  // Detect the whole bundle before the first single-resource rule so no supported
  // action is silently dropped. One global response code may apply to the bundle.
  if(/^(?:please )?(?:request|send|get|need|start|roll|call|have)\b/.test(s)){
   const aliases=[
    ['request_backup',/\b(?:backup|back up|another (?:car|unit)|additional units?|extra units?|more units?|cover)\b/g],
    ['request_supervisor',/\b(?:supervisor|sergeant|sarge|lieutenant|watch commander|shift supervisor|boss)\b/g],
    ['request_ems',/\b(?:ems|ambulance|medics?|paramedics?|medical assistance)\b/g],
    ['request_fire',/\b(?:fire department|fire crew|fire truck|engine|fire)\b/g],
    ['request_tow',/\b(?:tow truck|tow|wrecker|flatbed|recovery truck)\b/g],
    ['request_coroner',/\b(?:coroner|medical examiner)\b/g],
    ['request_traffic_control',/\btraffic control\b/g],
    ['request_scene_security',/\b(?:scene security|perimeter)\b/g],
    ['request_transport',/\b(?:prisoner transport|transport unit|transport|wagon)\b/g],
    ['request_investigate',/\b(?:investigator|detective)\b/g],
    ['request_emergency_traffic',/\b(?:emergency traffic|hold (?:the )?(?:air|traffic|channel)|clear (?:the )?(?:air|channel)|lock (?:the )?radio)\b/g],
    ['request_secondary_channel',/\b(?:secondary channel|tactical channel|tac channel)\b/g]
   ];
   const hits=[];for(const [resource,re] of aliases){re.lastIndex=0;let m;while((m=re.exec(s)))hits.push({resource,index:m.index});}
   const unique=[...new Map(hits.sort((a,b)=>a.index-b.index).map(h=>[h.resource,h])).values()];
   if(unique.length>1){if(unique.length>4)return clarify('Please split that resource request into groups of no more than four actions.');const codes=[...s.matchAll(/\bcode ([1-4])\b/g)];if(codes.length>1)return null;const found=targetCall(s,context,{assigned:true});if(!found.id)return clarify(found.question);const query=codes.length?'Code '+codes[0][1]:null;return plan(unique.map(h=>step(h.resource,{id:found.id,query})));}
  }
  for(const [resource,re] of resourceRules)if(re.test(s))return requestStep(resource,s,context);
  const callerCard=/^(?:show|read|give|pull) (?:me )?(?:the )?caller (?:card|information|info)(?:\s+for)?\s+(.+)$/.exec(s);
  if(callerCard){const found=targetCall(callerCard[1],context,{assigned:false});return found.id?plan([step('caller_card',{id:found.id})]):clarify(found.question);}
  const dlCode=/^(?:10[- ]27|ten twenty[- ]seven)(?:\s+(?:on|for|license|dl|oln))?\s+(.+)$/i.exec(original);
  if(dlCode){const raw=clean(dlCode[1]);if(/[0-9-]/.test(raw)&&/^[\p{L}0-9-]{4,100}$/u.test(raw.replace(/\s+/g,''))){const q=raw.toUpperCase().replace(/\s+/g,'');return plan([step('run_dl',{query:q})]);}return raw.length>=2&&raw.length<=100?plan([step('run_name',{query:raw})]):clarify('Please give the exact driver license number or civilian name.');}
  const dl=/^(?:run|check|look up|lookup|verify)(?: (?:a|the))? (?:dl|driver license|drivers license|driver's license|license number|oln)(?: (?:for|on|of))?\s+(.+)$/i.exec(original);
  if(dl){const q=clean(dl[1]).toUpperCase().replace(/\s+/g,'');return /^[\p{L}0-9-]{4,100}$/u.test(q)?plan([step('run_dl',{query:q})]):clarify('Please give the exact driver license or document number.');}
  const vin=/^(?:run|check|look up|lookup|verify)(?: (?:a|the))? vin(?: (?:for|on|of|number))?\s+(.+)$/i.exec(original);
  if(vin){const q=clean(vin[1]).toUpperCase().replace(/[^A-Z0-9-]/g,'');return /^[A-Z0-9-]{3,30}$/.test(q)?plan([step('run_vin',{query:q})]):clarify('Please give at least three exact VIN characters.');}
  const historyCode=/^(?:10[- ]54|ten fifty[- ]four)(?:\s+(?:on|for|name))?\s+(.+)$/i.exec(original);
  if(historyCode){const q=clean(historyCode[1]);return q.length>=2&&q.length<=100?plan([step('run_person_record',{query:q})]):clarify('Please give the exact civilian name for the record check.');}
  const history=/^(?:run|check|look up|lookup)(?: (?:the|a))? (?:criminal history|record|history)(?: (?:for|on|of))?\s+(.+)$/i.exec(original);
  if(history){const q=clean(history[1]);return q.length>=2&&q.length<=100?plan([step('run_person_record',{query:q})]):clarify('Please give the exact civilian name for the record check.');}
  const warrant=/^(?:10-29)(?:\s+(?:on|for|name))?\s+(.+)$/i.exec(original);
  if(warrant){const q=clean(warrant[1]);return q.length>=2&&q.length<=100?plan([step('run_name',{query:q})]):clarify('Please give the exact civilian name for the warrant check.');}
  const note=/^(?:add|save|record|log|write)(?: (?:a|the|this|my))? (?:note|update)(?:(?: (?:to|on|for))? (?:my |the |that |this )?(?:call|incident)(?:\s+[1-9]\d{0,17})?)?(?:\s+(?:that|saying|says|of))?\s*[:,-]?\s+(.{2,800})$/i.exec(original);
  if(note){const found=targetCall(original,context,{assigned:true});return found.id?plan([step('add_note',{id:found.id,query:clean(note[1])})]):clarify(found.question);}
  const contactForCall=/^(?:contact|message|text|notify|tell|advise|ask)(?: (?:the|my))? caller (?:on|for) (?:(?:my|the|that|this) )?(?:call|incident)(?:\s+([1-9]\d{0,17}))?(?:\s+(?:and )?(?:tell|say|message|advise|ask)(?: them)?)?\s*[:,-]?\s+(.{2,800})$/i.exec(original);
  const contactDirect=!contactForCall&&/^(?:contact|message|text|notify|tell|advise|ask)(?: (?:the|my))? caller(?:\s+(?:and )?(?:tell|say|message|advise|ask)(?: them)?)?\s*[:,-]?\s+(.{2,800})$/i.exec(original);
  if(contactForCall||contactDirect){const q=clean(contactForCall?contactForCall[2]:contactDirect[1]),found=contactForCall?(contactForCall[1]?{id:contactForCall[1]}:targetCall(original,context,{assigned:false})):ownCall(context);return found.id?plan([step('caller_contact',{id:found.id,query:q})],true):clarify(found.question);}
  if(/^(?:(?:dispatch|assign|send) )?(?:the )?(?:best|closest|nearest) (?:unit|available unit)(?:\s+to)?/.test(s)){
   const found=targetCall(s,context,{assigned:false});return found.id?plan([step('dispatch_best',{id:found.id})],true):clarify(found.question);
  }
  if(/^(?:auto|automatically) (?:select|request|assess|add) (?:the )?(?:services|resources)(?:\s+for)?/.test(s)){
   const found=targetCall(s,context,{assigned:false});return found.id?plan([step('auto_services',{id:found.id})],true):clarify(found.question);
  }
  const stripped=s.replace(/^(?:i(?:'m| am)|we(?:'re| are)|show me(?: as)?|mark me(?: as)?|set my status(?: to| as)?|put me(?: down)?(?: as)?|make me|switch me(?: to)?|i am now|i'm now)\s+/,'').replace(/^now\s+/,'');
  const statusWords={available:['10-8','available','in service','back in service','back available','ready for calls','ready for another call','back on patrol'],unavailable:['10-7','unavailable','out of service','not available'],busy:['10-6','10-19','10-94','busy','tied up','return to station','returning to station','meal break','rest break','taking a meal break','taking a rest break'],en_route:['10-97','en route','enroute','responding','on my way','heading there','rolling'],on_scene:['10-23','on scene','onscene','at scene','at the scene','arrived'],transporting:['transporting','in transport']};
  for(const [status,phrases] of Object.entries(statusWords))if(phrases.includes(stripped))return plan([step('set_status',{status})]);
  if(/^(?:code 4|all clear|scene secure)$/.test(s))return clarify('Do you want to clear only your unit, close the incident for everyone, or just report that the scene is secure?');
  const record=/^(?:run|check|look up|lookup|verify|can i get)(?: (?:a|the))? (?:plate|tag|registration)(?: (?:check|number))?(?: (?:for|on|of))? (.+)$/i.exec(original)||/^(?:10[- ]28|ten (?:twenty[- ]eight|two eight))(?:\s+(?:on|plate|tag))?\s+(.+)$/i.exec(original);
  if(record){const q=plateQuery(record[1]);return q?plan([step('run_plate',{query:q})]):clarify('Please repeat the exact plate, using letters or phonetic spelling and digits.');}
  const name=/^(?:run|check|look up|lookup|verify)(?: (?:the|a))? (?:name|person|driver)(?: (?:for|on|of))? (.+)$/i.exec(original)||/^(?:10[- ](?:27|29)|ten (?:twenty[- ](?:seven|nine)))(?:\s+(?:on|name))?\s+(.+)$/i.exec(original);
  if(name){const q=clean(name[1]);return q.length>=2&&q.length<=100&&/^[\p{L}0-9 '\u2019.,-]+$/u.test(q)?plan([step('run_name',{query:q})]):clarify('Please give the exact civilian name to check.');}
  const loc=/^(?:(?:set|update|change|mark) my (?:location|position|postal(?: code)?|10[- ]20)(?: to| as)?|my (?:location|position|postal(?: code)?|10[- ]20|ten twenty) is|i(?:'m| am) (?:located )?(?:at|on)|show me (?:at|on))\s+(.+)$/i.exec(original)||/^(?:10[- ]20|ten twenty)(?: (?:at|on|is))?\s+(.+)$/i.exec(original);
  if(/^(?:set|update|change) my (?:location|position|postal(?: code)?)$/i.test(original.replace(/[?!.]+$/,'')))return clarify('What road or recorded postal should I use?');
  if(loc){const isPostal=/\bpostal(?: code)?\b/i.test(original.split(loc[1])[0]);let value=loc[1].replace(/[?!.]+$/,'');if(isPostal&&!/\bpostal\b/i.test(value)){const number=wordsNumber(value);if(number!==null)value='postal '+number;}const q=locationQuery(value);return q?plan([step('set_location',{query:q})]):clarify('Give a road name or a recorded postal.');}

  let action=null,callText=s;
  if(/^(?:attach|assign)(?: me| my unit)?\b|^add (?:me|my unit)\b|^put me on\b|^send me to\b/.test(s))action='attach';
  else if(/^(?:detach|remove|clear) (?:me|my unit)(?:\s+only)?\s+(?:from|off)\b|^take me off\b/.test(s))action='detach';
  else if(/^(?:close|resolve|end|clear) (?:the |my |that |this )?(?:call|incident|assignment)\b/.test(s))action='close_call';
  else if(/^(?:continue|advance|check(?: on)?) (?:my |the )?(?:caller )?trace\b/.test(s))action='trace_advance';
  else if(/^(?:start |begin |initiate )?(?:a |the |my )?(?:caller )?trace\b|^trace (?:the |my )?caller\b/.test(s))action='trace';
  else if(/^(?:call|incident)\s+|^(?:(?:read|give|tell|show|get|pull)(?: me)? (?:the |my )?(?:details|information|brief|call)|tell me about)/.test(s))action='call';
  if(action){
   if(['trace','trace_advance'].includes(action)&&/\b(?:phone|ip|address|person|someone|his|her)\b/.test(s))return reply('Only an authorized fictional caller trace on your assigned incident is supported.');
   const found=resolveCall(callText,context,{assigned:['close_call','trace','trace_advance','detach'].includes(action)});
   return found.id?plan([step(action,{id:found.id})],action==='close_call'):clarify(found.question);
  }
  const knownCode=/^(10-\d{1,2})(?:[ ,:;-]+(.+))?$/.exec(s);
  if(knownCode&&index.has(knownCode[1])){
   const entry=index.get(knownCode[1]);
   if(/reserved|retired/i.test(entry.meaning)||['10-41','10-42','10-90','10-93'].includes(knownCode[1]))return reply(codeReply(knownCode[1])+' No CAD action was taken.');
   if(['10-27','10-28','10-29','10-54'].includes(knownCode[1]))return clarify(codeReply(knownCode[1])+' Give the exact name, plate or document to check.');
   const found=ownCall(context);if(!found.id)return clarify(codeReply(knownCode[1])+' '+found.question);
   return plan([step('unit_update',{id:found.id,query:(entry.meaning+(knownCode[2]?'. '+clean(knownCode[2]):'')).slice(0,500)})]);
  }
  // Definitions are usable for all 196 entries; reserved/duty/unsupported operations never become arbitrary writes.
  if(index.has(s)||/^signal (41|42)$/.test(s))return reply(codeReply(s)+' No CAD action was taken.');
  return null;
 }
 function local(text,context={}){
  const s=clean(text);if(!s||s.length>700)fail('Transcript must contain 1 to 700 characters');
  const emergency=emergencyAction(s);if(emergency)return plan([step(emergency)]);
  let body=s.replace(/^(?:hey |okay |ok )?(?:dispatch|central)[\s,:;.!-]+/i,'').replace(/[?!.]+$/,'');
  // A speaker may identify their own unit before the request without naming a different actor.
  const own=clean(context.unit?.callsign).replace(/[^a-z0-9]/gi,'').toLowerCase();
  const spoken=/^(?:unit )?([a-z]{1,5})[- ]?(\d{1,4})[ ,:;-]+(.+)$/i.exec(body);
  if(spoken&&own&&((spoken[1]+spoken[2]).toLowerCase()===own))body=spoken[3];
  const operational=/^(?:(?:show|mark|put|log) (?:me|my unit)(?: (?:as|on|at))?(?: an?)?|i(?:'m| am)(?: on)?(?: an?)?)\s+(10[- .]\d{1,2}|ten[ -]+(?:[a-z -]+?))(?=$|[,;]|\s+(?:at|on|postal|near)\b)(.*)$/i.exec(body);
  if(operational)body=operational[1]+operational[2];
  const normalizedEmergency=emergencyAction(body);if(normalizedEmergency)return plan([step(normalizedEmergency)]);
  const definition=reference(body);if(definition)return definition;
  if(/^(?:(?:dispatch|broadcast|rebroadcast|send) )?(?:call|incident) [1-9]\d{0,17}.*caller notes$/i.test(body))return one(body,context);
  const clauses=body.split(/\s*(?:;|\band then\b|\bthen\b|,(?=\s*(?:mark me|show me|set my|put me|attach me|assign me|detach me|remove me|read (?:the|my)|give me|tell me|run (?:name|plate)|check (?:name|plate)|update my|close (?:call|the call|my call)|resolve (?:call|the call|my call)|trace (?:the|my)|(?:request|send|need) (?:backup|supervisor|emergency traffic|secondary channel|ems|fire|tow|coroner|traffic|scene|transport|investigator)|add (?:a )?note|contact (?:the )?caller|10-|ten\s))|\band(?=\s+(?:please\s+)?(?:mark|show|set|put|attach|assign|detach|remove|read|give|tell|run|check|update|close|resolve|trace|request|send|need|add|contact|10-|ten\s)))\s*/i).map(s=>s.replace(/^[, ]+|[, ]+$/g,'').trim()).filter(Boolean);
  if(clauses.length>4)return clarify('Please split that into requests of no more than four CAD actions.');
  if(clauses.length===1)return one(body,context);
  if(hypothetical(body)||reported(body)||/\b(?:do not|don't|never|not yet|without changing)\b/i.test(body))return reply('I have not changed CAD. Please separate the actions you want from questions or instructions not to act.');
  const steps=[];let confirmation=false;const projected={...context,assigned_calls:[...activeCalls(context,true)]};
  for(const clause of clauses){const part=one(clause,projected);if(!part)return null;if(part.action==='clarify')return part;if(part.action!=='plan')return clarify('Please separate the requested CAD actions from the other radio message.');steps.push(...part.steps);confirmation ||=part.confirmation;for(const s of part.steps){if(s.action==='attach'){const call=activeCalls(context).find(c=>String(c.id)===s.id);if(call&&!projected.assigned_calls.some(c=>String(c.id)===s.id))projected.assigned_calls.push(call);}if(s.action==='detach')projected.assigned_calls=projected.assigned_calls.filter(c=>String(c.id)!==s.id);}}
  try{return validatePlan(plan(steps,confirmation));}catch{return clarify('Those actions conflict or need separate review. Please give one clear request.');}
 }

function semanticActionMatch(action,source,status=null){
 const s=normalizeCodes(source);
 const patterns={
  request_backup:/\b(?:backup|back up|another (?:car|unit)|additional units?|extra units?|more units?|cover (?:me|us))\b/,
  request_supervisor:/\b(?:supervisor|boss|sergeant|sarge|lieutenant|watch commander|shift supervisor)\b/,
  request_fire:/\b(?:fire(?: department| crew|fighters?)?|engine company|fire engine|fire truck)\b/,
  request_ems:/\b(?:ems|ambulance|medics?|paramedics?|medical (?:help|assistance|response))\b/,
  request_tow:/\b(?:tow(?: truck)?|wrecker|hook|recovery truck)\b/,
  request_coroner:/\b(?:coroner|medical examiner|morgue)\b/,
  request_traffic_control:/\b(?:traffic control|control traffic|handle traffic|traffic detail|block traffic)\b/,
  request_scene_security:/\b(?:scene security|secure (?:the |this )?scene|lock (?:the |this )?scene down|perimeter)\b/,
  request_transport:/\b(?:transport(?: unit)?|prisoner (?:ride|transport|wagon)|paddy wagon)\b/,
  request_investigate:/\b(?:investigator|detective|investigations?)\b/,
  request_emergency_traffic:/\b(?:emergency traffic|hold (?:the )?(?:air|channel)|clear (?:the )?(?:air|channel))\b/,
  request_secondary_channel:/\b(?:secondary channel|another channel|tac(?:tical)? channel|switch channels?|move .* channel)\b/,
  dispatch_best:/\b(?:(?:best|closest|nearest).*(?:unit|car)|(?:unit|car).*(?:best|closest|nearest))\b/,
  auto_services:/\b(?:(?:auto|automatic|automatically).*(?:service|resource|response)|assess .*services?)\b/,
  go_off_duty:/\b(?:off duty|end (?:my )?(?:shift|tour)|clock me out|10-42)\b/,
  clear_duress:/\b(?:clear|cancel|stop|deactivate|disable).*(?:duress|panic|emergency|10-99)\b/,
  caller_card:/\b(?:caller (?:card|info|information|details)|10-88)\b/,
  caller_contact:/\b(?:contact|message|text|notify).*(?:caller)\b/,
  close_call:/\b(?:(?:close|resolve|complete|finalize|end).*(?:call|incident)|clear (?:the |my )?call)\b/,
  trace:/\b(?:trace.*(?:caller|call)|find .*anonymous caller)\b/,
  trace_advance:/\b(?:(?:continue|advance|next).*(?:trace)|trace.*(?:continue|advance|next))\b/,
  add_note:/\b(?:(?:add|write|save|record|log).*(?:note|update)|note.*(?:call|incident))\b/,
  set_response_plan:/\b(?:response plan|primary response|code [1-4]|fire response|ems response|traffic control|scene security)\b/,
  update_service:/\b(?:le|fire|ems|police|law enforcement|medics?|ambulance).*(?:requested|assigned|en route|responding|on scene|cleared)\b/,
  broadcast_call:/\b(?:broadcast|rebroadcast|send .*call|put .*call.*over|any available units|attached units|supervisors).*(?:call|incident|traffic|units|notes)?\b/,
  create_call:/\b(?:create|open|start|enter|generate).*(?:call|incident)\b/,
  dispatch_update:/\b(?:current information|updated information|dispatch update|update (?:the )?(?:call|incident))\b/,
  caller_update:/\b(?:caller (?:just )?(?:advised|reports?|said|updated)|caller update)\b/,
  cancel_resource:/\b(?:cancel|withdraw|disregard|clear).*(?:backup|supervisor|fire|ems|tow|wrecker|coroner|traffic|scene|transport|investigator|emergency traffic|secondary channel)\b/
 };
 if(action==='set_status'){
  const byStatus={available:/\b(?:available|clear|back in service|free|10-8)\b/,busy:/\b(?:busy|tied up|occupied|meal|break|10-6|10-94|return(?:ing)? to (?:station|quarters)|10-19)\b/,unavailable:/\b(?:unavailable|out of service|not available|10-7)\b/,en_route:/\b(?:en route|responding|rolling|on my way|heading (?:there|that way)|10-97)\b/,on_scene:/\b(?:on scene|arrived|rolled up|i(?:'m| am) here|10-23)\b/,transporting:/\b(?:transporting|en route with|heading to (?:jail|hospital)|taking (?:a|the) (?:prisoner|patient))\b/};
  return !!byStatus[status]?.test(s);
 }
 if(action==='assign_unit'||action==='detach_unit')return /\b(?:assign|attach|send|put|have|give|move|detach|remove|clear)\b.*\b(?:call|incident|wreck|crash|scene|handle|cover|take)\b/.test(s);
 if(action==='update_service')return patterns.update_service.test(s)||/\b(?:mark|set|update|clear)\b.*\b(?:le|fire|ems)\b/.test(s);
 if(action==='set_response_plan')return patterns.set_response_plan.test(s)&&/\bcode [1-4]\b/.test(s);
 if(action==='unit_update')return true; // query grounding below carries the actual reported information.
 if(action==='caller_thread'||action==='call_resources'||action==='response_plan')return true;
 if(action==='run_name'||action==='run_plate'||action==='run_dl'||action==='run_vin'||action==='run_person_record'||action==='set_location'||action==='call'||action==='location'||action==='status'||action==='calls'||action==='units'||action==='attach'||action==='detach'||action==='duress'||action==='officer_down')return true;
 const re=patterns[action];return re?re.test(s):true;
}
 function validateModel(value,{text,context,history=[]}={}){
  const p=validatePlan(value),source=normalizeCodes(text);
  const otherAssignmentIntent=p.steps.some(s=>['assign_unit','detach_unit'].includes(s.action))&&/\b(?:assign|attach|send|put|have|give|move|detach|remove|clear)\b.*\b(?:call|incident|wreck|crash|scene|handle|cover|take)\b/.test(source);
  if(p.steps.some(s=>WRITES.has(s.action))&&(hypothetical(source)||reported(source)||/["\u201c\u201d]/.test(source)||(hasOtherTarget(source)&&!otherAssignmentIntent)||/^(?:dispatch[, ]+|central[, ]+)?(?:am i|are we|is my|did i|have i|was i)\b/.test(source)||/\b(?:don't|do not|never|not yet|without changing)\b/.test(source)))return reply('I have not changed CAD. Please state the action you want for your own unit or an explicit dispatcher assignment.');
  for(const s of p.steps){
   if(['duress','officer_down'].includes(s.action)&&!emergencySignal(text))return clarify('Please state an explicit own-unit emergency request.');
   if(!semanticActionMatch(s.action,source,s.status))fail('Model action does not match the spoken request');
   if(s.action==='patrol_activity'&&!local(text,context)?.steps?.some(x=>x.action==='patrol_activity'&&x.query===s.query))fail('Patrol activity needs an explicit grounded request');
   if(s.id&&!activeCalls(context).some(c=>String(c.id)===s.id)&&callId(text)!==s.id)fail('Model invented a call ID');
   if(s.query){
    const original=clean(text).toLowerCase(),query=s.query.toLowerCase();
    const normalizedOriginal=normalizeCodes(original);
    const visible=(s.action==='patrol_activity'&&local(text,context)?.steps?.some(x=>x.action==='patrol_activity'&&x.query===s.query))||original.includes(query)||normalizedOriginal.includes(query)||
     (s.action==='run_plate'&&original.split(/\b(?:plate|tag|10-28|ten twenty eight|ten twenty-eight)\b/i).some(x=>plateQuery(x.trim())===s.query))||
     (s.action==='run_vin'&&original.replace(/[^a-z0-9]/g,'').includes(query.replace(/[^a-z0-9]/g,'')))||
     (s.action==='run_dl'&&original.replace(/[^a-z0-9]/g,'').includes(query.replace(/[^a-z0-9]/g,'')))||
     (['assign_unit','detach_unit'].includes(s.action)&&original.replace(/[^a-z0-9]/g,'').includes(query.replace(/[^a-z0-9]/g,'')))||
     (s.action==='cancel_resource'&&query.split(' ').every(part=>normalizedOriginal.includes(part)))||
     (['dispatch_update','caller_update'].includes(s.action)&&original.includes(query.toLowerCase()))||
     (s.action==='broadcast_call'&&query.split('; ').every(part=>part.startsWith('notes ')?normalizedOriginal.includes(part.endsWith('on')?'include':'caller notes')||normalizedOriginal.includes(part.endsWith('on')?'with caller notes':'without caller notes')||normalizedOriginal.includes(part.endsWith('off')?'exclude':'include'):part==='any available'?/any|all available/.test(normalizedOriginal):normalizedOriginal.includes(part)))||
     (s.action==='create_call'&&query.split(' | ').every(part=>original.includes(part.toLowerCase())))||
     (s.action==='unit_update'&&(original.includes(query.toLowerCase())||[...index.values()].some(e=>query.toLowerCase().startsWith(e.meaning.toLowerCase())&&normalizedOriginal.startsWith(normalizeCodes(e.code)))))||
     (s.action==='set_response_plan'&&query.split('; ').every(part=>normalizedOriginal.includes(part.toLowerCase())))||
     (s.action==='update_service'&&query.split(' ').filter(Boolean).every(part=>normalizedOriginal.includes(part.toLowerCase().replace('_',' '))))||
     locationQuery(original)?.toLowerCase().includes(query);
    const prior=history.some(h=>h.role==='user'&&(clean(h.content).toLowerCase().includes(query)||(s.action==='run_plate'&&clean(h.content).split(/\b(?:plate|tag|10-28|ten twenty eight|ten twenty-eight)\b/i).some(x=>plateQuery(x.trim())===s.query))));
    if(!visible&&!(prior&&/\b(?:same|again|that|previous|last)\b/.test(source)))fail('Model invented a record, note or location query');
   }
  }
  if(p.action==='reply'&&/^(?:done|completed|updated|saved|activated|dispatched)\b|\b(?:i have|i've|successfully|has been|have been|is now)\s+(?:changed|updated|saved|attached|assigned|dispatched|detached|activated|closed|traced|marked|sent|recorded|logged)|\b(?:sending|dispatching) (?:backup|units|ems|fire|a supervisor)|\b(?:your unit|you) (?:are|is) now /i.test(p.reply))return reply('I have not changed CAD. Please state the action you want for your own unit.');
  // Unknown wording is understood by the model, but its proposed mutations get a plain-language review.
  return {...p,source:'model',confirmation:p.steps.some(s=>WRITES.has(s.action)&&s.action!=='duress')||p.confirmation};
 }
 return {entries,index,local,one,reference,codeReply,validateModel};
}
module.exports={STATUS,TOOLS,WRITES,RESOURCE_TOOLS,clean,wordsNumber,normalizeCodes,plateQuery,locationQuery,referenceIndex,emergencySignal,emergencyAction,callId,resolveCall,activeCalls,validateStep,validatePlan,canonicalCommand,createLanguage,reply,clarify,plan,step};
