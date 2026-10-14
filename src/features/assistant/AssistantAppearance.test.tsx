import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASSISTANT_APPEARANCE } from '@hasarbotu/contracts'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import type { AssistantAppearancePort } from '../../data/assistantAppearancePort'
import { AssistantAppearanceProvider } from './AssistantAppearanceProvider'
import { useAssistantAppearance } from './assistantAppearanceContext'
import { AssistantAppearanceEditor } from './AssistantAppearanceEditor'
import { contrastInk, softCharacterColor } from './appearance'

const session = (id: string): SessionContextValue => ({ mode: 'api', status: 'authenticated', user: { id, displayName: id, email: `${id}@example.test`, roles: ['read_only'], organizationId: 'org' },
  notice: null, login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn() })
function Probe() {
  const model = useAssistantAppearance()
  return <><span data-testid="accent">{model.appearance.accentColor}</span><span>{model.status}</span><button onClick={() => { void model.save({ ...model.appearance, accentColor: '#15803d' }) }}>Save</button></>
}
describe('Touch appearance', () => {
  it('saves a preset without leaking UI labels into the strict preference contract', async () => {
    const onSave = vi.fn(async value => value)
    render(<AssistantAppearanceEditor appearance={DEFAULT_ASSISTANT_APPEARANCE} systemDark={false} onSave={onSave} onReload={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Yeşil' }))
    await user.click(screen.getByRole('button', { name: 'Görünümü Kaydet' }))
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#15803d', characterColor: '#b9e7c8' })
    expect(await screen.findByRole('status')).toHaveTextContent('hesabınıza kaydedildi')
  })
  it('discards a late result from the previous account', async () => {
    let resolveA!: (value: Awaited<ReturnType<AssistantAppearancePort['load']>>) => void
    let resolveB!: typeof resolveA
    const port = { load: vi.fn().mockImplementationOnce(() => new Promise(r => { resolveA = r })).mockImplementationOnce(() => new Promise(r => { resolveB = r })), save: vi.fn() }
    const wrapper = (id: string) => <SessionContext.Provider value={session(id)}><AssistantAppearanceProvider port={port}><Probe /></AssistantAppearanceProvider></SessionContext.Provider>
    const view = render(wrapper('account-a'))
    view.rerender(wrapper('account-b'))
    await act(async () => { resolveB({ userId: 'account-b', version: 1, appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#2563eb' } }) })
    await act(async () => { resolveA({ userId: 'account-a', version: 1, appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#be185d' } }) })
    expect(screen.getByTestId('accent')).toHaveTextContent('#2563eb')
  })
  it('does not overwrite a successful save with an older focus refresh', async () => {
    let refresh!: (value: Awaited<ReturnType<AssistantAppearancePort['load']>>) => void
    const port = { load: vi.fn().mockResolvedValueOnce({ userId: 'account-a', version: 1, appearance: DEFAULT_ASSISTANT_APPEARANCE }).mockImplementationOnce(() => new Promise(r => { refresh = r })),
      save: vi.fn(async (_id, _version, appearance) => ({ userId: 'account-a', version: 2, appearance })) }
    render(<SessionContext.Provider value={session('account-a')}><AssistantAppearanceProvider port={port}><Probe /></AssistantAppearanceProvider></SessionContext.Provider>)
    await screen.findByText('ready')
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(port.load).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => { refresh({ userId: 'account-a', version: 1, appearance: DEFAULT_ASSISTANT_APPEARANCE }) })
    expect(screen.getByTestId('accent')).toHaveTextContent('#15803d')
    expect(port.save).toHaveBeenCalledWith('account-a', 1, expect.objectContaining({ accentColor: '#15803d' }))
  })
  it('keeps readable text and character eyes for extreme colors', () => {
    expect(contrastInk('#ffffff')).toBe('#111111')
    expect(contrastInk('#000000')).toBe('#ffffff')
    expect(softCharacterColor('#000000')).toBe('#999999')
  })
})
