import { act, render, screen, waitFor, within } from '@testing-library/react'
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
  it('protects unsaved work on Escape and keeps the primary plate read-only', async () => {
    const { dialog, user, onClose } = setup()
    await dialog.findByRole('article')
    await user.type(dialog.getByLabelText('Rücu durumu'), 'Not')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(dialog.getByRole('button', { name: 'Düzenlemeye dön' }))
    await user.click(dialog.getByText('Mağdur / karşı araç', { selector: 'summary' }))
    expect(dialog.getByLabelText('Mağdur plaka')).toHaveAttribute('readonly')
    expect(dialog.getByLabelText(/Rücu durumu/)).toHaveValue('Not')
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
