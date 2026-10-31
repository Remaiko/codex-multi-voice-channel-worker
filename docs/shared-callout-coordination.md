# Shared callout coordination — 0.9.3

Prepared server-authorized event announcements now create a playback barrier across the department bot routes in the same Discord server. Speech already admitted finishes. Waiting routine replies pause until the callout event finishes across its admitted routes. The same event can fan out concurrently on separate bot routes; two transmissions on one bot route never overlap. Different events remain ordered, and different Discord servers stay independent. Routine replies on distinct department routes can still run concurrently when no announcement is waiting.

Scheduling occurs after synthesis, at the playback boundary. It does not repeat CAD mutations or alter the server's recipient list, event receipt/deduplication or current audience/route authorization. Revoked or failed playback releases its scheduling slot. Pending jobs are bounded to 128 per server and expire after 45 seconds of waiting; active speech is not interrupted. Failed event deliveries retain the existing retry/receipt path. The scheduler matches the current single-instance worker deployment; it is not a cross-instance distributed lock.

Eight focused tests cover an active reply and pending callout, cross-department blocking, same-event fanout, ordered different events, same-route serialization, concurrent routine routes, server independence, revocation/failure recovery, queue bounds and waiting-job expiry. The full worker suite remains required before rollout. These are synthetic tests with no human microphone or production broadcast.

This coordinates Discord worker playback. Browser AI reply playback uses its own authorized transport; a global browser/Discord barrier, roster-based announcement selection and Patrol/Tac/Fire side-net selectors remain pending. It does not promise per-listener private audio mixes inside a shared Discord VC.

Rollback: worker 0.9.2 merge 11fb5cf0ccce544ab4618b48173db0a5e7c83046 / Render dep-dbj5o5navr4c73bo0kr0. No database migration or environment/permission change is needed for this patch.
