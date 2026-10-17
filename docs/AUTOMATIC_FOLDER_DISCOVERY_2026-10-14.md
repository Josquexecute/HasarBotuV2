# Automatic pCloud folder registration

Automatic discovery is enabled on the office server as
**hasarbotu-folder-discovery**. It works with the existing **0.1.15** clients;
no new installer is required for this server feature.

## Office behavior

The service scans the configured pCloud source every **30 seconds**. A new folder
whose name contains one unambiguous valid plate is registered after two
consistent observations of its pCloud folder ID, path and sidecar state.
Usually this takes **30–60 seconds after the folder becomes accessible and its
pCloud identity is available**. Offline storage or an unfinished pCloud identity
delays registration; the service does not invent a source ID.

New cases receive an office number, source location, **Ömer Faruk** as the default
responsible person and the configured active expert. Their type initially remains
**Seçiniz**, for an authorized user to choose. The normal file agent receives a
location verification job. Creating a case does not mark its documents verified.

The new case is returned by subsequent case-list and plate-search API requests.
An already displayed list uses its existing refresh/navigation behavior; this
change does not add live updates to an open list. Touch plate searches query the
server and can find the new record. Existing role permissions still apply.

As of 2026-10-17, the office uses the explicitly authorized
`officeInventoryOnly: true` policy with `trackRegisteredMoves: true` and no
`yearFolder`. Both registration and move tracking scan only top-level `YYYY OFİS`
directories, including future years. Remote groups and bare year folders are
excluded. After two identical complete inventories, revalidated against the
filesystem and pCloud, missing/out-of-scope and unbound case rows are archived
reversibly. Business records and children remain intact. Returning registered
folders may restore only archives made by this policy. An unavailable source or
missing cloud identity cannot trigger an archive. Active file, lifecycle and
workspace operations defer reconciliation.

The same policy reconciles open/closed status with physical `KAPALI` placement,
with an audit event and no fabricated closure timestamp, fee or document approval.
The last open stage is retained for an observed reopening. Generic deployments
retain the previous behavior below unless this policy is explicitly enabled.

Registration uses stable **pCloud folder IDs**, not plates alone. Repeated scans
and service restarts do not create duplicates. Separate source folders can
legitimately share a plate; their records are not merged. A folder associated with
an existing case location is skipped for creation. With the optional administrator
configuration `trackRegisteredMoves: true`, registered source IDs (including the
baseline) are also checked for moved directories. Two consistent observations,
an unchanged folder ID, an absent old directory and no active file operation
allow the existing audited relocation transaction to update only the location.
Notes, assignments and types remain intact. Without the office-only policy,
lifecycle states also remain intact. Completed-move
history keeps document paths and tracked-file approvals connected to the case.
An existing old directory, conflicting identity or active operation is deferred.
The status includes `relocated`, `relocationSettling` and `relocationDeferred`.
When `yearFolder` is set, it limits creation of new cases. With move tracking
enabled, registered IDs are also observed in other supported year/work-group
folders under the same source root. This follows existing folders moved between
office and remote groups without registering unrelated out-of-scope folders.
`registeredMoveScanFolders` reports the wider inventory size. An identical plate,
shared document or copied V1 sidecar does not authorize a move: the registered
pCloud folder ID must remain unchanged and the old path must be absent.
A recognized V1 identity already attached
to another case is deferred for reconciliation rather than duplicated.

The 596 already linked source folders form the approved initial baseline.
They are not reimported by this feature. Existing types, owners, notes, tasks and
lifecycle states are retained. New folders physically under a closed container
are registered as closed without inventing a historical closing date. Moving an
existing folder into a closed container does not close its existing case.

Historical V1 notes/tasks remain subject to the separate validated import
workflow. A new case with a sidecar is marked as having pending historical data;
the discovery worker does not silently import or overwrite that history. The
previous seven source exceptions remain separate. Ambiguous/malformed folder
names are not guessed.

## Operation and authorization

The independent Windows service starts automatically with delay and depends on
the API. It runs the API's existing transaction, audit and source-registration
code from a centrally controlled deployment worker. The file agent continues to
use its API-only job protocol; it does not acquire direct database access.
An active administrator approves the persistent policy, which names the active
default responsible user and expert. Their roles are rechecked before creation.

Configuration and status are administrator/SYSTEM-only under
`C:\ProgramData\HasarBotu\automatic-folders-20261014`:

- `config.json`: source connection, approved baseline IDs, assignments and policy.
- `status.json`: latest scan time, creation/defer counts and safe error codes.
- WinSW logs: state changes and service failures, without credentials or source names.

The worker reads the pCloud SQLite inventory through the existing consistent
read-only snapshot helper, validates source directories without following links,
and checks identity again immediately before the case transaction. It writes no
source documents or sidecars. Unavailable sources produce a blocked status;
unexpected database/programming failures stop the worker and are recorded as
failures rather than successful scans. Every created case has audit/provenance
records and a queued verification job.

Check or temporarily disable only this new service:

```powershell
Get-Service hasarbotu-folder-discovery
Get-Content C:\ProgramData\HasarBotu\automatic-folders-20261014\status.json
Stop-Service hasarbotu-folder-discovery
Set-Service hasarbotu-folder-discovery -StartupType Disabled
```

Disabling discovery does not delete cases or stop the API, document agent,
database, HTTPS gateway or source/backup schedules. To resume, set its startup
type to Automatic and start it. Retain the original baseline when changing
assignments or redeploying; replacing it with all current source IDs could hide
new folders that have not yet been registered.

Source implementation: `services/api/src/cases/automatic-folder-registration.ts`,
`deploy/windows-service/automatic-folder-discovery.mjs` and its PowerShell launcher.
The CLI takes the absolute config path; `--once` performs one observation and is
not a shortcut around the two-observation rule. A launcher reads `DATABASE_URL`
from the protected machine configuration. Never put credentials in CLI arguments,
public release assets or the policy JSON.

## Validation

- **57 API tests** passed across six affected source/import test files with a real
  disposable PostgreSQL database; typecheck and scoped ESLint passed.
- A separate background-worker integration test used real filesystem folders,
  a synthetic pCloud SQLite inventory and another disposable PostgreSQL database.
  A folder added after startup was registered without a manual scan. Restarting
  preserved the record and a subsequently selected case type, with no duplicate.
  A missing source directory produced a blocked status and preserved the case.
- The actual office service scanned all **596** baseline folders and created
  **zero** duplicate cases. It was restarted and verified as one live worker.
  All **611 cases, 1,548 notes and 78 tasks** were preserved by row hashes.
  All **seven** production services remained Running. A fresh 128-table backup
  was taken before enabling discovery.

No synthetic case folder was created in the production pCloud source. The live
service is enabled for subsequent real folders; this report does not claim that
an unobserved future folder or a full Windows reboot has already been tested.
