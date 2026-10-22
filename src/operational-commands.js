import {normalizeRadioCodes} from './radio-reference.js';
// Only imperative self-duress and incident-bound caller investigations become tools.
export function operationalCommand(input){
 let s=normalizeRadioCodes(String(input).toLowerCase().replace(/[’‘]/g,"'").trim().replace(/[.!?]+$/,''));
 for(let i=0;i<3;i++)s=s.replace(/^(?:please|can you|could you|would you|i need you to|i need to|i need|go ahead and)\s+/,'').replace(/\s+(?:for me|right now|now|please|immediately)$/,'').trim();
 if(/^(?:duress|10-99|1099|(?:activate|enable|trigger|start|raise|send|turn on)(?: (?:my|the|a|an))? (?:duress|10-99|1099)(?: (?:alert|signal|alarm))?|(?:i am|i'm|mark me|show me|put me)(?: as| on| in)? 10-99)(?:$|[,;]?\s+(?:at|near|postal|post code|for|now|please|immediately)\b)/.test(s))return {action:'duress'};
 const id=/(?:call|incident)(?: number)?\s*#?\s*(\d{1,18})\b/.exec(s)?.[1]||null;
 if(/^(?:continue|advance|check|give me|what(?:'s| is))\b/.test(s)&&/\btrace(?: status| progress)?\b/.test(s)&&!/\b(?:name|person|phone|ip address)\b/.test(s))return {action:'trace_advance',id};
 if(/^(?:start|begin|run|initiate|trace)\b/.test(s)&&/\btrace\b/.test(s)&&/\b(?:caller|call|911|incident)\b/.test(s))return {action:'trace',id};
 if(/\b(?:details|information|info|brief|briefing|read out|tell me about)\b/.test(s)&&/\b(?:call|incident|assignment)\b/.test(s)&&(id||/\b(?:my|assigned)\b/.test(s))&&!/\b(?:delete|cancel|close|change)\b/.test(s))return {action:'call',id};
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