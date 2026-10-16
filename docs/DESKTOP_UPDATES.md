# Shared Windows releases

The current authenticated office release is **0.1.33**, published on 2026-10-16.
Existing users receive it through the update button below. Its verified Windows
x64 installer is 107,136,047 bytes, SHA-256
`09dd75ad564a2f90fe5ff6ef5c7d91a620b191ef902612b67e4d120e37e6d7a8`.
It preserves selected Touch character colors in the preview and Canvas renderer,
adapts eye contrast, and corrects and expands the ready-made palettes. The prior
automatic Kasko/Traffic notice sheets and their deployed API/database support
remain included. See [notice sheets](NOTICE_SHEETS.md).

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
