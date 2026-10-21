import test from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeElevenLabs} from './elevenlabs.js';

test('ElevenLabs synthesis sends the API key privately and returns audio bytes',async()=>{
 let request;
 const audio=await synthesizeElevenLabs({text:'Test dispatch',apiKey:'secret-test-key',voiceId:'voice/id',fetchImpl:async(url,options)=>{request={url,options};return new Response(Buffer.from([1,2,3]),{status:200});}});
 assert.equal(request.url,'https://api.elevenlabs.io/v1/text-to-speech/voice%2Fid?output_format=mp3_44100_128');
 assert.equal(request.options.headers['xi-api-key'],'secret-test-key');
 assert.equal(JSON.parse(request.options.body).text,'Test dispatch');
 assert.deepEqual([...audio],[1,2,3]);
});

test('ElevenLabs synthesis rejects failed provider responses',async()=>{
 await assert.rejects(()=>synthesizeElevenLabs({text:'test',apiKey:'secret',voiceId:'voice',fetchImpl:async()=>new Response('',{status:401})}),/HTTP 401/);
});

test('ElevenLabs synthesis rejects missing configuration',async()=>{
 await assert.rejects(()=>synthesizeElevenLabs({text:'test',apiKey:'',voiceId:'voice'}),/API key/);
 await assert.rejects(()=>synthesizeElevenLabs({text:'test',apiKey:'secret',voiceId:''}),/voice ID/);
});
