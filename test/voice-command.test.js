import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVoiceCommand} from '../src/voice-command.js';
test('ignores ambient speech, partial wake words and empty requests',()=>{
 assert.equal(parseVoiceCommand('Can anyone hear me?'),null);
 assert.equal(parseVoiceCommand('dispatchers who are you'),null);
 assert.equal(parseVoiceCommand('dispatch'),null);
});
test('handles radio check',()=>{
 assert.equal(parseVoiceCommand('Dispatch, radio check').type,'radio-check');
 assert.equal(parseVoiceCommand('dispatch: radio check.').type,'radio-check');
});
test('handles repeat last transmission',()=>{
 assert.equal(parseVoiceCommand('Dispatch, say again').type,'repeat');
});
test('routes read-only voice requests to server authorizer',()=>{
 assert.deepEqual(parseVoiceCommand('Dispatch, active calls'),{type:'cad',command:'active calls'});
 assert.deepEqual(parseVoiceCommand('Dispatch, call 123'),{type:'cad',command:'call 123'});
});
