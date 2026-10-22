import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVoiceCommand} from '../src/voice-policy.js';
test('Central and Dispatch address the same guarded command parser',()=>{
 assert.deepEqual(parseVoiceCommand('Central, radio check'),{action:'radio_check'});
 assert.deepEqual(parseVoiceCommand('Central what is my status?'),{action:'status'});
 assert.deepEqual(parseVoiceCommand('Dispatch, radio check','central'),{action:'radio_check'});
 assert.deepEqual(parseVoiceCommand('Central, ten eight'),{action:'set_status',status:'available'});
 for(const speech of ['centralized radio check','dispatchment radio check','radio check'])assert.equal(parseVoiceCommand(speech),null);
 assert.equal(parseVoiceCommand('Central, radio check',''),null);
});
