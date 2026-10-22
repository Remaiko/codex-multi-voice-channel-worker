// A per-utterance connection: only explicitly authorized speech enters this stream.
export function stereoToMono(pcm){
 if(!Buffer.isBuffer(pcm)||pcm.length%4)throw Error('Invalid Discord PCM frame');
 const mono=Buffer.alloc(pcm.length/2);
 for(let source=0,target=0;source<pcm.length;source+=4,target+=2)mono.writeInt16LE(Math.round((pcm.readInt16LE(source)+pcm.readInt16LE(source+2))/2),target);
 return mono;
}
export function createRealtimeInput({tokenPromise,WebSocketImpl=WebSocket,timeoutMs=18000,commitTimeoutMs=7000}){
 let socket,started=false,finished=false,settled=false,size=0,buffer=[],timer;
 let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no;});result.catch(()=>{});
 const end=(error,text)=>{if(settled)return;settled=true;clearTimeout(timer);buffer=[];try{socket?.close();}catch{}error?reject(error):resolve(text);};
 const deadline=ms=>{clearTimeout(timer);timer=setTimeout(()=>end(Error('Realtime recognition timed out')),ms);timer.unref?.();};
 const send=(audio,commit=false)=>socket.send(JSON.stringify({message_type:'input_audio_chunk',audio_base_64:audio.toString('base64'),sample_rate:48000,...(commit?{commit:true}:{})}));
 const flush=()=>{if(!started||settled)return;for(const part of buffer)send(part);buffer=[];if(finished)send(Buffer.alloc(9600),true);};
 deadline(timeoutMs);
 Promise.resolve(tokenPromise).then(token=>{
  if(settled)return;if(typeof token!=='string'||token.length<10)throw Error('Invalid realtime speech session');
  const params=new URLSearchParams({token,model_id:'scribe_v2_realtime',audio_format:'pcm_48000',language_code:'en',commit_strategy:'manual'});
  socket=new WebSocketImpl('wss://api.elevenlabs.io/v1/speech-to-text/realtime?'+params);
  socket.addEventListener('message',event=>{try{const message=JSON.parse(String(event.data));if(message.message_type==='session_started'){started=true;flush();}else if(message.message_type==='committed_transcript')end(null,String(message.text||'').slice(0,500).trim());else if(message.error||/error|rate_limited|quota_exceeded/.test(message.message_type||''))end(Error('Realtime speech provider rejected input'));}catch{end(Error('Invalid realtime speech response'));}});
  socket.addEventListener('error',()=>end(Error('Realtime speech connection failed')));
  socket.addEventListener('close',()=>{if(!settled)end(Error('Realtime speech connection closed before transcript'));});
 }).catch(error=>end(error));
 return {
  write(pcm){if(settled||finished)return;size+=pcm.length;if(size>48000*2*12){end(Error('Radio utterance exceeds twelve seconds'));return;}if(started)send(pcm);else buffer.push(Buffer.from(pcm));},
  finish(){if(settled)return result;if(!finished){finished=true;deadline(commitTimeoutMs);flush();}return result;},
  cancel(){end(Error('Radio utterance cancelled'));}
 };
}
