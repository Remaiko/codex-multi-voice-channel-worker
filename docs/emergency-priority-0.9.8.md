# Duress playback priority — worker 0.9.8

The actual worker playback entry and Discord player adapter reproduced an emergency waiting behind ordinary speech. The delivery loop now assigns emergency priority only to the authoritative duress kind. A dedicated emergency scheduler group aborts ordinary active playback in that server, waits for each interrupted task to finish cleanup, then starts duress. The same emergency can fan out to separate department channels. An already playing emergency finishes before the next emergency event; its late same-event channels remain grouped. Other servers keep their independent traffic. Ordinary callout and routine FIFO/barrier behavior is retained.

Scheduler cancellation is forwarded into the real player adapter and current audience checks remain in force. External scope/net cancellation still reaches active playback and listeners are removed on cleanup. An ordinary full queue admits duress by displacing one waiting ordinary job; a queue full of emergencies stays bounded. No new permission, voice route, token, provider configuration or subscription is introduced.

Verification: actual worker entry/player-stop regression failed on 0.9.7 and passes now; the actual delivery loop classifies only duress as emergency. Eighteen scheduler cases and two actual-entry cases pass. The full worker suite passes 252 cases with one existing skip. Tests use synthetic members and event-emitter players, with no Discord gateway login, speech provider, microphone or real panic. Deployment and human VC acceptance remain pending.

Rollback: main merge 8eee182d7bc18356453acfd37687cacf8ce1941d (0.9.7), Render dep-dbjdop15efls73dtg3p0. This patch changes only worker-local scheduling; global CAD/browser/Discord announcer ownership remains outstanding.
