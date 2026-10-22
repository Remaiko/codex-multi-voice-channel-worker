/** Explicitly consented, currently authorized voice policy; default deny. */
import {normalizeRadioCodes,codeCommand} from './radio-reference.js';
const snowflake = /^\d{15,22}$/;
const toIds = value => new Set(Array.isArray(value) ? value.filter(id => snowflake.test(String(id))).map(String) : []);
export function voicePolicy(route, guildId) {
  const input = route?.voice_listen_enabled === true;
  const speakers = input ? toIds(route?.authorized_user_ids) : new Set();
  const listeners = toIds(route?.authorized_listener_ids);
  return {guildId: String(guildId), input, speakers, listeners};
}
export function canListen(policy, userId) {return policy.input && policy.speakers.has(String(userId));}
export function canBroadcast(policy, presentUserIds) {
  if (!Array.isArray(presentUserIds) || presentUserIds.length === 0) return false;
  return presentUserIds.every(id => policy.listeners.has(String(id)));
}
export function parseVoiceCommand(transcript, wake = 'dispatch') {
  if (typeof transcript !== 'string') return null;
  const text = transcript.trim().replace(/\s+/g, ' ');
  const configured = String(wake).trim().toLowerCase();
  if (!configured) return null;
  const phrase = [configured, 'dispatch', 'central'].find(word => text.toLowerCase().startsWith(word) && /^[,.:;!?\s]/.test(text.slice(word.length)));
  if (!phrase) return null;
  const suffix = text.slice(phrase.length);
  if (!/^[,.:;!?\s]/.test(suffix)) return null;
  let command = suffix.replace(/^[,.:;!?\s]+/, '').trim().toLowerCase().replace(/[’‘]/g,"'").replace(/[.!?]+$/,'');
  command=command.replace(/^please\s+/,'').replace(/^(?:can you|could you|would you)\s+/,'').replace(/^please\s+/,'').replace(/\s+please$/,'');
  command=normalizeRadioCodes(command);
  const referenceCommand=codeCommand(command);if(referenceCommand)return referenceCommand;
  if (/^(?:10[- ]?4|copy|copied|acknowledged|understood)$/.test(command)) return {action:'acknowledge'};
  if (/^(?:10[- ]?9|repeat that|repeat the last transmission|what did you say)$/.test(command)) return {action:'repeat'};
  const status=/^(?:show me|mark me|set my status(?: to)?|i am|i'm)\s+(available|busy|en[ -]route|on[ -]scene|transporting|unavailable)$/.exec(command);
  if(status)return {action:'set_status',status:status[1].replace(/[ -]/g,'_')};
  const assignment=/^(attach|assign|detach|clear) me (?:to|from) (?:call|incident)\s+(?:number\s+|#)?(\d{1,18})$/.exec(command);
  if(assignment)return {action:['attach','assign'].includes(assignment[1])?'attach':'detach',id:assignment[2]};
  if (/^(radio check|check in|are you there|respond|hello)\b/.test(command)) return {action:'radio_check'};
  if (/^(repeat|say again|repeat last call|repeat transmission)\b/.test(command)) return {action:'repeat'};
  if (/^(?:status|my status|duty status|unit status|check my status|am i on duty|what(?:'s| is) my status)\b/.test(command)) return {action:'status'};
  if (/^(?:active calls|calls|pending calls|open calls|what calls are (?:active|pending|open)|are there any (?:active |pending |open )?calls|any calls pending|show (?:me )?(?:the )?(?:active |pending |open )?calls)\b/.test(command)) return {action:'calls'};
  if (/^(?:available units|units|on duty units|who(?:'s| is) (?:available|on duty)|which units are (?:available|on duty)|show (?:me )?(?:the )?available units)\b/.test(command)) return {action:'units'};
  const m = /^(?:(?:tell me about|give me (?:the )?details (?:for|on)|details (?:for|on))\s+)?(?:call|incident)\s+(?:number\s+|#)?(\d{1,18})\b/.exec(command);
  if (m) return {action:'call', id:m[1]};
  return command ? {action:'unrecognized'} : null;
}
export function describeVoiceResult(command, data) {
  if (command.action === 'status') {
    if (data?.on_duty === true) return `Dispatch copies. You are on duty. Callsign ${String(data?.callsign||'not set').slice(0,30)}. Status ${String(data?.status||'unknown').slice(0,50)}.`;
    return 'Dispatch copies. You are currently off duty.';
  }
  if (command.action === 'calls') {
    if (!Array.isArray(data)||!data.length) return 'Dispatch advises: no active calls in the queue.';
    return `${data.length} active calls. `+data.slice(0,3).map(c=>`Call ${String(c.id||'').slice(0,18)}, ${String(c.call_type||'incident').slice(0,60)}, priority ${String(c.priority||'unknown').slice(0,6)}.`).join(' ');
  }
  if (command.action === 'units') {
    if (!Array.isArray(data)||!data.length) return 'Dispatch advises: no on duty units are listed.';
    return `${data.length} on duty units. `+data.slice(0,5).map(u=>`${String(u.callsign||'unknown').slice(0,30)}, ${String(u.status||'unknown').slice(0,40)}.`).join(' ');
  }
  if (command.action === 'call') {
    if (!data||!data.id) return 'Dispatch advises: call not found.';
    return `Call ${String(data.id).slice(0,18)}. ${String(data.call_type||'incident').slice(0,80)}. Priority ${String(data.priority||'unknown').slice(0,5)}. Location ${String(data.location||'unknown').slice(0,140)}. Status ${String(data.status||'unknown').slice(0,35)}.`;
  }
  return 'Dispatch received. That command is not available.';
}

