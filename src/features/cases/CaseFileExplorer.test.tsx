import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { CaseFolderBrowseRequest, CaseFolderBrowseResult } from '@hasarbotu/contracts'
import { CaseFileExplorer } from './CaseFileExplorer'

afterEach(() => vi.unstubAllGlobals())

it('opens real directory names from the bridge and scopes preview and reveal to the selected folder', async () => {
  const browse = vi.fn(async (request: CaseFolderBrowseRequest): Promise<CaseFolderBrowseResult> => {
    if (request.action === 'preview') return { kind: 'text', text: 'Eksper kayıt özeti' }
    if (request.action === 'reveal') return { kind: 'revealed' }
    return {
      kind: 'listed',
      rootName: '34 ORN 101 - Hasar',
      locationVersion: 3,
      entries: request.path.length === 0 ? [{ kind: 'directory', name: 'Belgeler' }] : [
        { kind: 'directory', name: 'Arşiv' },
        { kind: 'file', name: 'Servis.txt', size: 2063, modifiedAt: '2026-11-28T09:00:00Z' },
      ],
    }
  })
  vi.stubGlobal('hasarbotuCaseFolders', { browse, open: vi.fn() })
  const user = userEvent.setup()
  render(<CaseFileExplorer caseId="case-fixture" plate="34 ORN 101" />)
  const tree = within(screen.getByRole('navigation', { name: 'Klasör ağacı' }))
  await user.click(await tree.findByRole('button', { name: 'Belgeler' }))
  expect(await tree.findByRole('button', { name: 'Arşiv' })).toBeVisible()
  const files = within(screen.getByRole('table', { name: 'Klasör içeriği' }))
  await user.click(await files.findByRole('button', { name: 'Servis.txt' }))
  expect(await screen.findByText('Eksper kayıt özeti')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Gezginde göster' }))
  for (const action of ['preview', 'reveal']) {
    expect(browse).toHaveBeenCalledWith({ caseId: 'case-fixture', action, path: ['Belgeler', 'Servis.txt'], locationVersion: 3 })
  }
  await user.type(screen.getByRole('textbox', { name: 'Bu klasörde ara' }), 'bulunmaz')
  expect(screen.getByText('Eşleşen öğe yok.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Üst klasöre git' }))
  expect(await files.findByRole('button', { name: 'Belgeler' })).toBeVisible()
  expect(screen.queryByText('Eksper kayıt özeti')).not.toBeInTheDocument()
})

it('navigates to the last PDF page and keeps zoom controls in full screen', async () => {
  vi.stubGlobal('hasarbotuCaseFolders', { browse: async (request: CaseFolderBrowseRequest) => request.action === 'list'
    ? { kind: 'listed', rootName: 'Dosya', locationVersion: 3, entries: [{ kind: 'file', name: 'Tutanak.pdf', size: 100, modifiedAt: null }] }
    : { kind: 'pdf', src: 'data:image/png;base64,AA==', page: 'page' in request ? request.page : 1, pageCount: 3 } })
  const user = userEvent.setup()
  render(<CaseFileExplorer caseId="case-fixture" plate="34 ORN 101" />)
  await user.click(await screen.findByRole('button', { name: 'Tutanak.pdf' }))
  await screen.findByRole('img', { name: 'Tutanak.pdf, sayfa 1' })
  await user.click(screen.getByRole('button', { name: 'Tam ekran' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Tutanak.pdf' }))
  await user.click(dialog.getByRole('button', { name: 'Sonraki sayfa' }))
  await dialog.findByRole('img', { name: 'Tutanak.pdf, sayfa 2' })
  await user.click(dialog.getByRole('button', { name: 'Sonraki sayfa' }))
  await dialog.findByRole('img', { name: 'Tutanak.pdf, sayfa 3' })
  expect(dialog.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled()
  await user.click(dialog.getByRole('button', { name: 'Yakınlaştır' }))
  expect(dialog.getByText('125%')).toBeVisible()
})

it('opens a focused directory with Enter before a mouse selection', async () => {
  const browse = vi.fn(async (request: CaseFolderBrowseRequest): Promise<CaseFolderBrowseResult> => ({
    kind: 'listed', rootName: 'Dosya', locationVersion: 3, entries: request.path.length ? [] : [{ kind: 'directory', name: 'Belgeler' }],
  }))
  vi.stubGlobal('hasarbotuCaseFolders', { browse })
  const user = userEvent.setup()
  render(<CaseFileExplorer caseId="case-fixture" plate="34 ORN 101" />)
  const files = within(screen.getByRole('table', { name: 'Klasör içeriği' }))
  const folder = await files.findByRole('button', { name: 'Belgeler' })
  folder.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByText('Bu klasör boş.')).toBeVisible()
})
