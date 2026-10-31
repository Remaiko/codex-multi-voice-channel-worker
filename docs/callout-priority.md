# Ready callout priority — 0.9.2

Server-authorized dispatch-event audio now precedes waiting routine conversation replies in the existing bot/route playback queue. The transmission already playing finishes; no word or tone is cut off. Equal-priority announcements retain their original order. Different route keys remain independent, and the existing playback-time route and audience authorization is preserved.

This prioritizes prepared audio, not unfinished synthesis. It does not claim a global broadcast barrier across all department channels, select an announcer from the dispatcher roster, or implement Patrol/Tac/Fire side nets. Those remain separate work. A Discord VC remains one shared audio stream.

Validation covers a held active transmission with two pending replies and a later callout, ordered callouts, independent routes, authority revoked while waiting, recovery after failure and invalid priorities. Existing audience and opener/tone/detail assembly tests continue to run in the full worker suite. Tests use no production voice broadcast or human microphone.
