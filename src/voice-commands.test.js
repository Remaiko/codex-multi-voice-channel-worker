import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRadioCommand, validRoute, idsOf} from './voice-commands.js';
test('wake word is mandatory', () => {
 assert.equal(parseRadioCommand('Please radio check'), null);
 assert.deepEqual(parseRadioCommand('Dispatch is busy'), {type:'unrecognized'});
 assert.deepEqual(parseRadioCommand('Dispatch, RADIO CHECK'), {type:'radio_check'});
 assert.deepEqual(parseRadioCommand('dispatch: repeat last transmission'), {type:'repeat'});
});
test('voice read commands use strict parsing', () => {
 assert.deepEqual(parseRadioCommand('Dispatch, available units'), {type:'available_units'});
 assert.deepEqual(parseRadioCommand('Dispatch active calls'), {type:'active_calls'});
 assert.deepEqual(parseRadioCommand('Dispatch, call details number 128'), {type:'call_details',callId:'128'});
 assert.deepEqual(parseRadioCommand('Dispatch, incident details'), {type:'need_call_number'});
 assert.deepEqual(parseRadioCommand('Dispatch, show me 10-8'), {type:'unrecognized'});
});
test('server routes and allowlists reject malformed identifiers', () => {
 assert.equal(validRoute({guild_id:'123456789012345678',voice_channel_id:'123456789012345679',agency_code:'ALL'}),true);
 assert.equal(validRoute({guild_id:'0',voice_channel_id:'123456789012345679',agency_code:'ALL'}),false);
 assert.deepEqual([...idsOf({authorized_listener_ids:['123456789012345678','bad','123456789012345678']},'authorized_listener_ids')],['123456789012345678']);
});
