import { describe, expect, it, vi } from 'vitest'
import { createHttpLaborAllocationAdapter } from './laborAllocationPort'

/**
 * Paket 62 regresyonu — HTTP kablo seviyesi.
 *
 * `cancel` bir dönem gövdesiz POST gönderiyordu. İstek yine de
 * `content-type: application/json` taşıdığı için sunucu boş gövdeyi
 * ayrıştıramıyor ve 400 dönüyordu: iptal düğmesi gerçek API'ye karşı hiç
 * çalışmıyordu. Stub port kullanan bileşen testi bunu göremez, bu yüzden
 * kontrol kablo seviyesinde yapılır.
 */
const caseId = '018f3f4c-89ab-7def-8123-456789abcdef'
const runId = '018f3f4c-89ab-7def-8123-456789abcdea'

function runPayload() {
  return {
    run: {
      id: runId,
      caseId,
      status: 'cancelled',
      providerId: 'gemini-generate-content',
      providerVersion: 'gemini-generate-content/1.1.0',
      modelId: 'gemini-2.5-flash',
      promptTemplateVersion: 'labor-allocation-ai/2.0.0',
      outputSchemaVersion: 'labor-allocation-suggestion/2.0.0',
      operationTypesVersion: 'labor-operation-types/1.0.0',
      ruleVersion: 'labor-allocation-rules/1.0.0',
      sourceSheetId: '018f3f4c-89ab-7def-8123-456789abcdeb',
      sourceSheetVersion: 1,
      baselineSheetVersion: null,
      baselineMatchVersion: null,
      baselineMatchedLineCount: 0,
      evidenceHash: 'a'.repeat(64),
      planHash: 'b'.repeat(64),
      version: 1,
      privacy: {
        externalProvider: true,
        policyVersion: 'labor-allocation-pii-redaction/1.0.0',
        outboundPayloadHash: 'c'.repeat(64),
        outboundInputCharacters: 120,
        redactedValueCount: 0,
        redactedCategories: [],
        retentionMode: 'free_tier_product_improvement',
        warnings: [],
      },
      budget: {
        enabled: true,
        providerAvailable: true,
        providerAllowed: true,
        estimatedCostMinor: 1,
        currentMonthCostMinor: 1,
        monthlyBudgetMinor: 1_000_000,
        perRequestBudgetMinor: 1_000_000,
        allowed: true,
        reasonCode: null,
      },
      suggestion: null,
      safeErrorCode: 'AI_RUN_CANCELLED',
      stale: false,
      progress: {
        totalLineCount: 45,
        processedLineCount: 20,
        totalChunkCount: 3,
        completedChunkCount: 1,
        startedAt: '2026-07-20T09:00:00.000Z',
        updatedAt: '2026-07-20T09:00:12.000Z',
        cancelRequestedAt: '2026-07-20T09:00:11.000Z',
      },
      createdAt: '2026-07-20T09:00:00.000Z',
      startedAt: '2026-07-20T09:00:00.000Z',
      completedAt: '2026-07-20T09:00:12.000Z',
    },
  }
}

describe('AI dağıtımı HTTP adaptörü', () => {
  it('iptal isteğini ayrıştırılabilir gövdeyle gönderir', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(runPayload()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const adapter = createHttpLaborAllocationAdapter({ fetchImpl })

    const result = await adapter.cancel(caseId, runId)

    expect(result.status).toBe('cancelled')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/api/v1/cases/${caseId}/labor-allocation-ai/${runId}/cancel`)
    expect(init.method).toBe('POST')
    // JSON content-type gönderildiği sürece gövde boş bırakılamaz.
    const headers = init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(init.body).toBeDefined()
    expect(() => JSON.parse(String(init.body))).not.toThrow()
  })

  it('koşu durumunu ilerleme alanlarıyla birlikte okur', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(runPayload()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const adapter = createHttpLaborAllocationAdapter({ fetchImpl })

    const result = await adapter.readRun(caseId, runId)

    expect(result.progress.completedChunkCount).toBe(1)
    expect(result.progress.totalChunkCount).toBe(3)
    expect(result.progress.processedLineCount).toBe(20)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(url).toBe(`/api/v1/cases/${caseId}/labor-allocation-ai/${runId}`)
    expect(init?.method ?? 'GET').toBe('GET')
  })
})
