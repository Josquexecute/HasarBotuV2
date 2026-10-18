# Value loss calculator — 2026-10-18

## Behavior

The Traffic case's Value Loss tab now contains a compact calculator: vehicle and
damage inputs, affected parts, one Calculate action and the resulting TL amount.
Evidence uploads, comparables, review, report production and history panels have
been removed from this screen. Existing assessments, reports and their compatible
backend endpoints are preserved.

The calculator reuses the existing server rule snapshot and arithmetic, selected
by the entered accident date. It does not create an assessment, approval or report.
Input errors still prevent an amount. Inputs and the result survive navigation
within the window, scoped to the organization, user and case. Editing an input
immediately clears the old amount; outdated responses cannot restore it.

The user explicitly confirmed that value loss must be optional for closing a case.
Normal closure no longer requires a value loss report or its approval. Explicit
approval of the actual close operation, other closure requirements, authorization,
audit and physical file verification remain enforced. Historical value loss
metadata is retained. No database migration or business-data conversion is needed.

## Validation

- Typecheck, ESLint and full production build: PASS on Node 24.21.0.
- Frontend: 563 tests passed, plus 2 real PostgreSQL/File Agent UI tests passed
  separately. Six opt-in LIVE acceptance tests were not run. The DB UI run first
  timed out waiting for its provisioning message; a diagnostic rerun passed both
  tests without changing product or test source.
- API: 705/705; contracts: 304/304; domain: 651/651 passed.
- Regression coverage verifies a normal closure without any value loss record
  through explicit approval and the real File Agent, read-only calculator requests,
  role and tenant boundaries, existing-engine equivalence, part errors, money input,
  navigation, account/case isolation and stale-response rejection.
- Real built UI → desktop bridge → authenticated API → disposable PostgreSQL:
  9/9 checks passed. A synthetic calculation displayed **₺57,000.00**. Navigation
  retained the input/result; changing input cleared the result; the calculator had
  no internal horizontal overflow at 1024, 768 and 390 pixels; no JS errors or
  assessment/report writes occurred. Desktop screenshot was visually inspected.
- Actual packaged Windows x64 startup passed: version 0.1.46, 60 packaged UI files,
  office profile, bridge serving packaged UI and close-to-tray behavior verified.
  The real Windows release publisher integration test passed (1/1).

Private logs, screenshots and acceptance proofs are under
`.local/value-loss-simple-20261018/` and `.local/value-loss-calculator-browser/`.

## Office delivery

- Authenticated office feed: **0.1.46**, published **2026-10-18T07:58:38.939Z**
  (10:58 Europe/Istanbul).
- Windows x64 NSIS installer: **105,170,166 bytes**.
- SHA-256: `664dd0a1e2401b4a39e17b0d05e2ce85482fd76ac6295237787a6a90dab1d3ba`.
- 24 compiled API/contract/domain files deployed with verified hashes and a
  recoverable runtime backup. No database changes were made.
- The existing authenticated **0.1.45** client successfully calculated
  **5,700,000 kuruş** using synthetic inputs through the real office gateway.
  No real case business record was modified.
- That older installed client's production update check reported **available,
  0.1.46**. Its complete authenticated download returned HTTP 200 and matched the
  exact size and SHA-256 above.
- Previous 0.1.45 manifest and immutable installer preserved. Installation was not
  forced. All seven office services, private HTTPS and public field health passed;
  temporary diagnostics were removed and the inspector was closed.

Users obtain the new screen from **Ayarlar → Uygulama güncellemeleri → Güncellemeleri
kontrol et → Güncelle ve yeniden başlat**. The closure requirement correction is
already effective on the office server for existing clients.
