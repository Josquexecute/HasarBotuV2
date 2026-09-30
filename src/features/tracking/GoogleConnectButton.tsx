import { useEffect, useState } from 'react'
import { trackingRequest } from './trackingApi'

export function GoogleConnectButton({ purpose, onComplete }: { purpose: 'login' | 'mail'; onComplete?: () => void }) {
  const [enabled,setEnabled] = useState(false)
  const [flow,setFlow] = useState<{ flowId: string;url: string } | null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void trackingRequest('google/status',undefined,controller.signal).then((r) => setEnabled((r as { enabled: boolean }).enabled)).catch(() => { if (!controller.signal.aborted) setEnabled(false) })
    return () => controller.abort()
  },[])
  useEffect(() => {
    if (!flow) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const poll = async () => {
      try {
        const result = await trackingRequest('google/complete',{ flowId: flow.flowId },controller.signal) as { status: string }
        if (stopped) return
        if (result.status === 'complete') {
          setFlow(null)
          if (purpose === 'login') window.location.reload()
          else onComplete?.()
          return
        }
        timer = setTimeout(() => { void poll() },2000)
      } catch {
        if (!stopped) { setError('Google bağlantısı tamamlanamadı. Hesap ve izinleri kontrol edip yeniden deneyin.');setFlow(null) }
      }
    }
    timer = setTimeout(() => { void poll() },2000)
    return () => { stopped = true;controller.abort();clearTimeout(timer) }
  },[flow,purpose,onComplete])
  async function start() {
    setBusy(true);setError('')
    try {
      const result = await trackingRequest('google/start',{ purpose }) as { flowId: string;url: string }
      const url = new URL(result.url)
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('Geçersiz Google adresi.')
      setFlow(result)
    } catch (e) { setError(e instanceof Error ? e.message : 'Google bağlantısı başlatılamadı.') }
    finally { setBusy(false) }
  }
  return <div className="google-connect">
    <button className="button button--secondary" type="button" disabled={!enabled || busy || flow !== null} onClick={() => { void start() }}>
      {purpose === 'login' ? 'Kurumsal Google hesabıyla giriş' : 'SBM e-posta hesabını bağla'}
    </button>
    {!enabled && <small>Google bağlantısı henüz yapılandırılmamış.</small>}
    {flow && <p><a className="button button--secondary" href={flow.url} target="_blank" rel="noreferrer">Google sayfasını aç</a> İzni tamamladıktan sonra uygulamaya dönün.</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
