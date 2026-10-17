# Shared account names and management access

Desktop 0.1.39 restricts the Management page to administrators. Both the sidebar
and direct page access enforce this rule; administrative APIs retain their server
role checks. Other users edit their own name under **Ayarlar → Hesabım**.
Administrators can edit any account's name under **Yönetim → Kullanıcılar →
Ad Soyadı Düzenle**, including pending and disabled accounts. Name edits preserve
roles, account status, email and identity. The sidebar footer shows the name once,
without the former role subtitle.

`GET/PATCH /api/v1/me/profile` provides authenticated self-service, including the
read-only role. `PATCH /api/v1/users/:userId/profile` requires an administrator in
the target organization. Requests validate names and compare account versions;
concurrent edits return a conflict instead of silently replacing another edit.
Writes and actor-attributed audit events commit together. Unchanged names are a
no-op. Existing account records require no migration.

Names live in the central user record. Active clients check the shared directory
every 15 seconds and on focus, then refresh affected sessions, lists and reference
labels when it changes. Existing linked user IDs resolve to the current name;
external expert labels remain the fallback for unlinked imported records. Hidden
clients catch up when visible. This synchronization requires server connectivity.

Regression tests cover all roles, cross-organization isolation, malformed input,
role injection, concurrent updates, disabled accounts and audit rollback. A real
Electron test uses two independently authenticated clients against the shared
PostgreSQL database: an administrator edits a coworker's name, the other client's
sidebar and case owner refresh, and a self edit reaches the open administrator
list. It also checks direct page denial, API denial, role preservation and light,
dark and narrow layouts. Synthetic accounts are confined to disposable databases.

Version 0.1.39 was published at 2026-10-17T16:44:51.460Z to the authenticated
office feed. The Windows x64 installer is 105,164,440 bytes, SHA-256
`6f38d673e0daf1744e8e71d67df56bf4e64c5656dda9a706438d335ac9e57a9d`.
The previous 0.1.38 manifest and immutable installer were preserved and verified.
The running installed 0.1.38 client's production update check returned `available`;
its authenticated download returned HTTP 200 and matched the exact size and hash.
Installation remains controlled by each client.

Validation recorded 2,785 passing tests: 2,765 workspace tests, 13 release/discovery
tests, one hidden-launcher regression and the six optional live HTTP tests run
separately. A fixture correction uses PostgreSQL's microsecond clock when testing
the inventory scan cutoff; a new boundary regression checks protection for cases
created during a scan. The affected full API suite and downstream suites were
rerun; already passing frontend/shared suites were retained. TypeScript, ESLint,
builds, bundle limits, packaged startup and all 59 packaged UI files passed. The
independent two-client acceptance recorded 16 successful checks.

After a verified PostgreSQL backup, six built API/contract files were deployed
with their previous files preserved. No migration was needed. The installed
office administrator session verified both self-service and coworker name routes
using unchanged names; production people's names were not modified for testing.
Four office services are healthy, and the fresh inventory still verifies 607
folders. Temporary verification tasks and inspectors were removed.

Delivery evidence is recorded in `.local/profile-access-20261017/`, including
`final-validation.json`, `publication-proof.json`, `surface-client-proof.json`,
`final-health-proof.json`, `backend-proof.json` and the UI acceptance screenshots.
