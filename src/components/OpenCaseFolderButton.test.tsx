import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenCaseFolderButton } from './OpenCaseFolderButton'

const desktop = window as Window & { hasarbotuCaseFolders?: { open(caseId: string): Promise<{ opened: boolean; error?: string }> } }
afterEach(() => { delete desktop.hasarbotuCaseFolders })
describe('open case folder button', () => {
  it('opens by case identity, stops row navigation and blocks duplicate clicks', async () => {
    let complete!: (value: { opened: boolean }) => void
    const open = vi.fn(() => new Promise<{ opened: boolean }>(resolve => { complete = resolve }))
    desktop.hasarbotuCaseFolders = { open }
    const navigate = vi.fn()
    render(<div onClick={navigate} onDoubleClick={navigate}><OpenCaseFolderButton caseId="case-axa" /></div>)
    const button = screen.getByRole('button')
    fireEvent.click(button); fireEvent.click(button); fireEvent.doubleClick(button)
    expect(open).toHaveBeenCalledExactlyOnceWith('case-axa')
    expect(navigate).not.toHaveBeenCalled()
    complete({ opened: true })
    await waitFor(() => expect(button).toBeEnabled())
  })
  it('shows a failure and makes unsupported browsers visibly unavailable', async () => {
    desktop.hasarbotuCaseFolders = { open: vi.fn(async () => ({ opened: false, error: 'Klasör bulunamadı.' })) }
    const view = render(<OpenCaseFolderButton caseId="case-a" />)
    await userEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Klasör bulunamadı.')
    delete desktop.hasarbotuCaseFolders
    view.rerender(<OpenCaseFolderButton caseId="case-b" />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
