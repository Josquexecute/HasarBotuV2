import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TouchPlayState } from '../../../public/desktop-assistant-play.js'
import { TouchPlayControls, type TouchPlayWindow } from './TouchPlayControls'

const target = window as TouchPlayWindow
afterEach(() => { delete target.hasarbotuTouch })
const initial: TouchPlayState = { version: 1, mood: 'happy', reaction: null, paused: false, reducedMotion: false, sleeping: false }
function setup() {
  let change: (state: TouchPlayState) => void = () => {}
  const native = { control: vi.fn().mockResolvedValue(true), getState: vi.fn().mockResolvedValue(initial),
    onState: vi.fn((callback: (state: TouchPlayState) => void) => { change = callback; return off }) }
  const off = vi.fn()
  target.hasarbotuTouch = native
  return { native, off, emit: (state: Partial<TouchPlayState>) => act(() => change({ ...initial, version: 2, ...state })) }
}
describe('Touch reaction controls', () => {
  it('lists all 61 real reactions and sends a chosen reaction through the native boundary', async () => {
    const { native, emit, off } = setup(), user = userEvent.setup()
    const view = render(<TouchPlayControls />)
    await user.click(screen.getByText('Touch tepkileri'))
    await waitFor(() => expect(screen.getByLabelText('Touch tepkisi')).toBeEnabled())
    expect(screen.getAllByRole('option')).toHaveLength(62)
    await user.selectOptions(screen.getByLabelText('Touch tepkisi'), 'foam-bat')
    await user.click(screen.getByRole('button', { name: 'Oynat' }))
    expect(native.control).toHaveBeenCalledWith({ type: 'play', id: 'foam-bat' })
    emit({ mood: 'angry', reaction: 'foam-bat' })
    expect(screen.getByText('Sinirli')).toBeInTheDocument()
    expect(screen.getByText('Oyuncak sopam nerede?', { selector: 'p' })).toBeInTheDocument()
    view.unmount(); expect(off).toHaveBeenCalledOnce()
  })
  it('shows actual pause, sleep and reduced-motion state without inventing command success', async () => {
    const { native, emit } = setup(), user = userEvent.setup()
    render(<TouchPlayControls />)
    await user.click(screen.getByText('Touch tepkileri'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Duraklat' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Duraklat' }))
    expect(native.control).toHaveBeenLastCalledWith({ type: 'pause' })
    expect(screen.getByRole('button', { name: 'Duraklat' })).toHaveAttribute('aria-pressed', 'false')
    emit({ paused: true })
    await user.click(screen.getByRole('button', { name: 'Devam et' }))
    expect(native.control).toHaveBeenLastCalledWith({ type: 'resume' })
    emit({ version: 3, sleeping: true })
    await user.click(screen.getByRole('button', { name: 'Uyandır' }))
    expect(native.control).toHaveBeenLastCalledWith({ type: 'wake' })
    emit({ version: 4, reducedMotion: true })
    expect(screen.getByRole('button', { name: 'Oynat' })).toBeDisabled()
    expect(screen.getByText('Hareket azaltma açık. Touch sabit görünür.')).toBeInTheDocument()
    emit({ version: 2, reaction: 'magic' })
    expect(screen.getByRole('button', { name: 'Oynat' })).toBeDisabled()
  })
  it('reports a rejected command and clearly disables unavailable native controls', async () => {
    const { native } = setup(), user = userEvent.setup()
    native.control.mockResolvedValue(false)
    const view = render(<TouchPlayControls />)
    await user.click(screen.getByText('Touch tepkileri'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sakinleştir' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Sakinleştir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('şu anda oynatamıyor')
    view.unmount(); delete target.hasarbotuTouch
    render(<TouchPlayControls />)
    await user.click(screen.getByText('Touch tepkileri'))
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
    expect(screen.getByLabelText('Touch tepkisi')).toBeDisabled()
  })
})
