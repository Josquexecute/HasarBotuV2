import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASSISTANT_APPEARANCE } from '@hasarbotu/contracts'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import type { AssistantAppearancePort } from '../../data/assistantAppearancePort'
import { AssistantAppearanceProvider } from './AssistantAppearanceProvider'
import { useAssistantAppearance } from './assistantAppearanceContext'
import { AssistantAppearanceEditor, AssistantAppearanceSettings } from './AssistantAppearanceEditor'
import type { AppearanceWindow } from './useAssistantAppearance'
import { contrastInk } from './appearance'
import * as imageInput from './customImage'

const session = (id: string): SessionContextValue => ({ mode: 'api', status: 'authenticated', user: { id, displayName: id, email: `${id}@example.test`, roles: ['read_only'], organizationId: 'org' },
  notice: null, login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn() })
// Real Canvas pixels are covered by the Electron harness; jsdom has no renderer.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
function Probe() {
  const model = useAssistantAppearance()
  return <><span data-testid="accent">{model.appearance.accentColor}</span><span>{model.status}</span><button onClick={() => { void model.save({ ...model.appearance, accentColor: '#15803d' }) }}>Save</button></>
}
describe('Touch appearance', () => {
  it('previews eye colors on native Touch immediately, persists and reloads after remount', async () => {
    let saved = { ...DEFAULT_ASSISTANT_APPEARANCE, customImage: 'data:image/png;base64,aGVsbG8=' }
    const initial = saved
    const port = {
      load: vi.fn(async () => ({ userId: 'account-a', version: 1, appearance: saved })),
      save: vi.fn(async (_id, _version, next) => { saved = next; return { userId: 'account-a', version: 2, appearance: next } }),
    }
    const native = { set: vi.fn().mockResolvedValue(true), onReady: vi.fn(() => () => {}) }
    const target = window as AppearanceWindow
    target.hasarbotuAppearance = native
    const wrapper = (id = 'account-a') => <SessionContext.Provider value={session(id)}><AssistantAppearanceProvider port={port}><AssistantAppearanceSettings /></AssistantAppearanceProvider></SessionContext.Provider>
    try {
      const view = render(wrapper())
      fireEvent.change(await screen.findByLabelText('Göz Rengi'), { target: { value: '#22cc88' } })
      await waitFor(() => expect(native.set).toHaveBeenLastCalledWith({ ...initial, eyeColor: '#22cc88' }))
      expect(port.save).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Görünümü Kaydet' }))
      expect(port.save).toHaveBeenCalledWith('account-a', 1, { ...initial, eyeColor: '#22cc88' })
      view.unmount()
      const reopened = render(wrapper())
      expect(await screen.findByLabelText('Göz Rengi')).toHaveValue('#22cc88')
      fireEvent.change(screen.getByLabelText('Göz Rengi'), { target: { value: '#ff0000' } })
      reopened.rerender(wrapper('account-b'))
      await waitFor(() => expect(native.set).toHaveBeenLastCalledWith(DEFAULT_ASSISTANT_APPEARANCE))
      reopened.unmount()
    } finally { delete target.hasarbotuAppearance }
  })
  it('reverts an unsaved native preview on leaving settings and allows automatic eyes', async () => {
    const onPreview = vi.fn(), onSave = vi.fn(async value => value)
    const view = render(<AssistantAppearanceEditor appearance={{ ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor: '#ffffff' }} systemDark={false} onSave={onSave} onReload={vi.fn()} onPreview={onPreview} />)
    await userEvent.click(screen.getByRole('button', { name: 'Otomatik göz rengi' }))
    expect(onPreview).toHaveBeenLastCalledWith({ ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor: null })
    await userEvent.click(screen.getByRole('button', { name: 'Görünümü Kaydet' }))
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor: null })
    view.unmount()
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })
  it('preserves color changes made while an uploaded image is being prepared', async () => {
    const customImage = 'data:image/png;base64,aGVsbG8='
    let complete!: (value: string) => void
    const prepare = vi.spyOn(imageInput, 'prepareAssistantImage').mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const onSave = vi.fn(async value => value)
    try {
      render(<AssistantAppearanceEditor appearance={DEFAULT_ASSISTANT_APPEARANCE} systemDark={false} onSave={onSave} onReload={vi.fn()} />)
      await userEvent.upload(screen.getByLabelText('Görsel seç / değiştir'), new File(['image'], 'touch.png', { type: 'image/png' }))
      fireEvent.change(screen.getByLabelText('Vurgu rengi'), { target: { value: '#334455' } })
      await act(async () => { complete(customImage) })
      await userEvent.click(screen.getByRole('button', { name: 'Görünümü Kaydet' }))
      expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#334455', customImage })
    } finally { prepare.mockRestore() }
  })
  it('previews a personal image, saves it only on request and restores the default character', async () => {
    const customImage = 'data:image/png;base64,aGVsbG8='
    const prepare = vi.spyOn(imageInput, 'prepareAssistantImage').mockResolvedValue(customImage)
    const onSave = vi.fn(async value => value)
    render(<AssistantAppearanceEditor appearance={DEFAULT_ASSISTANT_APPEARANCE} systemDark={false} onSave={onSave} onReload={vi.fn()} />)
    const file = new File(['image'], 'character.webp', { type: 'image/webp' })
    await userEvent.upload(screen.getByLabelText('Görsel seç / değiştir'), file)
    expect(await screen.findByRole('img', { name: 'Touch kaplama önizlemesi' })).toHaveAttribute('width', '120')
    expect(screen.getByLabelText('Ölçek')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Görünümü Kaydet' }))
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_ASSISTANT_APPEARANCE, customImage })
    await userEvent.click(screen.getByRole('button', { name: "Varsayılan Touch'a dön" }))
    expect(screen.queryByLabelText('Ölçek')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Görünümü Kaydet' }))
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_ASSISTANT_APPEARANCE, customImage: null })
    prepare.mockRestore()
  })
  it('saves a preset without leaking UI labels into the strict preference contract', async () => {
    const onSave = vi.fn(async value => value)
    render(<AssistantAppearanceEditor appearance={DEFAULT_ASSISTANT_APPEARANCE} systemDark={false} onSave={onSave} onReload={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Yeşil' }))
    await user.click(screen.getByRole('button', { name: 'Görünümü Kaydet' }))
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#15803d', characterColor: '#15803d' })
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
  it('discards an old account save after a new account has loaded its own image and preferences', async () => {
    const saveError = vi.fn()
    let resolveSave!: (value: Awaited<ReturnType<AssistantAppearancePort['save']>>) => void
    const port = { load: vi.fn().mockResolvedValueOnce({ userId: 'account-a', version: 1, appearance: DEFAULT_ASSISTANT_APPEARANCE }).mockResolvedValueOnce({ userId: 'account-b', version: 1, appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#2563eb' } }),
      save: vi.fn(() => new Promise<Awaited<ReturnType<AssistantAppearancePort['save']>>>(resolve => { resolveSave = resolve })) }
    function SaveProbe() {
      const model = useAssistantAppearance()
      return <><span data-testid="accent">{model.appearance.accentColor}</span><span>{model.status}</span><button onClick={() => { void model.save({ ...model.appearance, customImage: 'data:image/png;base64,aGVsbG8=' }).catch(saveError) }}>Save</button></>
    }
    const wrapper = (id: string) => <SessionContext.Provider value={session(id)}><AssistantAppearanceProvider port={port}><SaveProbe /></AssistantAppearanceProvider></SessionContext.Provider>
    const view = render(wrapper('account-a'))
    await screen.findByText('ready')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    view.rerender(wrapper('account-b'))
    await waitFor(() => expect(screen.getByTestId('accent')).toHaveTextContent('#2563eb'))
    await act(async () => { resolveSave({ userId: 'account-a', version: 2, appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#be185d', customImage: 'data:image/png;base64,aGVsbG8=' } }) })
    expect(screen.getByTestId('accent')).toHaveTextContent('#2563eb')
    expect(screen.getByText('ready')).toBeInTheDocument()
    expect(saveError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'account_changed' }))
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
  })
  it.each(['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ff8000', '#808080', '#4a82b7', '#eff2fa'])(
    'previews and saves the selected character color %s without whitening it', async (characterColor) => {
      const onSave = vi.fn(async value => value)
      render(<AssistantAppearanceEditor appearance={DEFAULT_ASSISTANT_APPEARANCE} systemDark={false} onSave={onSave} onReload={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Karakter rengi'), { target: { value: characterColor } })
      expect(screen.getByLabelText('Karakter rengi')).toHaveValue(characterColor)
      expect(screen.getByRole('img', { name: 'Touch kaplama önizlemesi' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Görünümü Kaydet' }))
      expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_ASSISTANT_APPEARANCE, characterColor })
    },
  )
})
