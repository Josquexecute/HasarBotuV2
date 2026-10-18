# Touch selected-case navigation

Touch previously retained a searched case for notes and process information, but
its native Open and Notifications commands carried only an action name. Open
restored the previous main-window page, and Notifications opened the general feed.

The authenticated Touch panel now passes its current selected case identity to
these two commands. Preload limits the argument type/length; the main process
validates the identity and constructs trusted local routes. It continues to accept
commands only from the shortcut panel's trusted top frame. No renderer-supplied URL
is accepted. With no authenticated selection, existing general commands remain.

- **Uygulamayı aç:** opens `/dosyalar/:caseId` for the selected search result.
- **Bildirimler:** opens `/bildirimler?caseId=:caseId`, identifies the selected plate
  and office number, and scopes inbox, operational alerts, and tracking to that case.
- Inbox pages, unread totals, and bulk read acknowledgments share the same server
  case filter. Operational bulk read also acknowledges only the selected case.
- **Tüm dosyaların bildirimleri** returns to the general notification view.

The scope survives page reload through the URL. Lookup/loading failures hide case
feeds and offer retry; they never silently show general or previous-case data.
Existing account, ownership, organization, archived-case, and operation permissions
remain authoritative on the server. The API changes are additive optional filters;
older installed clients retain their current behavior. No database migration is needed.

Regression coverage exercises native navigation from a different current case,
selection changes, anonymous commands, rejection of a URL used as case identity,
all notification sections, lookup failure/retry, filtering across inbox pages,
scoped unread totals, and read acknowledgments leaving another owned case unread.
The real production UI runs in Electron against an isolated PostgreSQL/API fixture;
notification and alert screenshots cover a 390-pixel window.

Version **0.1.44** was published to the authenticated office update feed at
2026-10-18T06:34:02.741Z. The Windows x64 installer is 105,179,278 bytes, SHA-256
`234500cdbc2abeb995b151200041d1b74558001c81d3cd0b228579db8b2f7983`.
The previous 0.1.43 manifest and immutable installer were preserved.

Validation recorded 1,415 passing tests across the affected frontend, API and desktop
suites plus the Windows publisher integration test. Six optional frontend `LIVE_API_*`
tests were skipped because connection configuration was not supplied. TypeScript,
ESLint, production builds, bundle boundaries, actual packaged startup, all 63 packaged
UI files and the retained office connection profile passed. Real Electron acceptance
recorded 58 successful UI checks against an isolated PostgreSQL/API fixture.

The office API received nine verified runtime files after preserving the previous
files for rollback. No schema or database data migration was required. All five office
services, API health and the existing public field portal passed final checks.
The running installed 0.1.43 client reported 0.1.44 as `available`, accepted the new
case-filtered inbox query, and streamed all 105,179,278 installer bytes with HTTP 200
and the exact published SHA-256. Its account session remained valid without a server
timeout. Installation was left to users.

The older client's main renderer was found crashed during delivery, while its Touch
windows remained healthy. A reload limited to that confirmed crashed renderer restored
the same 0.1.43 application and authenticated session before acceptance completed.
This recovery does not establish the cause or a permanent fix for that earlier crash.
Temporary diagnostic tasks and inspectors were removed.

Local evidence: `.local/touch-case-navigation-20261018/`
(`final-validation.json`, `package-smoke.json`, `electron-evidence/results.json`,
`electron-evidence/touch-selected-case-notifications.png`,
`electron-evidence/touch-selected-case-alerts.png`, `backend-proof.json`,
`publication-proof.json`, `inspect-client-proof.json`, `final-client-proof.json`,
`final-office-proof.json`). Runtime backups remain in the matching private office
`office-management` directory.
