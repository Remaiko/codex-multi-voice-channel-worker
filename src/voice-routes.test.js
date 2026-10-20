import test from 'node:test';
import assert from 'node:assert/strict';
import {flattenVoiceRoutes, voiceRouteKey} from './voice-routes.js';

const guild = '123456789012345678';
const first = '223456789012345678';
const second = '323456789012345678';

test('expands multiple channels into isolated guild/channel routes', () => {
  const routes = flattenVoiceRoutes([{guild_id:guild, agency_code:'SASP', voice_channel_ids:[first,second]}]);
  assert.deepEqual(routes.map(route=>route.voice_channel_id), [first,second]);
  assert.equal(routes[0].agency_code, 'SASP');
});

test('keeps legacy single-channel routes working', () => {
  assert.deepEqual(flattenVoiceRoutes([{guild_id:guild, voice_channel_id:first}]).map(r=>r.voice_channel_id), [first]);
});

test('drops invalid IDs and duplicate channel routes', () => {
  const routes = flattenVoiceRoutes([
    {guild_id:guild, voice_channel_ids:[first,'invalid',first]},
    {guild_id:'invalid', voice_channel_id:second},
  ]);
  assert.equal(routes.length, 1);
  assert.equal(voiceRouteKey(guild, first), `${guild}:${first}`);
});
