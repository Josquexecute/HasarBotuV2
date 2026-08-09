import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KascoMandatoryCheckModule } from './KascoMandatoryCheckModule'

const CASE_ID = '019f6100-0000-7000-8000-000000000001'
const DOCUMENT_ID = '019f6100-0000-7000-8000-000000000002'
const VERSION_ID = '019f6100-0000-7000-8000-000000000003'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const CHECK_DEFS = [
  { code: 'driver_registration_owner_match', kind: 'comparison', validResults: ['same', 'different', 'unknown'], label: 'Sürücü ile ruhsat sahibi karşılaştırması' },
  { code: 'driver_license_restriction_codes', kind: 'presence', validResults: ['present', 'absent', 'unclear'], label: 'Ehliyet 12. alan kısıtlama kodları' },
  { code: 'policyholder_registration_owner_match', kind: 'comparison', validResults: ['same', 'different', 'unknown'], label: 'Poliçe sahibi ile ruhsat sahibi karşılaştırması' },
  { code: 'occupation_information', kind: 'presence', validResults: ['present', 'absent', 'unclear'], label: 'Meslek bilgisi' },
  { code: 'equivalent_parts_clause', kind: 'presence', validResults: ['present', 'absent', 'unclear'], label: 'Eşdeğer parça klozu' },
  { code: 'service_deductible_clause', kind: 'presence', validResults: ['present', 'absent', 'unclear'], label: 'Servis muafiyeti klozu' },
  { code: 'market_value_general_deductible', kind: 'presence', validResults: ['present', 'absent', 'unclear'], label: 'Rayiç bedeli üzerinden genel muafiyet' },
] as const

function makeCheck(code: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const def = CHECK_DEFS.find((item) => item.code === code)!
  return {
    checkCode: code, label: def.label, description: `${def.label} açıklaması`, kind: def.kind, validResults: def.validResults,
    status: 'missing', reason: 'Henüz onaylanmadı.', version: 1, requiresHumanReview: false,
    aiSuggestedResult: null, aiConfidenceBasisPoints: null, aiEvidence: null, aiGeneratedAt: null,
    confirmedResult: null, confirmedEvidence: null, confirmedReason: null, confirmedByUserId: null, confirmedByDisplayName: null, confirmedAt: null,
    ...overrides,
  }
}

function makeGate(options: { canWrite?: boolean } = {}): Record<string, unknown> {
  const checks = CHECK_DEFS.map((def) => makeCheck(def.code))
  return {
    caseId: CASE_ID, applicable: true, ruleVersion: '2026.08.09.1', checks,
    missingCount: 7, controlRequiredCount: 0, needsReviewCount: 0, resolvedCount: 0, incomplete: true,
    permissions: { canWrite: options.canWrite ?? true },
  }
}

function successFetch(gate: Record<string, unknown>, onConfirm?: (code: string, body: unknown) => void): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/kasco-mandatory-checks') && url.includes('/history')) return jsonResponse(200, { items: [] })
    if (url.includes('/kasco-mandatory-checks') && method === 'PUT') {
      const code = url.split('/kasco-mandatory-checks/')[1] as string
      const body = init?.body === undefined ? {} : JSON.parse(String(init.body)) as Record<string, unknown>
      onConfirm?.(code, body)
      const checks = gate.checks as Record<string, unknown>[]
      const check = checks.find((item) => item.checkCode === code)!
      return jsonResponse(200, {
        check: {
          ...check, confirmedResult: body.result, confirmedEvidence: body.evidence, confirmedReason: body.reason ?? null,
          confirmedByUserId: 'user-1', confirmedByDisplayName: 'Test Kullanıcı', confirmedAt: '2026-08-09T09:00:00.000Z',
          status: 'resolved', reason: 'Kanıtlı sonuç kaydedildi.', version: (check.version as number) + 1,
        },
      })
    }
    if (url.includes('/kasco-mandatory-checks')) return jsonResponse(200, { gate })
    if (url.includes('/document-requirements')) {
      return jsonResponse(200, {
        caseId: CASE_ID, caseType: 'casco', ruleSetVersion: '2026.07.14.1', overallStatus: 'present',
        requirements: [], alternativeGroups: [], missingCount: 0, controlRequiredCount: 0, evaluatedAt: '2026-08-09T08:00:00.000Z',
      })
    }
    if (url.includes(`/documents/${DOCUMENT_ID}`)) {
      return jsonResponse(200, {
        document: {
          documentType: 'casco_registration',
          versions: [{
            id: VERSION_ID, documentId: DOCUMENT_ID, versionNumber: 1, originalFileName: 'ruhsat.pdf', displayName: 'Ruhsat',
            mimeType: 'application/pdf', byteSize: 1024, contentHash: 'a'.repeat(64), relativePath: 'EVRAK/ruhsat.pdf',
            status: 'ready', hashVerified: true, sizeVerified: true, verifiedAt: '2026-08-09T08:00:00.000Z',
          }],
        },
      })
    }
    if (url.includes('/documents?')) {
      return jsonResponse(200, { items: [{ id: DOCUMENT_ID, documentType: 'casco_registration' }], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } })
    }
    if (url.includes('/photos?')) return jsonResponse(200, { items: [], pageInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 } })
    return jsonResponse(404, {})
  }) as unknown as typeof fetch
}

afterEach(() => vi.restoreAllMocks())

describe('KascoMandatoryCheckModule', () => {
  it('7 kontrolü ve eksik özetini gösterir', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(successFetch(makeGate()) as never)
    render(<KascoMandatoryCheckModule caseId={CASE_ID} source="api" />)
    await waitFor(() => expect(screen.getByText('Zorunlu Kasko Kontrolü')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getAllByText('Eksik')).toHaveLength(7)
    expect(screen.getByText(/7 eksik/)).toBeInTheDocument()
  })

  it('kesin sonuç kanıtsız kaydedilemez -- istemci tarafında engellenir', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(successFetch(makeGate()) as never)
    render(<KascoMandatoryCheckModule caseId={CASE_ID} source="api" />)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByText('Zorunlu Kasko Kontrolü')).toBeInTheDocument(), { timeout: 3000 })
    await user.click(screen.getAllByRole('button', { name: 'Kontrolü Kaydet' })[0]!)
    await user.selectOptions(screen.getByLabelText('Sonuç'), 'same')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByText(/kanıt belgesi zorunludur/)).toBeInTheDocument()
  })

  it('kanıtlı kesin sonuç PUT ile doğru gövdeyle kaydedilir', async () => {
    const onConfirm = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementation(successFetch(makeGate(), onConfirm) as never)
    render(<KascoMandatoryCheckModule caseId={CASE_ID} source="api" />)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByText('Zorunlu Kasko Kontrolü')).toBeInTheDocument(), { timeout: 3000 })
    await user.click(screen.getAllByRole('button', { name: 'Kontrolü Kaydet' })[0]!)
    await user.selectOptions(screen.getByLabelText('Sonuç'), 'same')
    await user.selectOptions(screen.getByLabelText('Kanıt belgesi'), `${DOCUMENT_ID}|${VERSION_ID}`)
    await user.type(screen.getByLabelText('Sayfa'), '1')
    await user.type(screen.getByLabelText('Bölüm / madde'), 'Ruhsat sahibi')
    await user.type(screen.getByLabelText('Kanıt alıntısı'), 'Ruhsat sahibi ile sürücü aynı')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('driver_registration_owner_match', expect.objectContaining({
      result: 'same',
      evidence: { documentId: DOCUMENT_ID, documentVersionId: VERSION_ID, page: 1, section: 'Ruhsat sahibi', excerpt: 'Ruhsat sahibi ile sürücü aynı' },
      expectedVersion: 1,
    })))
    expect(await screen.findByText(/kaydedildi/)).toBeInTheDocument()
  })

  it('canWrite=false salt-okunur gösterir; kaydet butonu yok', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(successFetch(makeGate({ canWrite: false })) as never)
    render(<KascoMandatoryCheckModule caseId={CASE_ID} source="api" />)
    await waitFor(() => expect(screen.getByText('Zorunlu Kasko Kontrolü')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByRole('button', { name: 'Kontrolü Kaydet' })).not.toBeInTheDocument()
  })
})
