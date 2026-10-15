# Shared Windows releases

The current authenticated office release is **0.1.16**. Existing users receive it
through the update button below. New installations use `HasarBotu-Kurulum.exe`
inside `HasarBotu-Kurulum-0.1.16` on the office desktop (also copied to the owner's
desktop). That fixed package is verified separately from the forthcoming private
GitHub 0.1.17 release.

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
Browser and development builds have no installation action. Every authenticated
role can check releases.

The optional API setting `DESKTOP_RELEASES_DIR` must be an absolute,
administrator-owned directory. With Windows services, add it to the API wrapper's
environment. Stop the dependent file-agent before restarting the API, then restart
the agent after API health is ready. An unconfigured directory disables
publication. A malformed manifest or damaged artifact returns 503.

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
