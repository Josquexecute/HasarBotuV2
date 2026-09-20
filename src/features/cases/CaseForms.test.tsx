import { describe, expect, it, vi } from 'vitest'
import { localDateSchema } from '@hasarbotu/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { SessionUser } from '../../data/authPort'
import { CaseCommandError, type CaseCommandPort, type CaseCreateInput, type CaseUpdateInput } from '../../data/commandPort'
import type { CaseReferenceDataPort } from '../../data/ports'
import type { CaseRecord } from '../../types/case'
import { CaseCreateModal } from './CaseCreateModal'
import { CaseEditModal } from './CaseEditModal'

const USER: SessionUser = {
  id: 'user-current',
  organizationId: 'org-1',
  email: 'operator@example.test',
  displayName: 'Operatör Kullanıcı',
  roles: ['case_manager'],
}

const REFERENCES: CaseReferenceDataPort = {
  getCaseReferences: async () => ({
    insurers: [{ id: 'insurer-1', name: 'Güven Sigorta' }],
    services: [{ id: 'service-1', name: 'Merkez Servis', serviceType: 'private', isActive: true, agreement: {
      status: 'eligible', agreementStatus: 'agreed', serviceType: 'private', operation: 'closure_documents',
      evaluationDate: '2026-07-10', dateSource: 'loss_date', isAuthorized: false, isInsurerAgreed: true,
      reason: 'İnsan onaylı aktif anlaşma bulundu.', ruleVersion: '2026.07.14.1', matchedAgreementIds: ['agreement-1'], requiresHumanReview: false,
    } }],
    users: [
      { id: USER.id, displayName: USER.displayName },
      { id: 'user-2', displayName: 'İkinci Kullanıcı' },
    ],
    experts: [{ id: 'expert-1', displayName: 'Uzman Eksper' }],
  }),
}

function record(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    caseId: 'case-created',
    plate: '34 MPA 764',
    officeNumber: '2026/41',
    noticeNumber: 'IHB-1',
    claimNumber: 'HSR-1',
    company: '—',
    type: 'Trafik',
    status: 'Açık',
    stage: 'Yeni İhbar',
    missingDocuments: 0,
    assignee: '—',
    expert: '—',
    service: '—',
    followUp: '—',
    followUpTone: 'normal',
    lastAction: '—',
    vehicle: '—',
    insured: '—',
    estimatedDamage: 0,
    notes: [],
    version: 1,
    workflowStage: 'new_notification',
    responsibleUserId: USER.id,
    serviceId: null,
    insurerId: null,
    followUpDate: null,
    ...overrides,
  }
}

function commandPort(options: {
  create?: (input: CaseCreateInput, key?: string) => Promise<CaseRecord>
  update?: (caseId: string, input: CaseUpdateInput) => Promise<CaseRecord>
} = {}): CaseCommandPort {
  return {
    createCase: options.create ?? vi.fn().mockResolvedValue(record()),
    updateCase: options.update ?? vi.fn().mockResolvedValue(record({ version: 2 })),
  }
}

function CreationResult() {
  const location = useLocation()
  const result = (location.state as { creationResult?: { caseId: string; officeNumber: string } } | null)?.creationResult
  return <div>SONUÇ {result?.officeNumber} {result?.caseId}</div>
}

function renderCreate(port: CaseCommandPort, unauthorized = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/dosyalar?yeni=true']}>
      <Routes>
        <Route path="/dosyalar" element={<CaseCreateModal currentUser={USER} onClose={vi.fn()} onUnauthorized={unauthorized} commandPort={port} referencePort={REFERENCES} />} />
        <Route path="/dosyalar/:caseId" element={<CreationResult />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CaseCreateModal gerçek API komut akışı', () => {
  it.each([
    ['Trafik', 'traffic'],
    ['Kasko', 'casco'],
  ] as const)('%s dosyası oluşturur; plakayı normalize eder ve backend sonucuna yönlenir', async (label, wireType) => {
    const create = vi.fn().mockResolvedValue(record({ type: label, plate: '34 MPA 764' }))
    renderCreate(commandPort({ create }))
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Dosya türü *'), label)
    await user.type(screen.getByLabelText('Plaka *'), '34mpa764')
    await user.click(screen.getByRole('button', { name: 'Dosyayı Oluştur' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ caseType: wireType, plate: '34 MPA 764' })
    expect(create.mock.calls[0]?.[1]).toEqual(expect.any(String))
    expect(await screen.findByText('SONUÇ 2026/41 case-created')).toBeInTheDocument()
  })

  it('aynı payload yeniden denendiğinde kararlı Idempotency-Key kullanır; çift gönderimi engeller', async () => {
    let resolveFirst: ((value: CaseRecord) => void) | undefined
    const pending = new Promise<CaseRecord>((resolve) => { resolveFirst = resolve })
    const create = vi.fn().mockReturnValue(pending)
    renderCreate(commandPort({ create }))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Plaka *'), '06abc123')
    await user.dblClick(screen.getByRole('button', { name: 'Dosyayı Oluştur' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Kaydediliyor…' })).toBeDisabled()
    resolveFirst?.(record())
    await screen.findByText(/SONUÇ/)

    const keys: string[] = []
    let call = 0
    const retrying = vi.fn(async (_input: CaseCreateInput, key?: string) => {
      keys.push(key ?? '')
      call += 1
      if (call === 1) throw new CaseCommandError('unavailable', 'network')
      return record()
    })
    renderCreate(commandPort({ create: retrying }))
    await user.type(screen.getAllByLabelText('Plaka *')[0] as HTMLInputElement, '34aaa111')
    await user.click(screen.getAllByRole('button', { name: 'Dosyayı Oluştur' })[0] as HTMLButtonElement)
    await screen.findByRole('alert')
    await user.click(screen.getAllByRole('button', { name: 'Dosyayı Oluştur' })[0] as HTMLButtonElement)
    await waitFor(() => expect(retrying).toHaveBeenCalledTimes(2))
    expect(keys[0]).toBe(keys[1])
  })

  it('backend validation hatasını alan bazlı ve teknik ayrıntısız gösterir', async () => {
    const create = vi.fn().mockRejectedValue(new CaseCommandError('validation', 'SQL stack secret', [
      { path: 'plate', code: 'invalid_plate_number' },
    ]))
    renderCreate(commandPort({ create }))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Plaka *'), 'AB')
    await user.click(screen.getByRole('button', { name: 'Dosyayı Oluştur' }))
    expect(await screen.findByText('Geçerli bir plaka girin.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Bazı alanlar kabul edilmedi')
    expect(screen.queryByText(/SQL|stack|secret/i)).not.toBeInTheDocument()
  })

  it('401 global login akışını tetikler; ağ/5xx hatasında mock sonuç üretmez', async () => {
    const unauthorized = vi.fn()
    renderCreate(commandPort({ create: vi.fn().mockRejectedValue(new CaseCommandError('unauthorized', 'raw')) }), unauthorized)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Plaka *'), '34bbb222')
    await user.click(screen.getByRole('button', { name: 'Dosyayı Oluştur' }))
    await waitFor(() => expect(unauthorized).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('alert')).toHaveTextContent('Oturumunuz sona erdi')
    expect(screen.queryByText(/Mock analiz/)).not.toBeInTheDocument()
  })

  it('eksper ve LocalDate alanlarını gerçek referans modeliyle sunar', async () => {
    renderCreate(commandPort())
    expect(await screen.findByRole('option', { name: 'Uzman Eksper' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Merkez Servis · Özel servis · seçili sigorta şirketiyle anlaşmalı' })).toBeInTheDocument()
    expect(screen.getByText(/Servis seçildiğinde tür ve sigorta şirketine özel anlaşma sonucu/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Hasar tarihi/)).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText(/^İhbar tarihi/)).toHaveAttribute('type', 'date')
  })
})

function renderEdit(port: CaseCommandPort, options: Partial<Parameters<typeof CaseEditModal>[0]> = {}) {
  const props = {
    item: record(),
    currentUser: USER,
    onClose: vi.fn(),
    onUpdated: vi.fn(),
    onReload: vi.fn(),
    onUnauthorized: vi.fn(),
    commandPort: port,
    referencePort: REFERENCES,
    ...options,
  }
  render(<CaseEditModal {...props} />)
  return props
}

describe('CaseEditModal optimistic locking akışı', () => {
  it('keeps imported fields readonly and submits service changes only through the pencil dialog', async () => {
    const eksist = { sourceId: 'source-1', assignmentDate: localDateSchema.parse('2026-09-18'), assignmentDateText: '18.09.2026 09:30:00', insurerName: 'Kaynak Sigorta', expertName: 'Kaynak Eksper', expertLicenseNumber: 'E12345', corporateExpertLicenseNumber: '', serviceName: 'Kaynak Servis', serviceRevised: false, vehicleFields: {} }
    const update = vi.fn().mockResolvedValue(record({ version: 2, eksist: { ...eksist, serviceName: 'Yeni Servis', serviceRevised: true } }))
    renderEdit(commandPort({ update }), { item: record({ eksist }) })
    const user = userEvent.setup()
    for (const label of ['İhbar numarası', 'Sigorta şirketi', 'Eksper', 'Servis']) expect(screen.getByLabelText(label)).toHaveAttribute('readonly')
    await user.click(screen.getByRole('button', { name: 'Servisi revize et' }))
    await user.clear(screen.getByLabelText('Servis adı'))
    await user.type(screen.getByLabelText('Servis adı'), 'Yeni Servis')
    await user.click(screen.getByRole('button', { name: 'Revizyonu uygula' }))
    expect(update).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Değişiklikleri Kaydet' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('case-created', { expectedVersion: 1, serviceRevision: { name: 'Yeni Servis' } }))
  })
  it('yalnız desteklenen alanları expectedVersion ile günceller ve server version sonucunu taşır', async () => {
    const update = vi.fn().mockResolvedValue(record({ version: 2, workflowStage: 'inspection_pending', stage: 'Ekspertiz Bekliyor' }))
    const props = renderEdit(commandPort({ update }))
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Workflow aşaması'), 'inspection_pending')
    expect(screen.getByLabelText(/^Takip tarihi/)).toHaveAttribute('readonly')
    await user.click(screen.getByRole('button', { name: 'Değişiklikleri Kaydet' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('case-created', expect.objectContaining({
      expectedVersion: 1,
      workflowStage: 'inspection_pending',
    }))
    expect(update.mock.calls[0]![1]).not.toHaveProperty('followUpDate')
    expect(props.onUpdated).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }))
  })

  it('plaka, tür, ofis numarası ve lifecycle alanlarını değiştirilemez gösterir', () => {
    renderEdit(commandPort())
    for (const label of ['Plaka', 'Dosya türü', 'Ofis dosya numarası', 'Yaşam döngüsü']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('readonly')
    }
    expect(screen.queryByRole('button', { name: 'Dosyayı Kapat' })).not.toBeInTheDocument()
  })

  it('stale expectedVersion 409 çatışmasını açıklar ve yeniden yükleme sunar', async () => {
    const props = renderEdit(commandPort({ update: vi.fn().mockRejectedValue(new CaseCommandError('version_conflict', 'raw stack')) }))
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Workflow aşaması'), 'reporting')
    await user.click(screen.getByRole('button', { name: 'Değişiklikleri Kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('başka bir işlemle güncellendi')
    expect(screen.queryByText(/raw stack/)).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Güncel Veriyi Yükle' }))
    expect(props.onReload).toHaveBeenCalledTimes(1)
  })

  it('tenant dışı referansı alan bazlı güvenli reddeder', async () => {
    const update = vi.fn().mockRejectedValue(new CaseCommandError('unknown_reference', 'foreign tenant SQL', [
      { path: 'serviceId', code: 'unknown_reference' },
    ]))
    renderEdit(commandPort({ update }))
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Servis'), 'service-1')
    await user.click(screen.getByRole('button', { name: 'Değişiklikleri Kaydet' }))
    expect(await screen.findByText('Bu kayıt organizasyonunuzda bulunamadı.')).toBeInTheDocument()
    expect(screen.queryByText(/SQL|foreign tenant/i)).not.toBeInTheDocument()
  })
})
