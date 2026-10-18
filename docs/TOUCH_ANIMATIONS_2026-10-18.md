# Touch gestures · 2026-10-18

Desktop **0.1.51** adds four small reactions to the existing character:

- A curious tilt toward the cursor after 650 ms of hover, limited to once per
  12 seconds.
- A stretch after 45–75 seconds without character interaction. Hovering,
  pressing and active gestures defer it.
- A tilt following actual native window movement and a soft landing on release.
- A small happy hop after a confirmed quick-note save in either the main app
  or the standalone Touch panel. Failed and pending requests do not celebrate.
  Success during dragging waits for release; bursts are coalesced for six seconds.

The new controller uses the original drawing engine's tweens from the current
pose. It adds no timer and preserves the existing 60 fps cap and 8 Hz idle
checks without redrawing settled pixels. Expired eye expressions now redraw
even when body movement has already stopped, so happy eyes return to neutral.
Hiding or reduced motion clears unfinished gestures and pending feedback;
feedback received in those states is discarded. Both system and account motion
preferences remain effective. Desktop coordinates and case details are not sent
to the isolated character; drag feedback contains only a bounded direction.

## Validation

**784 distinct tests passed** across the frontend and desktop suites, the
separately executed PostgreSQL Touch UI test, and the real Windows publisher
integration test. The final focused animation/Electron run also passed 17/17
tests already included in those totals.

There are **21 remaining skipped tests**: eight frontend tests requiring optional
connections/database setup and 13 other desktop database integration tests.
The affected Touch database test was executed separately and passed; its 60 UI
checks include real note persistence and feedback from both application windows.

The native Electron assistant passed 83 checks, including bounded IPC, real
character pixels, movement first observed on pointer release, persistence,
accessibility, cleanup and five gesture sequences at 2x physical resolution
without clipping. Real-engine tests verify continuous pose values during
interruptions, rest after gestures, deferred/coalesced success, and absence of
new gesture timers. Frame-cadence tests simulate both 60 Hz and 144 Hz displays.

TypeScript, ESLint, production builds and frontend bundle limits passed.
The Windows x64 NSIS package passed actual startup, bridge/UI serving, profile
preservation and tray behavior. All 61 packaged UI files matched the build.

## Publication

Published to the existing authenticated office feed at
**2026-10-18T20:08:05.938Z**:

- Version: **0.1.51**, win32/x64.
- Installer length: **105,189,841 bytes**.
- SHA-256: `902cf9f869051f36b0e10d61d5f0be43759aa70533204d20bf8e07a9f7f76d6a`.
- Running installed **0.1.49** client: production update check returned
  `available`, version `0.1.51`.
- Its authenticated artifact request returned HTTP 200, all 105,189,841 bytes
  and the exact published SHA-256 at 2026-10-18T20:08:14.531Z.
- The previous 0.1.50 manifest was backed up and its immutable installer hash
  verified again after publication. Installation remains user-controlled.
- Temporary client inspection and its verification task were removed. The
  isolated local PostgreSQL instance was returned to its original stopped state.

No backend code, database schema or production service configuration changed.
The API, folder discovery, office HTTPS and field portal were running before
and after publication. The file-agent was already stopped: Windows service
events report termination followed by restart failure due to insufficient
paging-file memory. This separate pre-existing server issue was recorded;
its service state was preserved and is not an animation delivery blocker.

Local evidence: `.local/touch-motion-20261018/` contains `validation-proof.json`,
`visual/assistant-checks.json`, `visual/assistant-motion-poses.png`,
`touch-ui/results.json`, `package-smoke.json`, `publication-proof.json`,
`office-update-check-proof.json`, `services-before.json` and
`final-health-proof.json`. Private connection files remain excluded from Git.
