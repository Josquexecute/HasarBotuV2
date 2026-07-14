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
      'case-create-request',
      'case-detail-params',
      'case-detail-response',
      'case-location-assign-request',
      'case-location-history-response',
      'case-location-response',
      'case-update-request',
      'cases-list-response',
      'cases-query',
      'document-detail-response',
      'document-register-request',
      'document-requirements-params',
      'document-requirements-response',
      'documents-list-response',
      'failure-envelope',
      'health-response',
      'job-claim-response',
      'job-result-request',
      'photo-register-request',
      'photos-list-response',
      'storage-roots-response',
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
