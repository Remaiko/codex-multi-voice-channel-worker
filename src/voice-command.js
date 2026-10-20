// Pure parser for locally handled radio traffic. Speech may include leading punctuation.
// Sensitive or state-changing commands must always be authorized by CAD, never here.
export function parseVoiceCommand(transcript, wakePhrase = 'dispatch') {
  const text = String(transcript ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const wake = String(wakePhrase ?? 'dispatch').trim().toLowerCase();
  if (!wake || !text.startsWith(wake)) return null;
  const next = text.slice(wake.length);
  if (next && !/^[\s,.:;-]/.test(next)) return null;
  const command = next.replace(/^[\s,.:;-]+/, '').replace(/[.!?]+$/, '').trim();
  if (!command) return null;
  if (/^(radio check|check in|are you there|respond|hello)$/.test(command)) return {type:'radio-check', command};
  if (/^(repeat|say again|repeat last call|repeat transmission)$/.test(command)) return {type:'repeat', command};
  if (command.length > 140) return {type:'unsupported',command:''};
  return {type:'cad',command};
}
