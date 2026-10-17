# Office folder corrections · 2026-10-17

The user's explicit office-only policy is now deployed. Discovery scans existing
top-level `YYYY OFİS` folders, including future years, and excludes remote groups.
It requires two complete, consistent filesystem/pCloud observations and a final
revalidation before reversible archive/status updates. Source files remain read-only.

- Registered 375 previously observed source identities using the protected prior
  inventory's exact path and pCloud ID, rechecked against the current source.
- Relocated 299 existing records after closed-container renames, preserving their
  IDs, children, document history and assignments.
- Corrected 21 physical open/closed mismatches without inventing closure dates.
- Archived 30 deleted, out-of-scope or unbound records without deleting their data.
  `72ACL481` now has one visible record; the three explicitly deleted plates have none.
- The authenticated installed client returned 607 visible cases and resolved all
  607 real office folders using the packaged resolver and corrected company root.
  The separately requested remote-container path also resolved; it remains excluded
  from the office-only list.
- Dashboard, fee lists, period totals and closure summaries exclude archived cases.
- Source refresh tasks now start through the checked-in VBS launcher with window
  style 0, retaining exit codes, task principals, triggers and source validation.
  The real pending task completed successfully after the change.

Version **0.1.38** was published to the existing authenticated office feed at
2026-10-17T12:26:44.226Z. The previous 0.1.37 manifest and immutable installer were
preserved. The installed 0.1.37 client returned `available` and downloaded all
105,162,643 bytes with HTTP 200 and the exact published SHA-256. Installation was
not forced.

Validation: 2,751 broad tests passed; the six optional live HTTP tests were then
run against an isolated authenticated fixture and passed. The final affected API
suite passed 43 tests. TypeScript, ESLint, production build, Windows publisher and
actual packaged Electron startup passed; all 59 packaged UI files matched the build.
The real background discovery test covered future office years, stable-ID moves,
physical closure, duplicate hiding and deletion. No database migration was required.

Private evidence: `.local/folder-fixes-20261017/` (database backup, deployment
plans, repair proof, validation logs, authenticated client proof, publication and
health proofs). Temporary verification tasks and inspector listeners are removed
after their checks; long-running office services retain their normal configuration.
