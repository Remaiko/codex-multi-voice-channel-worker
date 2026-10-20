# Midnight CAD persistent voice worker - Render setup

This repository is **only** the continuously running Discord voice worker, not the Vercel dashboard. It is a Docker web service because it exposes a /health endpoint. Render must use a paid compute plan that does not spin down. Start with a single instance, since running the same bot token in multiple workers can cause duplicate voice sessions.

1. Create a **private GitHub repository** and upload the contents of this directory to its **root**. `Dockerfile`, `render.yaml`, `package.json`, and `src/` must be at the top level of the repository (not wrapped in another `voice-worker` directory).
2. Sign in at https://dashboard.render.com/, choose **New > Blueprint**, connect your GitHub repository and approve the Blueprint. It configures a Docker web service named `midnight-cad-voice-worker` with a paid `0.5c-512mb` instance and health endpoint `/health`.
3. In Render's secret/environment setup, supply `DISCORD_BOT_TOKEN` and `VOICE_WORKER_KEY`. Reuse the same bot token and the same **64-character hexadecimal** `VOICE_WORKER_KEY` already set in the **production environment** of the Vercel project `midnight-cad-discord-test`. Never publish these values in GitHub or chat.
4. Leave `VOICE_INPUT_ENABLED=false` and `VOICE_COMMANDS_ENABLED=false` for the first boot. The worker's announcements use `VOICE_CONTROL_URL=https://midnight-cad-discord-test.vercel.app/api/voice`.
5. Deploy. Once running, open `https://YOUR-RENDER-SERVICE.onrender.com/health` (use the actual URL shown by Render). Check JSON `ready:true`. `connectedGuilds:0` is expected until CAD has a valid voice route.
6. In the Midnight CAD Discord **server dashboard**, select a designated voice channel, enable announcements for this guild, and check that the bot has `View Channel`, `Connect`, and `Speak` permissions. Configure the bot/Discord linked user as a verified on-duty responder and opt in to dispatch voice alerts. Test a fictional incident.
7. To turn on two-way spoken commands **after** production routes + command endpoints are deployed and consent is in place, set `VOICE_INPUT_ENABLED=true`, `VOICE_COMMANDS_ENABLED=true`, and securely add `OPENAI_API_KEY` to Render. The worker derives `/api/voice-routes` and `/api/voice-command` from `VOICE_CONTROL_URL`, or you may explicitly set `VOICE_ROUTE_URL` and `VOICE_COMMAND_URL` to the same trusted bot API origin. In CAD enable the guild's voice listening setting and individual responder opt-in. Disclose use of an external speech transcription provider.

Important: Running the worker does not itself activate voice in a guild. Guild routing is currently disabled until the Discord channel is selected and enabled. The earlier endpoints were preview-only and require deployment to bot production to enable full CAD voice commands. Spoken CAD updates and records writes remain disabled in this worker.

## Testing and health

Run `node --test src/*.test.js test/*.test.js` in the source tree (no Discord credentials required). These source tests passed 16/16 at packaging. Render provides logs to diagnose startup failures such as bad bot token, invalid 64-char key, missing Discord channel permissions, or API errors.

## Package notes

This source archive does not contain secrets. Its Dockerfile currently runs `npm install` with exact direct dependency versions. Generate and review a `package-lock.json`, change Dockerfile to use `npm ci`, and commit that lockfile before production deployment for a reproducible dependency graph. This packaging environment was unable to complete npm registry access; the **Docker image has not been built or tested here**. Node.js parsing and unit tests are not a substitute for testing real Discord Opus audio and transcription.
