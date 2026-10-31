import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NoticeSheetDataPort } from '../../data/noticeSheetPort'
import { NoticeSheetClientError } from '../../data/noticeSheetPort'
import { noticeSheetFixture } from '../../test/fixtures/notice-sheet'
import { NoticeSheetModal } from './NoticeSheetModal'

afterEach(() => { vi.restoreAllMocks() })

function setup(overrides: Partial<NoticeSheetDataPort> = {}, fixture = noticeSheetFixture) {
  const port: NoticeSheetDataPort = {
    read: vi.fn().mockResolvedValue(structuredClone(fixture)),
    save: vi.fn(async (_id, input) => ({ ...structuredClone(fixture), overrides: input.overrides, version: 1 })),
    ...overrides,
  }
  const onClose = vi.fn()
  render(<NoticeSheetModal caseId={fixture.caseId} port={port} onClose={onClose} />)
  return { port, onClose, user: userEvent.setup(), dialog: within(screen.getByRole('dialog')) }
}

describe('İhbar föyü düzenleme ve yazdırma', () => {
  it.each(['traffic', 'casco'] as const)('edits %s registration dates and the affected vehicle history while retaining hidden legacy fields', async caseType => {
    const fixture = { ...noticeSheetFixture, caseType, overrides: { fields: { inspectionNotes: 'Korunacak eski çalışma', victimName: 'Korunacak karşı taraf' }, documents: { victimLicense: true } } }
    const { dialog, user, port } = setup({}, fixture)
    await dialog.findByRole('article')
    const insured = dialog.getByLabelText('Sigortalı tescil tarihi')
    fireEvent.change(insured, { target: { value: '2020-02-29' } })
    const victim = dialog.queryByLabelText('Mağdur tescil tarihi')
    expect(Boolean(victim)).toBe(caseType === 'traffic')
    if (victim) fireEvent.change(victim, { target: { value: '2021-10-17' } })
    const key = caseType === 'traffic' ? 'victimDamageHistory' : 'insuredDamageHistory'
    const label = caseType === 'traffic' ? 'Mağdur geçmiş hasarları' : 'Sigortalı geçmiş hasarları'
    await user.type(dialog.getByLabelText(label), '2022 sol kapı değişimi\n2024 tampon onarımı')
    expect(dialog.queryByLabelText('Ekspertiz çalışması')).not.toBeInTheDocument()
    expect(dialog.queryByLabelText(caseType === 'traffic' ? 'Sigortalı geçmiş hasarları' : 'Mağdur adı / unvanı')).not.toBeInTheDocument()
    expect(dialog.getByRole('article')).not.toHaveTextContent('Korunacak eski çalışma')
    if (caseType === 'casco') expect(dialog.getByRole('article')).not.toHaveTextContent('Korunacak karşı taraf')
    await user.click(dialog.getByRole('button', { name: 'Kaydet' }))
    expect(port.save).toHaveBeenCalledWith(fixture.caseId, expect.objectContaining({ overrides: {
      fields: { ...fixture.overrides.fields, insuredRegistrationDate: '2020-02-29', ...(victim ? { victimRegistrationDate: '2021-10-17' } : {}), [key]: '2022 sol kapı değişimi\n2024 tampon onarımı' }, documents: fixture.overrides.documents,
    } }))
    expect(dialog.getByRole('article')).toHaveTextContent('29.02.2020')
    expect(dialog.getByRole('article')).toHaveTextContent('2024 tampon onarımı')
  })
  it('clears previous service contacts on a sheet-only service change and saves the new explicit contacts', async () => {
    const fixture = { ...noticeSheetFixture, overrides: { fields: { servicePhone: '0111 111 11 11', serviceAddress: 'Önceki elle girilmiş adres' }, documents: {} } }
    const { dialog, user, port } = setup({}, fixture)
    await dialog.findByRole('article')
    expect(dialog.getByLabelText('Servis telefonu')).toHaveValue('0111 111 11 11')
    await user.clear(dialog.getByLabelText('Servis adı'))
    await user.type(dialog.getByLabelText('Servis adı'), 'Föye özel yeni servis')
    expect(dialog.getByLabelText('Servis telefonu')).toHaveValue('')
    expect(dialog.getByLabelText('Servis adresi')).toHaveValue('')
    await user.type(dialog.getByLabelText('Servis telefonu'), '0222 222 22 22')
    await user.type(dialog.getByLabelText('Servis adresi'), 'Yeni elle girilmiş adres')
    await user.click(dialog.getByRole('button', { name: 'Kaydet' }))
    expect(port.save).toHaveBeenCalledWith(fixture.caseId, expect.objectContaining({ overrides: { fields: { serviceName: 'Föye özel yeni servis', servicePhone: '0222 222 22 22', serviceAddress: 'Yeni elle girilmiş adres' }, documents: {} } }))
    expect(dialog.getByRole('article')).toHaveTextContent('Yeni elle girilmiş adres')
  })
  it('previews the correct traffic parties, dates and verified document checks', async () => {
    const { dialog } = setup()
    expect(await dialog.findByRole('article')).toHaveAccessibleName('Trafik ihbar föyü A4')
    expect(dialog.getByText('16.10.2026')).toBeInTheDocument()
    expect(dialog.getByText('Sigortalı Örnek')).toBeInTheDocument()
    expect(dialog.getByText('Mağdur Örnek')).toBeInTheDocument()
    expect(dialog.getAllByLabelText('Var')).toHaveLength(2)
  })
  it('saves edits before printing only the chosen case and restores print state', async () => {
    const { dialog, user, port } = setup()
    await dialog.findByRole('article')
    await user.type(dialog.getByLabelText('Rücu durumu'), 'İnceleniyor')
    const title = document.title
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.body).toHaveClass('printing-notice-sheet')
      expect(document.querySelector('.notice-sheet-print-root')).toHaveTextContent('İnceleniyor')
      expect(document.title).toContain('34 TEST 123')
      window.dispatchEvent(new Event('afterprint'))
    })
    await user.click(dialog.getByRole('button', { name: 'Kaydet ve Yazdır' }))
    expect(await dialog.findByText('Yazdırma Önizlemesi')).toBeInTheDocument()
    expect(print).not.toHaveBeenCalled()
    await user.click(dialog.getByRole('button', { name: 'Yazıcıya gönder' }))
    await waitFor(() => expect(print).toHaveBeenCalledOnce())
    expect(port.save).toHaveBeenCalledWith(noticeSheetFixture.caseId, { expectedVersion: null, overrides: { fields: { recourse: 'İnceleniyor' }, documents: {} } })
    expect(document.body).not.toHaveClass('printing-notice-sheet')
    expect(document.title).toBe(title)
  })
  it('retains unsaved values and never prints when a save fails', async () => {
    const { dialog, user } = setup({ save: vi.fn().mockRejectedValue(new NoticeSheetClientError('conflict')) })
    await dialog.findByRole('article')
    await user.type(dialog.getByLabelText('Rücu durumu'), 'Korumalı not')
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    await user.click(dialog.getByRole('button', { name: 'Kaydet ve Yazdır' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Girdiğiniz bilgiler korunuyor')
    expect(dialog.getByLabelText(/Rücu durumu/)).toHaveValue('Korumalı not')
    expect(print).not.toHaveBeenCalled()
  })
  it('prints a closed or read-only sheet without making a write', async () => {
    const fixture = { ...noticeSheetFixture, permissions: { canEdit: false }, closureDate: noticeSheetFixture.notificationDate }
    const { dialog, user, port } = setup({}, fixture)
    await dialog.findByRole('article')
    expect(dialog.getByLabelText('Rücu durumu')).toBeDisabled()
    const print = vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('afterprint')))
    await user.click(dialog.getByRole('button', { name: 'Yazdır' }))
    await user.click(await dialog.findByRole('button', { name: 'Yazıcıya gönder' }))
    expect(print).toHaveBeenCalledOnce()
    expect(port.save).not.toHaveBeenCalled()
  })
  it('blocks overflowing content instead of clipping it or printing a second page', async () => {
    const { dialog, user } = setup()
    await dialog.findByRole('article')
    const content = dialog.getByRole('article').querySelector('.notice-sheet')!
    vi.spyOn(content, 'scrollHeight', 'get').mockReturnValue(1400)
    vi.spyOn(content, 'clientHeight', 'get').mockReturnValue(1000)
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    await user.click(dialog.getByRole('button', { name: 'Yazdır' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('tek A4 sayfasını aşıyor')
    expect(print).not.toHaveBeenCalled()
  })
  it('protects unsaved work on Escape and lets the printed plate be revised', async () => {
    const { dialog, user, onClose } = setup()
    await dialog.findByRole('article')
    await user.type(dialog.getByLabelText('Rücu durumu'), 'Not')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(dialog.getByRole('button', { name: 'Düzenlemeye dön' }))
    await user.click(dialog.getByText('Mağdur / karşı araç', { selector: 'summary' }))
    expect(dialog.getByLabelText('Mağdur plaka')).not.toHaveAttribute('readonly')
    await user.clear(dialog.getByLabelText('Mağdur plaka'))
    await user.type(dialog.getByLabelText('Mağdur plaka'), '06 TEST 99')
    expect(dialog.getByRole('article')).toHaveTextContent('06 TEST 99')
    expect(dialog.getByLabelText(/Rücu durumu/)).toHaveValue('Not')
  })
  it('revises all header fields in the preview and saves sheet overrides only', async () => {
    const { dialog, user, port } = setup()
    await dialog.findByRole('article')
    for (const [label, value] of [['Sigorta şirketi', 'Yeni Sigorta'], ['Dosya plakası', '06 TEST 99'], ['Ofis dosya no', 'F-999'], ['Eksper adı', 'Yeni Eksper']] as const) {
      await user.clear(dialog.getByLabelText(label)); await user.type(dialog.getByLabelText(label), value)
      expect(dialog.getByRole('article')).toHaveTextContent(value)
    }
    await user.click(dialog.getByRole('button', { name: 'Kaydet' }))
    expect(port.save).toHaveBeenCalledWith(noticeSheetFixture.caseId, expect.objectContaining({ overrides: expect.objectContaining({ fields: expect.objectContaining({ insurerName: 'Yeni Sigorta', plate: '06 TEST 99', officeNumber: 'F-999', expertName: 'Yeni Eksper' }) }) }))
  })
  it('requires a classified case type before previewing or printing', async () => {
    const { dialog } = setup({}, { ...noticeSheetFixture, caseType: null, permissions: { canEdit: false } })
    expect(await dialog.findByText(/Kasko veya Trafik türünü seçin/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Yazdır' })).toBeDisabled()
    expect(dialog.queryByRole('article')).not.toBeInTheDocument()
  })
  it('cleans print portals and print styling when closed', async () => {
    let resolveRead!: (value: typeof noticeSheetFixture) => void
    const pending = new Promise<typeof noticeSheetFixture>(resolve => { resolveRead = resolve })
    const port: NoticeSheetDataPort = { read: () => pending, save: vi.fn() }
    const view = render(<NoticeSheetModal caseId="notice-case-1" port={port} onClose={vi.fn()} />)
    await act(async () => resolveRead(noticeSheetFixture))
    expect(document.querySelector('.notice-sheet-print-root')).toBeInTheDocument()
    document.body.classList.add('printing-notice-sheet')
    view.unmount()
    expect(document.querySelector('.notice-sheet-print-root')).toBeNull()
    expect(document.body).not.toHaveClass('printing-notice-sheet')
  })
})
