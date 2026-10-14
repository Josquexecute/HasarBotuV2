import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_ASSISTANT_APPEARANCE, type AssistantAppearance } from '@hasarbotu/contracts/assistant-appearance'
import { useSession } from '../../app/sessionContext'
import { AssistantAppearanceError, createAssistantAppearancePort, type AssistantAppearancePort } from '../../data/assistantAppearancePort'

export type AppearanceWindow = Window & { hasarbotuAppearance?: { set(appearance: AssistantAppearance): Promise<boolean>; onReady(callback: () => void): () => void } }
export function useAssistantAppearanceModel(suppliedPort?: AssistantAppearancePort) {
  const { user, reportUnauthorized } = useSession()
  const userId = user?.id ?? null
  const port = useMemo(() => suppliedPort ?? createAssistantAppearancePort(), [suppliedPort])
  const [state, setState] = useState<{ userId: string | null; status: 'loading' | 'ready' | 'error'; version: number; appearance: AssistantAppearance } | null>(null)
  const [generation, setGeneration] = useState(0)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!userId) return
    const refresh = () => setGeneration(n => n + 1)
    const changed = (event: StorageEvent) => { if (event.key === 'hasarbotu-assistant-appearance-changed') refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', changed)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', changed) }
  }, [userId])
  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    void port.load(controller.signal).then(data => {
      if (controller.signal.aborted) return
      if (data.userId !== userId) { window.dispatchEvent(new Event('permissions-updated')); return }
      setState(current => current?.userId === userId && current.status === 'ready' && current.version > data.version
        ? current : { userId, status: 'ready', version: data.version, appearance: data.appearance })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof AssistantAppearanceError && error.kind === 'unauthorized') reportUnauthorized()
      setState({ userId, status: 'error', version: 0, appearance: DEFAULT_ASSISTANT_APPEARANCE })
    })
    return () => controller.abort()
  }, [port, userId, generation, reportUnauthorized])
  const appearance = state?.userId === userId && state.status === 'ready' ? state.appearance : DEFAULT_ASSISTANT_APPEARANCE
  useEffect(() => {
    const native = (window as AppearanceWindow).hasarbotuAppearance
    const publish = () => { void native?.set(appearance).catch(() => { /* IPC can disappear during startup/shutdown; the ready event republishes authoritative server preferences. */ }) }
    publish()
    return native?.onReady(publish)
  }, [appearance])
  const save = useCallback(async (next: AssistantAppearance) => {
    if (!userId || state?.userId !== userId || state.status !== 'ready') throw new AssistantAppearanceError('unavailable')
    const data = await port.save(userId, state.version, next)
    if (data.userId !== userId) { window.dispatchEvent(new Event('permissions-updated')); throw new AssistantAppearanceError('account_changed') }
    setState({ userId, status: 'ready', version: data.version, appearance: data.appearance })
    try { localStorage.setItem('hasarbotu-assistant-appearance-changed', JSON.stringify({ userId, version: data.version, at: Date.now() })) }
    catch { /* Server persistence succeeded; another window can refresh on focus if local signaling is unavailable. */ }
    return data.appearance
  }, [port, userId, state])
  return { appearance, systemDark, save, reload: () => setGeneration(n => n + 1), status: !userId ? 'anonymous' : state?.userId === userId ? state.status : 'loading' }
}
