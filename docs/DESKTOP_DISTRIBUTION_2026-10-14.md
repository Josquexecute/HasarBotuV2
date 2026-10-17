# Windows distribution and office HTTPS

Current authenticated office releases are recorded in [DESKTOP_UPDATES.md](DESKTOP_UPDATES.md). The 0.1.16 acceptance below is historical.

## Office distribution acceptance: 0.1.16 (2026-10-15)

Both existing computers and the authenticated office update feed use **0.1.16**.
The verified installer is available in `HasarBotu-Kurulum-0.1.16` on both desktops.
Use its `HasarBotu-Kurulum.exe` for new office installations. Its SHA-256 is
`c2c03b7a0327703adf81fbdaba1f011eeecb52eadde3e910461cf798e38c983f`
and its size is **102,670,167 bytes**. The fixed office artifact must not be rebuilt
and replaced under the same version.

This is a locally validated office release, not a completed GitHub Actions release.
The first GitHub run stopped on two UI test timing/loading failures; the fixes and
private GitHub-to-office transfer tooling are prepared as **0.1.17**, awaiting the
user's source push and release publication. Automatic transfer additionally needs
private-repository read access on the office computer; it is not enabled yet.
See [release workflow](GITHUB_RELEASE_WORKFLOW.md) and [office transfer setup](OFFICE_GITHUB_RELEASE_SYNC.md).

The installed clients retain their original profiles. Their packaged UI, office
profile, actual production HTTPS connection and fresh isolated profiles were
verified on both computers. Seven office services and automatic folder discovery
are healthy. This check does not constitute a new Windows reboot or real Google
account acceptance. Gemini credentials are still unconfigured.

## Existing public download: 0.1.15

Release **0.1.15** is available from one stable public link:
[HasarBotu-Kurulum.exe](https://github.com/Josquexecute/HasarBotu-Downloads/releases/latest/download/HasarBotu-Kurulum.exe).
The public `Josquexecute/HasarBotu-Downloads` repository contains installers,
checksums and installation instructions. `Josquexecute/HasarBotuV2` remains private.
New releases are now prepared **only in the private source repository**, following
the user's distribution decision. See [the user-controlled release workflow](GITHUB_RELEASE_WORKFLOW.md).
The existing public 0.1.15 link is retained; it is not updated by this workflow.

## First installation

1. Install on a Windows x64 computer connected to the office network.
2. Open HasarBotu. If Windows asks for administrator permission to configure the
   office connection, approve it or have a Windows administrator enter credentials.
3. Sign in with your own authorized Google account.

The server address is included in the package. The app first checks its configured
HTTPS connection; if necessary, it verifies the office server directly over LAN
with normal certificate and hostname validation before adding its own Windows
`hosts` block. Existing unrelated entries and their encoding are preserved.
A conflicting manual entry is reported rather than overwritten. No root
certificate is installed. An explicit `HASARBOTU_API_ORIGIN` setting still takes
precedence over the packaged default. Existing user profiles and drafts are retained.

Office LAN clients do not need Tailscale. The **server** still uses Tailscale for its
trusted HTTPS certificate and existing remote connection. Outside the office,
clients need the existing authorized Tailscale access; sharing a public/static WAN
IP does not itself provide LAN access from home.

Later updates use **Ayarlar → Uygulama güncellemeleri → Güncellemeleri kontrol et →
Güncelle ve yeniden başlat**. They require an authorized app session and retain its
profile and API configuration. See [shared releases](DESKTOP_UPDATES.md).

## Building and publishing

The normal release path is now: push verified source to `main`, wait for the
validated GitHub Actions draft, review it, then manually **Publish release**.
Only users with access to the private repository can download new GitHub releases.
No cross-repository token is required. Publication does not deploy the office API
or advance the office's authenticated application update feed.

Use Node 24 and the locked dependencies. Create an administrator-controlled JSON
profile outside Git, containing exactly these four fields:

```json
{
  "schemaVersion": 1,
  "apiOrigin": "https://desktop-efn2g33.tail276cda.ts.net",
  "lanIpv4": "192.168.1.100",
  "lanHostname": "DESKTOP-EFN2G33"
}
```

These connection parameters are distributed to clients. Never add credentials,
API keys or claim data to this profile. The package generator validates it, and
fails if it is absent or invalid. Its generated build file is ignored by Git.

```powershell
$env:HASARBOTU_DISTRIBUTION_PROFILE = 'C:\protected\office-distribution.json'
$env:HASARBOTU_DISTRIBUTION_ROOTS = 'C:\protected\office-folder-roots.json'
npm run build
npm run package:win --workspace @hasarbotu/desktop -- --publish never
```

Folder mappings are private distribution inputs: use `apps/desktop/build-resources/folder-roots.example.json` as the schema example. The roots input must be an absolute path to a JSON object containing valid root keys and absolute Windows paths, up to 64 KiB. Packaging generates the ignored `office-folder-roots.json`; its packaged name remains `folder-roots.json`. An omitted input produces an empty map and normal manual folder selection. Existing office releases must include their verified current mappings so physical paths and stored root identities remain compatible. Do not commit the actual office map.

GitHub Actions verifies the installer and uploaded assets before completing its
private draft. Source upload and the final publication remain user-controlled.
After publication and package acceptance, publish the same verified installer to the authenticated office update directory
with `scripts/publish-desktop-release.mjs` as documented in `DESKTOP_UPDATES.md`.
The GitHub asset name stays `HasarBotu-Kurulum.exe` across versions. New private
downloads require repository access; the published-release workflow checks the
actual authenticated download against its approved hash and length.
The installer currently has no Authenticode signature; SHA-256 verification is
not a Windows publisher signature.

## Office gateway operation

The deployed service is **hasarbotu-lan-https**, Caddy **2.11.7**, under
`C:\ProgramData\HasarBotu\lan-https-20261014`. It starts automatically with delay,
depends on `Tailscale`, and proxies validated HTTPS requests to the existing
loopback API on `127.0.0.1:3100`. Existing API, agent and remote routes are retained.
Its `Caddyfile` binds only `192.168.1.100:443`; the firewall rule
`HasarBotu-LAN-HTTPS-20261014` allows only `192.168.1.0/24` to this executable/address.
There is no new WAN forwarding rule, HTTP redirect listener or admin endpoint.

The observed LAN address `192.168.1.100` currently comes from **DHCP**. Reserve this
address for the server in the router to keep it stable; that reservation has not
been verified or changed by this deployment. If the address or subnet changes,
update the gateway bind/firewall and distribution profile, then validate the new
LAN endpoint before releasing a new client package. A static public IP does not
guarantee a fixed private LAN address.

Check the service and HTTPS API with normal Windows trust validation:

```powershell
Get-Service hasarbotu-lan-https, hasarbotu-api, Tailscale
Invoke-RestMethod https://desktop-efn2g33.tail276cda.ts.net/health
```

To remove a client's managed address block, run the following while the app is
closed and its installed resources still exist; the helper requests elevation
when needed and removes only its own block:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\HasarBotu\resources\initialize-office-connection.ps1" -Remove
```

The uninstaller does not remove this system-wide block automatically. To retire
the gateway, first remove managed client blocks (or arrange a replacement route),
then stop/uninstall only `hasarbotu-lan-https` and remove its named firewall rule.
Keep the API, agent, database and Tailscale services intact.

## Archived public release validation: 0.1.15

Installer: **102,670,139 bytes**, SHA-256
`e43f1b21f4536087a22ee3d8a42faee7585890a80b2552d6c3e60adad11485f1`.
143 desktop tests passed, including real Electron tests against an isolated test
database; 11 Windows hosts preservation/conflict checks passed. Both existing
computers run 0.1.15 with their original profiles and verified packaged resources.
Fresh isolated profiles on both computers selected the packaged default without
an API environment override and reached the production HTTPS API. Direct office
LAN TLS, hostname rejection, Google availability and anonymous access rejection
passed. The public installer and checksum were downloaded without authentication
and verified. These checks do not represent a new real-account Google login.
