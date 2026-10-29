# Midnight CAD voice worker 0.9.0

This release consumes the v9 portal and Discord bot integration (wire protocol 8).
It adds bounded, actor-scoped natural-language plans, confirmation for inferred
mutations, exact-request recovery, private repeat validation, and audience plans
for fixed routine notices. The worker receives no privileged database credential.

## Deployment order

1. Apply the reviewed worker authorization migrations and deploy the narrow
   `midnight-worker-radio` gateway with JWT verification enabled in Supabase.
2. Deploy and verify portal 44641 and Discord bot 4.8.0. The bot needs the public
   legacy `SUPABASE_ANON_KEY` JWT for gateway transport; existing bridge and worker
   keys continue to authorize requests.
3. Deploy this worker to the existing single Render service. Do not create another
   worker against the same guild/voice routes.
4. Check version, ready identities, connected routes, route sync and event polling.
   Speech recognition/listening acceptance requires an explicitly opted-in test.

## Verification

The complete local Node suite passed all 32 test files, including actual current
entrypoint integration, separate-speaker histories, matching receipts, refusal of
unknown actions, changed actor scope, and cross-origin command rejection.
Fixtures send no real Discord audio and perform no hosted CAD or financial writes.

The previous production commit was
`0e9e847ffd9e717ba66e59c6b8728afa26aa3733` (worker 0.6.18).
Roll back the worker before portal/bot consumers if a release is reverted.
