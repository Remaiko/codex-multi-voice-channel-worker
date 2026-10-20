# Midnight CAD persistent voice worker

This repository contains the persistent Discord voice worker. It is not the CAD dashboard or API. The worker can hold a separate Discord voice connection for each configured voice channel, including several channels in one server. Each connection uses its own audio player and queue so separate dispatch channels can speak at the same time.

## Configure the CAD voice routes

The private `POST /api/voice-routes` endpoint must return a JSON object with a `routes` array. It can return one object per channel:

```json
{"routes":[
  {"guild_id":"123456789012345678","agency_code":"SASP","voice_channel_id":"223456789012345678","authorized_listener_ids":[]},
  {"guild_id":"123456789012345678","agency_code":"BCSO","voice_channel_id":"323456789012345678","authorized_listener_ids":[]}
]}
```

Or it can return one object with `voice_channel_ids` for channels that share the same agency and policy. Existing single-channel `voice_channel_id` responses remain supported. For dispatch audio to play in multiple channels, the CAD claim endpoint must enqueue a separate delivery per channel, with the corresponding `voice_channel_id` and that channel's authorized on-duty listeners. Each delivery needs its own acknowledgement ID.

Configure each selected channel in the dashboard and grant the bot `View Channel`, `Connect`, and `Speak`. Only authorized on-duty responders may be present when an announcement plays. Keep role syncing and voice input disabled until configured and tested.

## Deploy on Render

1. Put `Dockerfile`, `render.yaml`, `package.json`, and the `src/` folder at the repository root. Do not leave them nested inside another folder.
2. In Render, create a Blueprint from the connected repository. The Blueprint creates the persistent Docker web service and `/health` check.
3. Set `DISCORD_BOT_TOKEN` and `VOICE_WORKER_KEY` as Render secrets. `VOICE_WORKER_KEY` must be a private 64-character hexadecimal value and must match the CAD API configuration. Never commit secrets or send them in chat.
4. Keep `VOICE_INPUT_ENABLED=false` and `VOICE_COMMANDS_ENABLED=false` during the initial deployment. Enable them only after the CAD routes are tested and responders have opted in; speech recognition also requires `OPENAI_API_KEY`.
5. After deploy, open the Render service's `/health` URL. Confirm `ready:true` and check `connectedVoiceChannels` after saving routes in CAD.
6. Test with a fictional CAD call in the test server. Verify that announcements play in each configured channel and that the channels can play simultaneously.

## Verify locally

Run `npm test`. The unit suite covers route expansion, legacy single-channel routes, authorization policies, and spoken command parsing. A live Discord test is still required to verify bot permissions, gateway voice behavior, and audio playback.
