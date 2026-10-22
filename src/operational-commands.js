import {normalizeRadioCodes} from './radio-reference.js';
// Only imperative self-duress and incident-bound caller investigations become tools.
export function operationalCommand(input){
 const s=normalizeRadioCodes(String(input).toLowerCase().trim().replace(/[.!?]+$/,'')).replace(/^please\s+/,'');
 if(/^(?:10-99|(?:activate|enable|trigger|start)(?: my)? (?:duress|10-99)(?: alert)?)$/.test(s))return {action:'duress'};
 const id=/(?:call|incident)(?: number)?\s*#?\s*(\d{1,18})\b/.exec(s)?.[1]||null;
 if(/^(?:continue|advance|check|give me|what(?:'s| is))\b/.test(s)&&/\btrace(?: status| progress)?\b/.test(s)&&!/\b(?:name|person|phone|ip address)\b/.test(s))return {action:'trace_advance',id};
 if(/^(?:start|begin|run|initiate|trace)\b/.test(s)&&/\btrace\b/.test(s)&&/\b(?:caller|call|911|incident)\b/.test(s))return {action:'trace',id};
 if(/\b(?:details|information|info|brief|briefing|read out|tell me about)\b/.test(s)&&/\b(?:call|incident|assignment)\b/.test(s)&&!/\b(?:delete|cancel|close|change)\b/.test(s))return {action:'call',id};
 return null;
}
export function operationalIntentAllowed(intent,text){
 if(intent.action==='duress')return operationalCommand(String(text).replace(/^(?:dispatch|central)[,.:;!?\s]+/i,''))?.action==='duress';
 if(['trace','trace_advance'].includes(intent.action))return operationalCommand(String(text).replace(/^(?:dispatch|central)[,.:;!?\s]+/i,''))?.action===intent.action;
 return true;
}
export function voiceCommandText(cmd){
 if(['duress','trace','trace_advance'].includes(cmd.action))return cmd.action+(cmd.id?' call '+cmd.id:'');
 if(cmd.action==='call')return cmd.id?'call '+cmd.id:'my call details';
 if(cmd.action==='set_status')return 'set status '+cmd.status;
 if(['attach','detach'].includes(cmd.action))return cmd.action+' call '+cmd.id;
 return cmd.action==='units'?'available units':cmd.action==='calls'?'active calls':'my status';
}