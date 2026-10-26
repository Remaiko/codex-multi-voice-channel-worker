# Voice presence refresh —0.6.18

Idle voice connections refresh route authorization every30seconds but no longer delete and republish an unchanged empty database snapshot. The first snapshot after startup still clears stale presence. Human joins, moves and last-listener departures publish immediately; occupied rooms retain their existing30second heartbeat within the database75second expiry. Mute/deafen and duplicate gateway events with unchanged membership use the read-only routes action while a fresh heartbeat is not due.

One route refresh runs at a time. If membership changes during its network request or connection setup, it follows up with the current snapshot without waiting for the next interval. Failed requests do not acknowledge publication. Health reports aggregate publishedSnapshots and routeOnlyRefreshes counters without listener identifiers. No listener opt-in, duty/department authorization, speech, delivery, claim interval or database schema changes are introduced.

Validation:119 worker checks pass with zero skips, including actual FFmpeg decoding and nine membership/refresh/counter regressions. The idle simulation covers2880 periodic ticks; this is a reduction in presence-write calls, not a measurement of total Supabase compute savings. Live deployment, health counters and gateway recovery must be verified separately. No dispatch, duress or voice broadcast is required for acceptance.

Rollback point: Render dep-dbe18uijnfac73bvnbdg, worker mainf400b09c698059e7b492241f93f34cbd38880096 (0.6.17). Rolling back changes no player data or database schema.
