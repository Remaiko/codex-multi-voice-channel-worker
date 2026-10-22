// Synthesize bounded, complete phrases before starting one uninterrupted PCM playback.
export function splitRadioText(value,max=230){
 const text=String(value).replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
 if(!text||text.length>1000)throw Error('Invalid radio transmission length.');
 const chunks=[];let rest=text;
 while(rest.length>max){
  const head=rest.slice(0,max+1);let end=-1;
  for(const match of head.matchAll(/[.!?;](?=\s)/g))if(match.index>=max*.4)end=match.index+1;
  if(end<0)end=head.lastIndexOf(' ');
  if(end<=0)throw Error('Radio transmission contains an oversized word.');
  chunks.push(rest.slice(0,end).trim());rest=rest.slice(end).trim();
 }
 if(rest)chunks.push(rest);return chunks;
}
export async function prepareRadioSpeech(text,{speak,decode,gapMs=140}){
 const chunks=splitRadioText(text),audio=[];
 for(const chunk of chunks){const pcm=await decode(await speak(chunk));if(!Buffer.isBuffer(pcm)||pcm.length<4)throw Error('Invalid radio speech segment.');if(audio.length)audio.push(Buffer.alloc(Math.round(48000*4*gapMs/1000)));audio.push(pcm);}
 const pcm=Buffer.concat(audio);if(pcm.length>16*1024*1024)throw Error('Radio transmission exceeds its duration limit.');return pcm;
}