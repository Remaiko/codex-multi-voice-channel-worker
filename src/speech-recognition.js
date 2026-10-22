/** Credentials stay inside the worker. Only explicitly opted-in speakers reach this API. */
export function recognitionConfig(env){
 const wanted=env.VOICE_STT_PROVIDER||'auto';
 const provider=wanted==='auto'?(env.OPENAI_API_KEY?'openai':env.ELEVENLABS_API_KEY?'elevenlabs':'none'):wanted;
 if(provider==='openai'&&env.OPENAI_API_KEY)return{provider,apiKey:env.OPENAI_API_KEY,model:env.VOICE_STT_MODEL||'gpt-4o-mini-transcribe'};
 if(provider==='elevenlabs'&&env.ELEVENLABS_API_KEY)return{provider,apiKey:env.ELEVENLABS_API_KEY,model:env.ELEVENLABS_STT_MODEL||'scribe_v2'};
 return{provider:'none',apiKey:null};
}
export async function transcribeAudio({audio,config,fetchImpl=fetch}){
 if(!(config?.apiKey||config?.token)||!['openai','elevenlabs'].includes(config.provider))throw Error('Speech recognition credentials are not configured.');
 if(!audio||audio.length<64||audio.length>4*1024*1024)throw Error('Invalid speech recognition audio size.');
 const body=new FormData();body.set(config.provider==='elevenlabs'?'model_id':'model',config.model);body.set('file',new Blob([audio],{type:'audio/wav'}),'radio.wav');
 const eleven=config.provider==='elevenlabs';if(eleven){body.set('diarize','false');body.set('tag_audio_events','false');}
 if(eleven)body.set('language_code','en');
 const url=eleven?'https://api.elevenlabs.io/v1/speech-to-text'+(config.token?'?token='+encodeURIComponent(config.token):''):'https://api.openai.com/v1/audio/transcriptions';
 const r=await fetchImpl(url,{method:'POST',headers:eleven?(config.token?{}:{'xi-api-key':config.apiKey}):{Authorization:'Bearer '+config.apiKey},body,signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('Speech recognition provider rejected the request ('+r.status+').');
 const data=await r.json();return String(data.text||'').slice(0,500).trim();
}
