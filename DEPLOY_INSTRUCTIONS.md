# Midnight CAD persistent voice worker

This repository contains the persistent Discord voice worker. It is not the CAD dashboard or API. Version 0.5 supports companion bot identities in one shared worker so different departments can stay connected to separate voice channels in the same server simultaneously. Each identity has an independent connection namespace and transmission queue. With only the main bot configured, transmissions move that connection between channels sequentially.

## Department companion identities

Create separate Discord applications with bot users and invite each with only `View Channel`, `Connect`, and `Speak` (permission integer `3146752`, scope `bot`). Companions do not register slash commands or require privileged intents. Keep the original bot for commands, linking, and dashboard control.

Store these secrets directly in the Render worker environment; never put their values in source, logs, screenshots, or chat:

| Department route | Render secret |
| --- | --- |
| FIRE_EMS (or FIRE / EMS) | VOICE_BOT_TOKEN_FIRE_EMS |
| BCSO | VOICE_BOT_TOKEN_BCSO |
| SASP | VOICE_BOT_TOKEN_SASP |
| LSPD | VOICE_BOT_TOKEN_LSPD |
| FEDERAL (or ATF / CBPO / HSI / ICE / USBP / USMS) | VOICE_BOT_TOKEN_FEDERAL |

The main identity continues to use `DISCORD_BOT_TOKEN`. Advanced configurations can instead use `VOICE_COMPANION_BOT_TOKENS`, a JSON object mapping department codes or exact channel IDs to distinct bot tokens. A channel-ID identity takes precedence over a department identity. Conflicting credential sources and duplicate tokens are rejected. A companion login failure does not take down the main identity; inspect identity counts in `/health` before enabling its route.

Select each voice channel and its department in the bot dashboard. FIRE_EMS combines eligible Fire and EMS listeners; FEDERAL combines the federal departments. A missing companion falls back to the main bot and therefore cannot provide simultaneous same-server connections. Reusing one department identity for two channels also makes those channels sequential; configure an exact channel identity when both must remain connected.

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
5. The deployment enables the optional command pipeline with `VOICE_INPUT_ENABLED=true` and `VOICE_COMMANDS_ENABLED=true`. Listening still requires the server route and individual responder opt-in. Speech recognition reuses `ELEVENLABS_API_KEY` when available; `OPENAI_API_KEY` is an optional alternative. Set `VOICE_STT_PROVIDER=elevenlabs` or `openai` to choose explicitly, or leave the default `auto`. Without a configured provider, voice input remains disabled; dispatch output continues to work. The worker transcribes a locally synthesized radio-check phrase on startup to verify the provider; it sends no Discord channel audio for this check and broadcasts nothing. Never put a key in chat or source control.
6. After deploy, open the Render service's `/health` URL. Confirm `ready:true`, `routeSyncHealthy:true`, and `eventPollingHealthy:true`. With the main bot and five companions configured, `configuredBotIdentities` and `readyBotIdentities` should both be 6. Check `connectedVoiceChannels` after saving routes in CAD; this count depends on configured, accessible routes. Speech commands additionally require `speechRecognitionReady:true`, server enablement, and individual opt-in.
7. With authorization to broadcast in the test server, test a fictional CAD call. Verify that each department receives only its intended deliveries, different identities can play simultaneously, and consecutive deliveries on the same identity do not cut each other off. Verify that an unauthorized listener causes playback to stop. Unit tests do not establish live Discord voice acceptance.

## Verify locally

## Shared fleet dashboard

Version 0.6 exposes `POST /v1/fleet` only with the existing private worker Bearer key. The CAD bot dashboard verifies Discord Manage Server permission before requesting a server-scoped status or reconnect. Responses contain bot readiness, installation, department routes and connection states; they omit credentials and responder allowlists. A reconnect waits on the identity queue, leaving other departments untouched. Pausing and assigning channels use the dashboard's atomic database save rather than temporary worker state. No test audio is broadcast by these controls.

Run `npm test`. The unit suite covers route expansion, legacy single-channel routes, authorization policies, and spoken command parsing. A live Discord test is still required to verify bot permissions, gateway voice behavior, and audio playback.


