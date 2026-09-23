import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { TouchAssistant } from './TouchAssistant'
import { QUICK_NOTE_EVENT, type ActiveCase } from '../app/activeCase'
import { CaseOperationsError, type CaseNoteRecord, type CaseOperationsPort, type CaseOperationsRecord } from '../data/caseOperationsPort'
import { useCaseOperations } from '../data/useCaseOperations'

const target: ActiveCase = { caseId: 'case-a', plate: '34 TEST 01', officeNumber: '2026/1', source: 'api' }
const note: CaseNoteRecord = { id: 'note-a', noteType: 'internal', subject: null, body: 'Servis ile görüşüldü.', createdAt: '2026-09-22T09:00:00Z', createdByUserId: 'user-a', createdByDisplayName: 'Test', legacySource: null }
function makePort(canWrite = true) {
  let notes: readonly CaseNoteRecord[] = []
  const port: CaseOperationsPort = {
    load: vi.fn(async (caseId) => ({ caseId, asOfDate: '2026-09-22', notes, tasks: [], followUpHistory: [], permissions: { canWrite, canCompleteTasks: canWrite } } satisfies CaseOperationsRecord)),
    createNote: vi.fn(async (_caseId, input) => { const saved = { ...note, ...input }; notes = [saved]; return saved }),
    createTask: vi.fn(), completeTask: vi.fn(), cancelTask: vi.fn(),
  }
  return port
}
function Notes({ port, caseId = target.caseId }: { port: CaseOperationsPort; caseId?: string }) {
  const workspace = useCaseOperations(caseId, 'api', true, port)
  return <section aria-label="Dosya notları">{workspace.data?.notes.map((item) => <p key={item.id}>{item.body}</p>)}</section>
}
function renderPanel(port: CaseOperationsPort, selected: ActiveCase | null = target) {
  return render(<MemoryRouter><TouchAssistant target={selected} port={port} /><Notes port={port} /></MemoryRouter>)
}
async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'Touch Assistant — hızlı not' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Notu kaydet' })).toBeDisabled())
}

describe('Touch Assistant quick note', () => {
  it('requires a visible target and never asks for a second case selection', async () => {
    renderPanel(makePort(), null)
    act(() => { window.dispatchEvent(new Event(QUICK_NOTE_EVENT)) })
    expect(screen.getByRole('dialog')).toHaveTextContent('bir dosya açın veya listeden seçin')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('saves to the target, refreshes mounted case notes and reads the note again after remount', async () => {
    const port = makePort()
    const first = renderPanel(port)
    await open()
    expect(screen.getByRole('dialog')).toHaveTextContent(target.plate)
    await userEvent.type(screen.getByRole('textbox', { name: 'Hızlı not' }), note.body)
    await userEvent.click(screen.getByRole('button', { name: 'Notu kaydet' }))
    expect(await screen.findByText('Not dosyaya kaydedildi.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Dosya notları' })).toHaveTextContent(note.body))
    expect(port.createNote).toHaveBeenCalledWith(target.caseId, { noteType: 'internal', subject: null, body: note.body }, expect.any(String))
    first.unmount()
    renderPanel(port)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Dosya notları' })).toHaveTextContent(note.body))
    await open()
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('retains the request identity and text after a lost response and full remount', async () => {
    const port = makePort()
    vi.mocked(port.createNote).mockRejectedValueOnce(new CaseOperationsError('unavailable', 'lost response'))
    const first = renderPanel(port)
    await open()
    await userEvent.type(screen.getByRole('textbox'), note.body)
    await userEvent.click(screen.getByRole('button', { name: 'Notu kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('aynı not ikinci kez eklenmez')
    const request = vi.mocked(port.createNote).mock.calls[0]
    first.unmount()
    renderPanel(port)
    await userEvent.click(screen.getByRole('button', { name: 'Touch Assistant — hızlı not' }))
    expect(screen.getByRole('textbox')).toHaveValue(note.body)
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kaydı tekrar dene' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Kaydı tekrar dene' }))
    await screen.findByText('Not dosyaya kaydedildi.')
    expect(vi.mocked(port.createNote).mock.calls[1]).toEqual(request)
  })

  it('blocks duplicate submissions while saving', async () => {
    const port = makePort()
    let finish!: (value: CaseNoteRecord) => void
    vi.mocked(port.createNote).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    renderPanel(port)
    await open()
    await userEvent.type(screen.getByRole('textbox'), note.body)
    const form = screen.getByRole('textbox').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(port.createNote).toHaveBeenCalledTimes(1)
    await act(async () => { finish(note) })
    expect(screen.getByText('Not dosyaya kaydedildi.')).toBeInTheDocument()
  })

  it('keeps per-case drafts separate when selection changes', async () => {
    const port = makePort()
    const view = render(<MemoryRouter><TouchAssistant target={target} port={port} /></MemoryRouter>)
    await open()
    await userEvent.type(screen.getByRole('textbox'), 'Birinci dosyanın taslağı')
    const second = { ...target, caseId: 'case-b', plate: '34 TEST 02' }
    view.rerender(<MemoryRouter><TouchAssistant target={second} port={port} /></MemoryRouter>)
    expect(screen.getByRole('textbox')).toHaveValue('')
    await userEvent.type(screen.getByRole('textbox'), 'İkinci dosya')
    await userEvent.click(screen.getByRole('button', { name: 'Notu kaydet' }))
    await screen.findByText('Not dosyaya kaydedildi.')
    expect(port.createNote).toHaveBeenCalledWith('case-b', expect.objectContaining({ body: 'İkinci dosya' }), expect.any(String))
    view.rerender(<MemoryRouter><TouchAssistant target={target} port={port} /></MemoryRouter>)
    expect(screen.getByRole('textbox')).toHaveValue('Birinci dosyanın taslağı')
  })

  it('respects write permissions and Escape returns focus', async () => {
    const port = makePort(false)
    renderPanel(port)
    await open()
    await screen.findByText('Bu dosyaya not ekleme yetkiniz yok.')
    await userEvent.type(screen.getByRole('textbox'), note.body)
    expect(screen.getByRole('button', { name: 'Notu kaydet' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Touch Assistant — hızlı not' })).toHaveFocus()
    expect(port.createNote).not.toHaveBeenCalled()
  })
})
