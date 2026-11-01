# Shared Discord VC radio tuning

Version 0.9.6 consumes the server-authorized radio_net on each existing department route. Legacy routes default to Patrol 1 or Fire 1. Automatic callouts play on Patrol 1, Tac 1 and Fire 1. Side nets suppress new automatic synthesis, cancel queued/active automatic playback when a route retunes, and discard those deliveries rather than replaying them later. Interactive replies and repeats retain the existing department/audience checks and the selected dispatcher lease.

A linked, on-duty, speech-enabled responder in the configured VC can say “Central, switch this channel to Patrol 2” (also Dispatch; Patrol/Tac/Fire 1/2, number words accepted). This tunes the whole Discord VC. Personal “switch me” requests are excluded; this does not create a private mix or relay human speech between different VCs. The gateway validates the current voice identity, saves the exact net and returns a scope-bound receipt. The worker rechecks presence/identity and route refresh before speaking success. Existing incident actions still use the original agent and receipt path.

Deployment order: worker first (missing net metadata retains primary defaults; unsupported tuning gateway fails without changes), guarded database migration, then bridge/dashboard 4.8.7. Existing configured channels and nets are not changed as a test. No public tones, incidents or player transactions are generated. Human acceptance is deferred.

Validation: 241 worker tests pass, one existing skip. Tests cover all six nets, failed/changed authority, exact receipt matching, real production handler routing, side-net suppression, active/queued cancellation, parent abort and independent guilds. The dashboard/database checks are recorded in the CAD repository.

Rollback source is merge 5ffb9cf9154e0e1facaabcd801a5d44f25f80329 (worker 0.9.5). Before reverting a net-aware worker, return configured channels to primary nets using authorized controls, or disable voice dispatch; the old worker does not understand side-net metadata.
