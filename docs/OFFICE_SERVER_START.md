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
`http://127.0.0.1:3100/health` to report `ok`. It starts the field photo portal,
office HTTPS, the file agent and folder discovery. Tailscale HTTPS proxies through
the field portal, so that service must start before HTTPS readiness is checked.
The helper verifies `/health` and `/field-health` over office HTTPS with normal
certificate validation, and checks that all seven services are still running.
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

Updated on 2026-10-18 to include the field portal dependency. The unchanged desktop
command opens the updated protected script. Recovery also removed three orphaned
listeners and one duplicate folder discovery worker: the new service processes
were exiting because the old processes still owned ports 3100, 3200 and LAN 443.
The initial termination of the service wrappers was not established by the logs.
The launcher intentionally continues to reject a stopped service even when an
orphaned process answers its health endpoint.

Validation: 15/15 dependency-free checks passed locally and on the office computer.
The installed launcher successfully started an intentionally stopped field portal
and reported all seven services ready. The previous script and desktop command
were preserved, and existing file permissions were retained. After 290 seconds of
observation, all seven services were still running, all three listeners belonged
to their service wrappers, only one discovery worker remained, and no new service
failures were recorded. All four local/private/public health checks and a repeated
launcher run passed. This operational
update is installed directly on the office server; the desktop update feed remains
at 0.1.44. No Windows reboot was performed.
Evidence: `.local/office-start-failure-20261018/installation-proof.json` and
`.local/office-start-failure-20261018/final-proof.json`.
