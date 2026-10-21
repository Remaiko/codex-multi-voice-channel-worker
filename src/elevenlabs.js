const MAX_AUDIO_BYTES=2*1024*1024;

export async function synthesizeElevenLabs({text,apiKey,voiceId,modelId='eleven_multilingual_v2',fetchImpl=fetch}){
 if(typeof apiKey!=='string'||!apiKey.trim())throw Error('ElevenLabs API key is not configured.');
 if(typeof voiceId!=='string'||!voiceId.trim())throw Error('ElevenLabs voice ID is not configured.');
 const response=await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,{
  method:'POST',
  headers:{'xi-api-key':apiKey,'Content-Type':'application/json','Accept':'audio/mpeg'},
  body:JSON.stringify({text:String(text).slice(0,850),model_id:modelId,voice_settings:{stability:0.5,similarity_boost:0.75,style:0,speaker_boost:true}}),
  signal:AbortSignal.timeout(20000)
 });
 if(!response.ok)throw Error(`ElevenLabs returned HTTP ${response.status}.`);
 const audio=Buffer.from(await response.arrayBuffer());
 if(audio.length===0||audio.length>MAX_AUDIO_BYTES)throw Error('ElevenLabs returned empty or oversized audio.');
 return audio;
}
