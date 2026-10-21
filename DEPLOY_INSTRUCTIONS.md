# Midnight CAD persistent voice worker

This repository contains the persistent Discord voice worker. It is not the CAD dashboard or API. The worker supports several configured channels per server by queueing transmissions and moving one bot connection between those channels. Different servers can transmit independently. A single bot cannot remain in several voice channels of one server simultaneously.

## Configure the CAD voice routes

The private `POST /api/voice-routes` endpoint must return a JSON object with a `routes` array. It can return one object per channel:

```json
{"routes":[
  {"guild_id":"123456789012345678","agency_code":"SASP","voice_channel_id":"223456789012345678","authorized_listener_ids":[]},
  {"guild_id":"123456789012345678","agency_code":"BCSO","voice_channel_id":"323456789012345678","authorized_listener_ids":[]}
]}
```

Or it can return one object with `voice_channel_ids` for channels that share the same agency and policy. Existing single-channel `voice_channel_id` responses remain supported. For dispatch audio to play in multiple channels, the CAD claim endpoint must enqueue a separate delivery per channel, with the corresponding `voice_channel_id` and that channel's authorized on-duty listeners. Each delivery needs its own acknowledgement ID.

Configure each selected channel in the dashboard and grant the bot `View Channel`, `Connect`, and `Speak`. Only authorized on-duty responders may be present when an announcement plays. Spoken input requires a server-enabled voice route and an individually opted-in, linked, on-duty speaker. Other users are never transcribed.

## Deploy on Render

1. Put `Dockerfile`, `render.yaml`, `package.json`, and the `src/` folder at the repository root. Do not leave them nested inside another folder.
2. In Render, create a Blueprint from the connected repository. The Blueprint creates the persistent Docker web service and `/health` check.
3. Set `DISCORD_BOT_TOKEN` and `VOICE_WORKER_KEY` as Render secrets. `VOICE_WORKER_KEY` must be a private 64-character hexadecimal value and must match the CAD API configuration. Never commit secrets or send them in chat.
4. Set `ELEVENLABS_API_KEY` as a Render secret to enable ElevenLabs speech. The default dispatch voice is Rachel; change `ELEVENLABS_VOICE_ID` to another voice ID from your ElevenLabs voice library if desired. If ElevenLabs is unavailable, the worker falls back to local `espeak-ng` speech.
5. The deployment enables the optional command pipeline with `VOICE_INPUT_ENABLED=true` and `VOICE_COMMANDS_ENABLED=true`. Listening still requires the server route and individual responder opt-in. Add `OPENAI_API_KEY` as a Render secret for speech recognition. Without it, voice input remains disabled; dispatch output continues to work. Never put a key in chat or source control.
6. After deploy, open the Render service's `/health` URL. Confirm `ready:true` and check `connectedVoiceChannels` after saving routes in CAD.
7. Test with a fictional CAD call in the test server. Verify that announcements play in each configured channel and that deliveries in one server run sequentially without cutting each other off. Different servers can play simultaneously.

## Verify locally

Run `npm test`. The unit suite covers route expansion, legacy single-channel routes, authorization policies, and spoken command parsing. A live Discord test is still required to verify bot permissions, gateway voice behavior, and audio playback.


