# Office server desktop launcher

On **DESKTOP-EFN2G33**, double-click **HasarBotu Sunucuyu Başlat.cmd** on the
desktop and approve the Windows administrator prompt. The result window stays
open until Enter is pressed. `SUNUCU HAZIR` confirms service and HTTP readiness.

The shared desktop file is installed at
`C:\Users\Public\Desktop\HasarBotu Sunucuyu Başlat.cmd`. It uses `RunAs` to open
Windows PowerShell with the protected implementation at
`C:\ProgramData\HasarBotu\office-management\server-start\start-office-server.ps1`.
Only administrators and SYSTEM can modify these installed files; ordinary users
can read and execute them. Windows UAC remains enabled.

The helper starts PostgreSQL 17, Tailscale and the API, then waits for
`http://127.0.0.1:3100/health` to report `ok`. It starts office HTTPS, the file
agent and folder discovery, verifies the office HTTPS health endpoint with normal
certificate validation, and checks that all six services are still running.
Already-running services are retained. Service waits and HTTP readiness waits
are bounded; failures appear in red and return a nonzero exit code.

The latest result is recorded beside the protected script in `last-start.json`.
The helper's source and dependency-free tests are in `deploy/windows-service/`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/windows-service/start-office-server.tests.ps1
```

Installed and checked on 2026-10-17: the actual elevated helper verified all six
services, API health and office HTTPS health. The tests exercise stopped,
already-running and pending services, automatic-start races, startup failures,
HTTP readiness/timeout and the administrator launch command. This acceptance
used the running office computer; a Windows reboot was not performed.
Deployment evidence: `.local/server-start-help-20261017/installation-proof.json`.
