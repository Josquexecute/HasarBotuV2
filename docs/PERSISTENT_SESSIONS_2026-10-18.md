# Persistent account sessions

Normal password and Google sign-ins no longer have the previous 12-hour server
timeout. A session remains valid until logout or server-side revocation. Disabled
accounts and current account permissions are still checked on each protected request;
password or account-status changes revoke sessions through a database trigger,
including changes made by administration tools. Reactivating an account does not
reactivate its old sessions. Profile name changes leave sessions open.

Migration `0063_persistent_sessions` makes `sessions.expires_at` nullable and converts
only currently valid, unrevoked sessions belonging to active accounts. Expired and
revoked sessions are retained without reactivation. Existing clients ignore the
expiration metadata and remain compatible; new session responses use `expiresAt: null`
to represent no server timeout. Explicit finite expiry remains supported for tests
and deliberately time-limited sessions.

The desktop's existing persistent Chromium profile retains the HttpOnly cookie across
normal application restarts. Persistent cookies receive a 400-day browser lifetime,
renewed by authenticated session bootstrap and focus refresh. Server sessions have
no time limit. Clearing the device's cookies/profile, reinstalling without retaining
the profile, or leaving it unused beyond the browser cookie lifetime requires login
again. Passwords and raw tokens are never stored in renderer localStorage.

Mobile sign-in with `rememberMe: false` continues to use a browser-session cookie;
the server stores this preference so bootstrap does not turn it into a persistent
cookie. `Secure`, `HttpOnly`, `SameSite=Strict`, account lockouts, role checks, and
audit records retain their existing behavior.

Version **0.1.43** was published to the authenticated office feed at
2026-10-17T23:00:49.782Z (2026-10-18 in Istanbul). The Windows x64 installer is
105,178,831 bytes, SHA-256
`414679fc69223acdba204349164cf3897797542aa01d3457ec92d80575985834`.
The previous 0.1.42 manifest and immutable installer were preserved.

Validation: 2,798 passing tests, TypeScript, ESLint, production builds, bundle
boundaries, Windows publisher integration and actual packaged startup. All 63
packaged UI files and the office connection profile matched the build. Six optional
frontend `LIVE_API_*` tests were skipped because their connection configuration was
not supplied; real PostgreSQL, HTTP and Electron authentication tests ran.
Regression coverage includes application and API restarts with the same Chromium
profile, old sessions, cookie renewal and browser-only consent, logout, expired
tokens, disabled accounts, password changes, migration repeatability and rollback.
Historical business-schema endpoint fixtures now run current authentication while
retaining their original business migration rollback guards.

The office migration followed a verified 25,288,240-byte PostgreSQL backup and
runtime backups. A diagnostic alias error caused the first deployment verification
to fail; automatic schema/runtime rollback restored all services. The alias was
corrected and the same validated runtime was successfully deployed using the
original preserved backups. Final verification matched all 25 deployed files and
confirmed five running services and healthy API/public field portal.

The running installed **0.1.42** client confirmed `expiresAt: null`, a renewed
persistent cookie, and update state `available` for 0.1.43. Its authenticated
download returned HTTP 200, all 105,178,831 bytes and the exact published SHA-256.
Installation was left to users. Temporary diagnostic tasks and inspectors were
removed.

Local evidence: `.local/persistent-sessions-20261018/`
(`final-validation.json`, `package-smoke.json`, `backend-proof.json`,
`migration-proof.json`, `publication-proof.json`, `final-client-proof.json`,
`final-office-proof.json`). Original database/runtime backups remain on the office
server under its corresponding private `office-management` directory.
