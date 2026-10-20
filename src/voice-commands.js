// Isolated, side-effect-free parser for Discord radio commands.
export function parseRadioCommand(transcript, wakePhrase = 'dispatch') {
  const spoken = String(transcript ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const wake = String(wakePhrase ?? 'dispatch').toLowerCase().trim();
  if (!wake || !(spoken.startsWith(wake + ' ') || spoken.startsWith(wake + ',') || spoken.startsWith(wake + ':'))) return null;
  const command = spoken.slice(wake.length).replace(/^[,\s:]+/, '').trim();
  if (!command) return null;
  if (/^(radio check|check in|are you there|respond|hello)\b/.test(command)) return {type: 'radio_check'};
  if (/^(repeat|say again|repeat last call|repeat transmission)\b/.test(command)) return {type: 'repeat'};
  if (/^(available units|who is available|units available|unit status)\b/.test(command)) return {type: 'available_units'};
  if (/^(active calls|pending calls|open calls|call queue)\b/.test(command)) return {type: 'active_calls'};
  if (/^(call details|incident details|call information)\b/.test(command)) {
    const number = /(?:number|#)?\s*(\d{1,12})\b/.exec(command);
    return number ? {type: 'call_details', callId: number[1]} : {type: 'need_call_number'};
  }
  return {type: 'unrecognized'};
}

export function validRoute(route) {
 return !!route && /^\d{15,22}$/.test(String(route.guild_id || ''))
  && /^\d{15,22}$/.test(String(route.voice_channel_id || ''))
  && /^[A-Z0-9_-]{1,20}$/.test(String(route.agency_code || ''));
}
export function idsOf(route, key) {
 const items = Array.isArray(route?.[key]) ? route[key] : [];
 return new Set(items.filter(x => /^\d{15,22}$/.test(String(x))).map(String));
}
