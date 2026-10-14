# Shared Windows releases

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
node scripts/publish-desktop-release.mjs apps/desktop/release/HasarBotu-Setup-0.1.11.exe C:/ProgramData/HasarBotu/desktop-releases 0.1.11 release-notes.txt
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
