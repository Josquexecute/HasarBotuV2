# Windows distribution and office HTTPS

Release **0.1.15** is available from one stable public link:
[HasarBotu-Kurulum.exe](https://github.com/Josquexecute/HasarBotu-Downloads/releases/latest/download/HasarBotu-Kurulum.exe).
The public `Josquexecute/HasarBotu-Downloads` repository contains installers,
checksums and installation instructions. `Josquexecute/HasarBotuV2` remains private.

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
npm run build
npm run package:win --workspace @hasarbotu/desktop
node scripts/publish-desktop-github-release.mjs Josquexecute/HasarBotu-Downloads apps/desktop/release/HasarBotu-Setup-0.1.15.exe 0.1.15 release-notes.md
```

The GitHub publisher verifies executable version metadata, SHA-256, length, and
both uploaded assets. It creates a **draft** and refuses replacing an existing
artifact with different bytes. After package and installation acceptance, publish:

```powershell
gh release edit v0.1.15 --repo Josquexecute/HasarBotu-Downloads --draft=false --latest
```

Publish the same verified installer to the authenticated office update directory
with `scripts/publish-desktop-release.mjs` as documented in `DESKTOP_UPDATES.md`.
The public asset name stays `HasarBotu-Kurulum.exe` across versions. Verify an
anonymous download through the stable link, including its actual hash and length.
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

## Validated release

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
