import test from 'node:test';
import assert from 'node:assert/strict';
import {discordId,allowedSpeakers,allowedListeners,voiceCommand} from '../src/voice-utils.js';
test('voice input requires a server opt-in and a worker opt-in',()=>{
 const route={voice_listen_enabled:false,authorized_user_ids:['910947550650060801']};
 assert.deepEqual([...allowedSpeakers(route,true)],[]);
 route.voice_listen_enabled=true;
 assert.deepEqual([...allowedSpeakers(route,false)],[]);
 assert.deepEqual([...allowedSpeakers(route,true)],['910947550650060801']);
});
test('malformed speaker identifiers cannot become authorized',()=>{
 assert.equal(discordId('not-an-id'),false);
 assert.deepEqual([...allowedSpeakers({voice_listen_enabled:true,authorized_user_ids:['bogus','910947550650060801']},true)],['910947550650060801']);
});
test('listeners are separately authorized and are not inferred from transcribable speakers',()=>{
 const route={voice_listen_enabled:true,authorized_user_ids:['910947550650060801'],authorized_listener_ids:['910947550650060802']};
 assert.deepEqual([...allowedListeners(route)],['910947550650060802']);
 assert.deepEqual([...allowedSpeakers(route,true)],['910947550650060801']);
});
test('wake phrase filters unrelated channel speech',()=>{
 assert.equal(voiceCommand('The dispatcher is waiting'),null);
 assert.deepEqual(voiceCommand('Dispatch, radio check'),{kind:'radio-check'});
 assert.deepEqual(voiceCommand('DISPATCH say again please'),{kind:'repeat'});
 assert.deepEqual(voiceCommand('Dispatch, show me 10-8'),{kind:'broker',transcript:'Dispatch, show me 10-8'});
});
