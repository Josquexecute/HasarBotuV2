import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildJsonSchemas, type JsonSchemaName } from '../src/index.js'

/**
 * Golden JSON Schema regresyon testi.
 *
 * Uretilen semalar `test/fixtures/json-schema` altindaki commit edilmis canonical
 * fixture'larla karsilastirilir. Zod surumu veya sema tanimi degisip cikti
 * degisirse bu test KIRILIR; sessiz sozlesme kaymasi yayilamaz.
 *
 * Fixture guncellemesi yalnizca acik komutla yapilir:
 *   npm run schema:fixtures --workspace @hasarbotu/contracts
 * Normal test kosusu fixture'lari asla yeniden yazmaz.
 */
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'json-schema')

const EXPECTED_NAMES: readonly JsonSchemaName[] = [
  'agent-register-response',
  'audit-events-query',
  'audit-events-response',
  'auth-login-request',
  'auth-session-response',
  'case-close-plan-request',
  'case-closure-fee-response',
  'case-create-request',
  'case-detail-params',
  'case-detail-response',
  'case-lifecycle-operation-response',
  'case-location-assign-request',
  'case-location-history-response',
  'case-location-response',
  'case-note-create-request',
  'case-note-response',
  'case-operations-response',
  'case-reopen-plan-request',
  'case-summary-report-response',
  'case-task-cancel-request',
  'case-task-complete-request',
  'case-task-create-request',
  'case-task-response',
  'case-update-request',
  'cases-list-response',
  'cases-query',
  'closure-fee-approve-request',
  'closure-fee-candidate-create-request',
  'closure-fee-correct-request',
  'closure-fees-list-response',
  'dashboard-response',
  'document-detail-response',
  'document-register-request',
  'document-requirements-params',
  'document-requirements-response',
  'documents-list-response',
  'email-ai-plan-request',
  'email-ai-plan-response',
  'email-ai-run-response',
  'email-ai-runs-response',
  'email-ai-start-request',
  'email-draft-create-request',
  'email-draft-handoff-request',
  'email-draft-handoff-response',
  'email-draft-preview-request',
  'email-draft-preview-response',
  'email-draft-response',
  'email-draft-revise-request',
  'email-draft-workspace-response',
  'failure-envelope',
  'file-operation-plan-request',
  'file-operation-response',
  'health-response',
  'job-claim-response',
  'job-result-request',
  'labor-ai-plan-request',
  'labor-ai-plan-response',
  'labor-ai-run-response',
  'labor-ai-runs-response',
  'labor-ai-start-request',
  'labor-allocation-analyze-request',
  'labor-allocation-apply-preview-request',
  'labor-allocation-apply-preview-response',
  'labor-allocation-run-response',
  'labor-allocation-workspace-response',
  'labor-dictionary-query',
  'labor-dictionary-response',
  'labor-sheet-create-request',
  'labor-sheet-response',
  'labor-sheet-revise-request',
  'labor-sheet-workspace-response',
  'operational-alerts-query',
  'operational-alerts-response',
  'pdf-extraction-chunk-request',
  'pdf-text-extraction-cancel-request',
  'pdf-text-extraction-create-request',
  'pdf-text-extraction-response',
  'pdf-text-pages-response',
  'pdf-text-segments-response',
  'pdf-text-source-reference-request',
  'pert-assessment-create-request',
  'pert-assessment-response',
  'pert-assessment-revise-request',
  'pert-assessment-workspace-response',
  'photo-register-request',
  'photos-list-response',
  'policy-ai-cancel-request',
  'policy-ai-candidate-review-request',
  'policy-ai-candidate-review-response',
  'policy-ai-candidates-response',
  'policy-ai-plan-request',
  'policy-ai-promotion-preview-response',
  'policy-ai-promotion-request',
  'policy-ai-promotion-response',
  'policy-ai-provider-output',
  'policy-ai-providers-response',
  'policy-ai-run-response',
  'policy-ai-start-request',
  'policy-ai-usage-response',
  'policy-analysis-approval-request',
  'policy-analysis-create-request',
  'policy-analysis-response',
  'policy-analysis-version-create-request',
  'policy-conflict-resolution-request',
  'policy-ocr-chunk-request',
  'policy-ocr-elements-response',
  'policy-ocr-pages-response',
  'policy-ocr-run-cancel-request',
  'policy-ocr-run-create-request',
  'policy-ocr-run-response',
  'policy-ocr-run-retry-request',
  'policy-ocr-source-reference-request',
  'policy-scenario-evaluate-request',
  'policy-scenario-evaluation-response',
  'reference-experts-response',
  'reference-insurers-response',
  'reference-services-query',
  'reference-services-response',
  'reference-users-response',
  'storage-roots-response',
  'traffic-value-loss-approve-request',
  'traffic-value-loss-closure-list-response',
  'traffic-value-loss-reject-request',
  'traffic-value-loss-report-generate-request',
  'traffic-value-loss-report-preview-request',
  'traffic-value-loss-report-preview-response',
  'traffic-value-loss-report-response',
  'traffic-value-loss-reports-response',
  'traffic-value-loss-response',
  'traffic-value-loss-submit-request',
  'traffic-value-loss-version-create-request',
  'traffic-value-loss-versions-response',
  'workspace-plan-request',
  'workspace-provisioning-response',
]

describe('golden JSON Schema fixtures', () => {
  it('fixture seti hedef sema adlariyla birebir eslesir', () => {
    const files = readdirSync(FIXTURE_DIR).sort()
    expect(files).toEqual(EXPECTED_NAMES.map((name) => `${name}.json`))
  })

  it.each(EXPECTED_NAMES)('%s uretimi golden fixture ile ayni', (name) => {
    const generated = buildJsonSchemas()[name]
    const fixtureRaw = readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')
    // Semantik karsilastirma: Windows checkout'ta CRLF farki bayt esitligini
    // bozabilir; JSON.parse sonrasi derin esitlik sozlesme kaymasini yakalar.
    expect(JSON.parse(fixtureRaw)).toEqual(generated)
  })

  it('runtime-only kurallar semada x-hasarbotu-runtime-validation ile isaretlidir', () => {
    const detail = buildJsonSchemas()['case-detail-response']
    const serialized = JSON.stringify(detail)
    expect(serialized).toContain('x-hasarbotu-runtime-validation')
    expect(serialized).toContain('calendar-date-validity')
    expect(serialized).toContain('plate-number-canonical-form')
  })

  it('policy AI runtime parity ve bounded normalized-value metadata tasir', () => {
    const schemas = buildJsonSchemas()
    const plan = JSON.stringify(schemas['policy-ai-plan-request'])
    const providerOutput = JSON.stringify(schemas['policy-ai-provider-output'])
    const providerAvailability = JSON.stringify(schemas['policy-ai-providers-response'])
    expect(plan).toContain('unique-source-selection')
    expect(providerOutput).toContain('unique-candidate-id')
    expect(providerOutput).toContain('max-object-properties-20')
    expect(providerOutput).toContain('"maxProperties":20')
    expect(providerAvailability).toContain('provider-availability-consistency')
    expect(providerAvailability).toContain('unique-provider-availability')
  })
})
