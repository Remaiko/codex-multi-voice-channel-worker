import {test} from 'node:test';import assert from 'node:assert/strict';import {voicePresence} from './voice-presence.js';
test('presence contains connected humans only and tolerates missing channels',()=>{
 const channel={members:new Map([['human',{id:'123',user:{bot:false}}],['bot',{id:'456',user:{bot:true}}]])};
 const bots=[{key:'FEDERAL',client:{guilds:{cache:new Map([['guild',{channels:{cache:new Map([['channel',channel]])}}]])}}}];
 const states=new Map([['one',{guildId:'guild',channelId:'channel',botKey:'FEDERAL'}],['missing',{guildId:'other',channelId:'missing',botKey:'FEDERAL'}]]);
 assert.deepEqual(voicePresence(states,bots),[{guild_id:'guild',channel_id:'channel',discord_id:'123'}]);
});
