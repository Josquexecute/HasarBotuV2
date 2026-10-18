# Shared Windows releases

The current authenticated office release is **0.1.46**, published on 2026-10-18
(Europe/Istanbul; 2026-10-18T07:58:38.939Z).
Its verified Windows x64 installer is 105,170,166 bytes, SHA-256
`664dd0a1e2401b4a39e17b0d05e2ce85482fd76ac6295237787a6a90dab1d3ba`.
The Value Loss tab is now a compact calculator with one Calculate action and a TL
result. It no longer requests evidence, reports or calculation approval, and value
loss no longer blocks normal case closure. Existing records remain preserved.
The installed 0.1.45 client verified the live calculator, reported 0.1.46 as
available and downloaded the complete authenticated installer with HTTP 200 and
its exact size and SHA-256. The previous manifest and immutable installer were
preserved; users control installation. See
[calculator behavior, validation and delivery evidence](VALUE_LOSS_CALCULATOR_2026-10-18.md).

The previous authenticated office release was **0.1.45**, published on 2026-10-18
(Europe/Istanbul; 2026-10-18T07:13:43.210Z).
Its verified Windows x64 installer is 105,179,531 bytes, SHA-256
`89a4802ca536dc01872b8b1cbb6df5b1f486fde6d440d4bd870857c1ca85733c`.
Close previews and approvals now retain their required command key through the
office field gateway. Validation messages distinguish reason, version and command
transport failures. The server correction is already effective for existing clients.
The installed 0.1.44 client reported 0.1.45 as available and downloaded the complete
authenticated installer with HTTP 200 and its exact SHA-256. Its manifest and
immutable installer were preserved. See
[closure correction and delivery evidence](CLOSURE_PREVIEW_FIX_2026-10-18.md).
The free public entry is [HasarBotu Saha](https://hasarbotu.profaruk1.workers.dev/saha).
For the previous release, the installed 0.1.43 client reported 0.1.44 as available and downloaded the complete
authenticated installer with HTTP 200 and its exact SHA-256. The previous 0.1.43
manifest and immutable installer were preserved. Users control installation.
Touch now opens the selected search result directly in the main application.
Its Notifications shortcut filters inbox, operational alerts and tracking to the
same case, including read acknowledgments. Users can return to general notifications.
See [Touch behavior, validation and delivery evidence](TOUCH_CASE_NAVIGATION_2026-10-18.md).
The previous 12-hour account timeout is removed. Valid existing sessions were
preserved; application restart retains authentication. The running older client
confirmed a session without server expiry and renewal of its persistent cookie.
Logout, account disablement and password changes revoke sessions. See
[session behavior, validation and delivery evidence](PERSISTENT_SESSIONS_2026-10-18.md).
The authenticated mobile field-photo portal supports plate search, camera/gallery
uploads, original preservation, 100–600 KiB JPEG office copies and consent-based
session persistence. See [field photos and delivery evidence](FIELD_PHOTOS.md).
Folder discovery now keeps running after a transient, unstable pCloud snapshot,
without changing records until a consistent scan is available.
Management is now administrator-only. Users can edit their own names, and
administrators can edit everyone's names; changes synchronize across active clients.
See [account profiles and delivery evidence](ACCOUNT_PROFILES_2026-10-17.md).
The previous case-stage filter and company-root folder mapping remain included.
The deployed office-only inventory reconciles moved, deleted and physically
closed folders; see [folder repair and verification](FOLDER_FIXES_2026-10-17.md).
Project ownership, UI branding, notice templates and Windows metadata identify
**Ömer Faruk İŞLEYEN**. The existing Touch character is retained under the user's
stated written permission; third-party notices remain separate. Google login domain
and folder mappings use private configuration while preserving existing office access.
See [ownership, validation and delivery evidence](OWNERSHIP_2026-10-17.md).
Previous bulk document approval, smoothness and resource improvements remain included.

The existing public 0.1.15 installer remains available from [HasarBotu download](https://github.com/Josquexecute/HasarBotu-Downloads/releases/latest/download/HasarBotu-Kurulum.exe).
New GitHub releases are prepared only in the private `HasarBotuV2` repository and
require repository access to download. See [the user-controlled GitHub workflow](GITHUB_RELEASE_WORKFLOW.md).
The office distribution includes its HTTPS server configuration; office LAN clients
do not need Tailscale. See [distribution and LAN operation](DESKTOP_DISTRIBUTION_2026-10-14.md)
for packaging, Windows permission prompts and server address maintenance.
The source repository remains private. GitHub provides initial installers;
authenticated application updates continue through the office API below.
Publishing a GitHub release does not automatically update this office feed or
deploy backend services and database migrations. The same verified package must
be published to the office update directory separately, or by the
[GitHub-to-office transfer task](OFFICE_GITHUB_RELEASE_SYNC.md) after its private
repository authorization and activation. That task is not enabled yet.

Open **Ayarlar → Uygulama güncellemeleri**, select **Güncellemeleri kontrol et**,
then **Güncelle ve yeniden başlat** when a newer release is available. The app
downloads and verifies the installer, closes normally, installs into its existing
per-user directory and restarts. User data and API configuration are retained.
From desktop 0.1.28, selecting installation immediately shows the checking state
while the server revalidates the selected release. Both actions remain disabled
until that check finishes, so a slow response no longer leaves an apparently idle
installation button. The installer is still downloaded only after revalidation.
Browser and development builds have no installation action. Every authenticated
role can check releases.

The optional API setting `DESKTOP_RELEASES_DIR` must be an absolute,
administrator-owned directory. With Windows services, add it to the API wrapper's
environment. Stop the dependent file-agent before restarting the API, then restart
the agent after API health is ready. An unconfigured directory disables
publication. A malformed manifest or damaged artifact returns 503.

Building or installing a package locally does not advance the office feed.
Before marking distribution complete, verify the authenticated latest endpoint,
an older installed client's update-check state, and the streamed artifact's exact
length and SHA-256.

Build and verify the x64 NSIS release before publishing. With Node 24 and built
locked dependencies, run from the repository:

```powershell
node scripts/publish-desktop-release.mjs apps/desktop/release/HasarBotu-Setup-0.1.15.exe C:/ProgramData/HasarBotu/desktop-releases 0.1.15 release-notes.txt
```

The Windows publisher verifies the executable's version resource and computes its
actual SHA-256 and length. It creates an immutable `<sha256>.exe`, verifies the copy
and atomically replaces `latest.json`. It refuses downgrades or a different artifact
under an existing version. Repeating the same version and artifact is safe. Allow
only deployment administrators and the service account to write this directory.
There is no renderer upload or publication endpoint.

Authenticated endpoints are `GET /api/v1/desktop-updates/latest` and
`GET /api/v1/desktop-updates/artifacts/:sha256`. The server verifies the same open
artifact it streams. The manifest contains version, win32/x64 target, SHA-256,
size, publication time and notes, with no download URL or path. Installers are
limited to 250 MiB. Only artifact requests have a five-minute bridge timeout.

Electron accepts update IPC only from the main window's trusted top frame. It uses
that window's authenticated session, rejects redirects, checks the latest release
again before downloading, enforces exact size/hash and a Windows executable header,
and checks the internal installer version before launch. Operations are serialized.
Failed verification keeps the app open and removes partial downloads. The installer
runs as a temporary task owned by the current Windows account with limited
privileges, so it survives application shutdown. Its helper waits for normal
shutdown, restores the API origin and user profile, and restarts only after exit
code 0. The task removes itself after completion. If Windows refuses task
registration, the app stays open and reports the failure. Completion and errors are recorded at
`userData/updates/<sha256>/install-result.json`.

Releases use the existing authenticated API connection and artifact integrity
checks. This feature does not add Authenticode signing.

## Office acceptance · 2026-10-16

The feed had remained at 0.1.27 after 0.1.31 was installed locally. The tested
publisher advanced it atomically to the same verified 0.1.31 installer; the previous
manifest and immutable 0.1.27 artifact were preserved. No API restart was needed.

- Running 0.1.27: production update IPC returned `available`, release `0.1.31`.
- Running 0.1.31: production update IPC returned `current`, release `0.1.31`.
- Both authenticated clients downloaded all 107,123,775 bytes with the exact
  published SHA-256; HTTP 200.
- Publication tests: 6/6 PASS, including the real Windows publisher, concurrent
  publication lock, repeat publication and unchanged manifest after verification failure.
- Temporary diagnostic listeners and the interactive verification task were removed.

Local evidence: `.local/update-feed-20261016/` (`publication-proof.json`,
`office-update-check-proof.json`, `local-update-check-proof.json`,
`publication-tests.log`).

## Notice-sheet deployment · 2026-10-16

Version 0.1.32 is installed on the local Windows workstation and the office
server desktop. Both installed application archives match the verified package.
Existing profiles and connection settings were backed up and retained; the
office account remained authenticated after the upgrade. The local workstation
had no authenticated session before installation and requires normal login.

The office API runtime was updated from the locked dependencies after a verified
PostgreSQL backup. Additive migrations `0060_pdf_parser_version` and
`0061_notice_sheets` were applied without rewriting migration history. The API,
file-agent, folder discovery and HTTPS services are running and healthy.

The authenticated feed advanced from 0.1.31 to 0.1.32 while preserving the previous
manifest and installer. The running 0.1.31 client reported `available`; the updated
0.1.32 client reported `current`. Both streamed the complete installer with its
exact published size and SHA-256. On real office Traffic and Kasko cases, the
installed application loaded and saved the existing notice values, invoked the
print action and produced one A4 PDF each. No physical printer job was submitted.
Temporary inspectors and deployment tasks were removed.

Local deployment evidence: `.local/notice-sheet-deploy-20261016/`
(`deployment-summary.json`, `office-installation-proof.json`,
`office-acceptance-proof.json`, `office-feed-before-proof.json`,
`office-feed-after-proof.json`, `publication-proof.json`). Actual claim PDFs remain
private diagnostic artifacts and are excluded from Git.

## Touch color publication · 2026-10-16

Version 0.1.33 was published to the shared authenticated office update feed at
19:48:04 UTC. The Windows publisher verified the executable version, exact length
and SHA-256, preserved the previous 0.1.32 manifest and immutable installer, and
replaced the manifest atomically. The API remained healthy; no service restart or
database change was needed. Running clients retain control of installation.

TypeScript, ESLint, the full build and bundle boundaries passed. Release validation
recorded 2,712 passing tests, including real PostgreSQL, Electron, and the Windows
publisher integration test. Six optional frontend live-connection tests were
skipped because their configuration was not supplied. The new package actually
started and served its packaged UI; all 58 packaged UI files matched the build,
and the office connection profile was preserved. Character pixels were checked
for 12 colors in animated and still modes.

The installed 0.1.32 office client's final update check returned 401 because its
account session was unavailable. Authenticated client visibility and streaming
verification remain pending normal user login; authentication was not bypassed.
Temporary diagnostic tasks and inspectors were removed. Local evidence:
`.local/touch-colors-release-20261016/` (`preparation.json`,
`hasarbotu-release-checks/summary.json`, `package-smoke.log`,
`publication-proof.json`).

## Full review publication · 2026-10-17

Version 0.1.34 was published at 2026-10-17T05:50:00.669Z. The existing
authenticated office feed retained the previous 0.1.33 manifest and immutable
installer; the latter's SHA-256 was verified again after publication.

The running installed 0.1.33 client's production update IPC returned `available`
for 0.1.34. Its existing authenticated session streamed all 107,140,726 bytes
with HTTP 200 and the exact published SHA-256. Installation was left to users.
The two compiled API routes now use the shared Istanbul calendar helper; their
previous files and deployment plan were preserved and the running API process
was verified to have started after both file updates. No database migration was
required. All four office services are running; folder discovery completed a
fresh cycle with `PASS`. Temporary verification tasks and inspectors were removed.

The review recorded 2,904 distinct passing tests, including the optional live
HTTP tests executed separately. TypeScript, ESLint, production builds, bundle
limits, the actual packaged Electron startup and Windows publisher all passed.
The installer smoke test verified all 59 packaged UI files and the office profile.
See [scope, evidence and limitations](FULL_REVIEW_2026-10-17.md).

Office memory exhaustion also interrupted services during delivery. With the
user's explicit approval, pCloud was restarted in its original user session;
its files, cache and configuration were retained. The resulting memory reduction
and successful subsequent discovery cycle were verified. This recovery does not
establish a permanent fix for pCloud's excessive memory consumption.

Local evidence: `.local/full-review-20261016/` (`publication-proof.json`,
`office-update-check-proof.json`, `backend-proof.json`,
`pcloud-restart-proof.json`, `final-health-proof.json`).

## Smoothness and resource publication · 2026-10-17

Version 0.1.35 was published at 2026-10-17T06:26:19.761Z. The previous 0.1.34
manifest and immutable installer were preserved and its installer hash was
verified again. The installed 0.1.33 client's production update IPC returned
available for 0.1.35; its existing authenticated session streamed all 107,141,484
bytes with HTTP 200 and the exact published SHA-256. Installation remains under
user control. All four services and folder discovery are healthy; temporary
verification tasks and inspectors were removed. No backend or database update
was required.

Validation recorded 2,912 distinct passing tests, a successful Windows x64
installer build and actual packaged startup, all 59 UI files matching the build,
and the preserved office connection profile. See [measured CPU/memory results,
frame cadence, test scope and limits](PERFORMANCE_2026-10-17.md).

Local evidence: `.local/smooth-20261017/` (`final-performance-summary.json`,
`final-validation.json`, `package-results.json`, `publication-proof.json`,
`office-update-check-proof.json`, `final-health-proof.json`).

## Bulk document approval publication · 2026-10-17

Version 0.1.36 was published at 2026-10-17T06:55:24.713Z. The previous
0.1.35 manifest and immutable installer were preserved and the latter's SHA-256
was verified again. The installed 0.1.35 client's production update
IPC returned `available` for 0.1.36. Its existing authenticated session downloaded
all 107,141,714 bytes with HTTP 200 and the exact published SHA-256.
Installation remains under user control. All four office services are healthy;
temporary verification tasks and inspectors were removed. No backend deployment
or database migration was required.

The first publication attempt stopped at the health guard because folder
discovery was stopped. Windows recovered it automatically. Two fresh successful
cycles were confirmed before publication and another at the final health check;
service code and configuration were retained.

Validation passed TypeScript, ESLint, the production build, 531 broad frontend
tests, the final 14-test tracking regression suite, 21 tracking API integration
tests, real Electron UI acceptance (35 checks) and the Windows installer smoke
and publisher checks. All six optional live HTTP tests skipped by the default
frontend runner were executed separately with an isolated fixture and passed.
The isolated UI fixture approved 103 owned
documents in one action through the real authenticated API, persisted the edited
type and note, recorded 103 owner audit events and left another owner's document
pending. Layout was checked in light/dark themes, a 390-pixel window and 150% zoom.
Regression tests cover 201 documents beyond the visible batch, restored drafts
after a refreshed row leaves the visible batch, keyboard activation, missing permissions,
duplicate clicks, arrivals during processing, partial failure/retry and refresh
failure. Production claim documents were not approved during validation.

Local evidence: `.local/bulk-documents-20261017/` (`validation.json`,
`final-validation.json`, `ui-evidence/refinements-ui-acceptance.json`, `package-results.json`,
`publication-proof.json`, `office-update-check-proof.json`,
`final-health-proof.json`).
