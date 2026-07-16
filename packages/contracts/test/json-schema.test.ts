import { describe, expect, it } from 'vitest'
import { JSON_SCHEMA_TARGETS, buildJsonSchemas } from '../src/index.js'

describe('JSON Schema uretimi', () => {
  it('beklenen hedef semalari icerir', () => {
    expect(Object.keys(JSON_SCHEMA_TARGETS).sort()).toEqual([
      'agent-register-response',
      'audit-events-query',
      'audit-events-response',
      'auth-login-request',
      'auth-session-response',
      'case-close-plan-request',
      'case-create-request',
      'case-detail-params',
      'case-detail-response',
      'case-lifecycle-operation-response',
      'case-location-assign-request',
      'case-location-history-response',
      'case-location-response',
      'case-reopen-plan-request',
      'case-update-request',
      'cases-list-response',
      'cases-query',
      'document-detail-response',
      'document-register-request',
      'document-requirements-params',
      'document-requirements-response',
      'documents-list-response',
      'failure-envelope',
      'file-operation-plan-request',
      'file-operation-response',
      'health-response',
      'job-claim-response',
      'job-result-request',
      'pdf-extraction-chunk-request',
      'pdf-text-extraction-cancel-request',
      'pdf-text-extraction-create-request',
      'pdf-text-extraction-response',
      'pdf-text-pages-response',
      'pdf-text-segments-response',
      'pdf-text-source-reference-request',
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
      'workspace-plan-request',
      'workspace-provisioning-response',
    ])
  })

  it('deterministiktir: tekrar uretim ayni ciktiyi verir', () => {
    const first = buildJsonSchemas()
    const second = buildJsonSchemas()
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('cikti anahtarlari ada gore siralidir', () => {
    const keys = Object.keys(buildJsonSchemas())
    expect(keys).toEqual([...keys].sort())
  })

  it('uretilen JSON Schema JSON-serialize edilebilir ve JSON Schema surumu tasir', () => {
    const schemas = buildJsonSchemas()
    for (const schema of Object.values(schemas)) {
      const asRecord = schema as Record<string, unknown>
      expect(typeof asRecord.$schema).toBe('string')
      expect(() => JSON.stringify(schema)).not.toThrow()
    }
  })

  it('strict object semasi additionalProperties:false uretir', () => {
    const schemas = buildJsonSchemas()
    const query = schemas['cases-query'] as { additionalProperties?: unknown }
    expect(query.additionalProperties).toBe(false)
  })
})
