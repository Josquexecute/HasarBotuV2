import { useEffect, useRef, useState } from 'react'
import { trackingRequest } from './trackingApi'
import { completeGoogleFlow, GOOGLE_FLOW_LIFETIME, restoreGoogleFlow, saveGoogleFlow, type GoogleFlow, type GooglePurpose, type GoogleStatus, type OAuthWindow } from './googleOAuth'
import './google-connect.css'

const notices: Record<Exclude<GoogleStatus, 'pending' | 'complete'>, string> = {
  approval_required: 'Hesabınız kaydedildi ve yönetici onayı bekliyor. Rol atandıktan sonra giriş yapabilirsiniz.',
  denied: 'Google bağlantısına izin verilmedi veya oturum yetkiniz sona erdi. Uygun hesabınızla yeniden deneyin.',
  expired: 'Güvenli giriş isteğinin süresi doldu. Yeniden deneyerek yeni bir bağlantı başlatın.',
  failed: 'Google bağlantısı tamamlanamadı. Bağlantınızı ve hesap izinlerinizi kontrol edip yeniden deneyin.',
}

export function GoogleConnectButton({ purpose, onComplete, rememberMe }: { purpose: GooglePurpose; onComplete?: () => void; rememberMe?: boolean }) {
  const [enabled, setEnabled] = useState(false)
  const [flow, setFlow] = useState<GoogleFlow | null>(() => restoreGoogleFlow(purpose))
  const [notice, setNotice] = useState('')
  const [outcome, setOutcome] = useState<GoogleStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const popup = useRef<Window | null>(null)
  const starting = useRef(false)
  const mounted = useRef(false)
  const completion = useRef(onComplete)
  useEffect(() => { completion.current = onComplete }, [onComplete])
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void trackingRequest('google/status', undefined, controller.signal).then((r) => {
      if (!controller.signal.aborted) setEnabled((r as { enabled: boolean }).enabled)
    }).catch(() => { if (!controller.signal.aborted) setEnabled(false) })
    return () => { mounted.current = false; controller.abort() }
  }, [])
  useEffect(() => {
    if (!flow) return
    let stopped = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const poll = async () => {
      if (stopped || inFlight) return
      clearTimeout(timer)
      inFlight = true
      let status: GoogleStatus
      try {
        status = Date.now() - flow.startedAt >= GOOGLE_FLOW_LIFETIME ? 'expired' : await completeGoogleFlow(flow, controller.signal)
      } catch {
        inFlight = false
        if (stopped) return
        setNotice('Bağlantı bekleniyor. Ağ erişimi sağlandığında işlem otomatik kontrol edilecek.')
        timer = setTimeout(() => { void poll() }, 1500)
        return
      }
      inFlight = false
      if (stopped) return
      if (status !== 'pending') {
        stopped = true
        saveGoogleFlow(purpose, null)
        setFlow(null)
        setOutcome(status)
        if (status === 'complete') {
          try { popup.current?.close() } catch { /* Browser policy can deny closing a detached tab; the result page provides a return link. */ }
          void (window as OAuthWindow).hasarbotuOAuth?.focus().catch(() => { setNotice('İşlem tamamlandı. HasarBotu penceresine dönebilirsiniz.') })
          setNotice(purpose === 'mail' ? 'Gmail hesabı bağlandı. SBM e-posta takibi güncellendi.' : 'Giriş tamamlandı. Oturumunuz açılıyor…')
          if (completion.current) completion.current()
          else if (purpose === 'login') window.location.reload()
        } else setNotice(notices[status])
        return
      }
      setNotice('Google ekranındaki işlemi tamamlayın. HasarBotu otomatik güncellenecek.')
      if (!stopped) timer = setTimeout(() => { void poll() }, 1500)
    }
    const resume = () => { if (document.visibilityState !== 'hidden') void poll() }
    timer = setTimeout(() => { void poll() }, 500)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      stopped = true; controller.abort(); clearTimeout(timer)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [flow, purpose])

  async function start() {
    if (starting.current || flow) return
    starting.current = true
    setBusy(true); setNotice(''); setOutcome(null)
    const desktop = (window as OAuthWindow).hasarbotuDesktop?.isDesktopShell === true
    const client = desktop ? 'desktop' : ['/saha', '/saha/', '/field.html'].includes(window.location.pathname) ? 'field' : 'web'
    // Reserve the web tab during the click, before awaiting the API. The Google page gets no opener.
    const reserved = desktop ? null : window.open(`/api/v1/google/result/${client}/${purpose}/pending`, '_blank')
    if (reserved) reserved.opener = null
    popup.current = reserved
    try {
      const result = await trackingRequest('google/start', { purpose, client }) as { flowId: string; url: string }
      const url = new URL(result.url)
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.port || url.username || url.password || url.pathname !== '/o/oauth2/v2/auth'
        || typeof result.flowId !== 'string' || result.flowId.length < 20 || result.flowId.length > 200) throw new Error('Google bağlantısı başlatılamadı. Yeniden deneyin.')
      const pending = { flowId: result.flowId, url: url.href, startedAt: Date.now(), ...(rememberMe === undefined ? {} : { rememberMe }) }
      saveGoogleFlow(purpose, pending)
      if (!mounted.current) { reserved?.close(); return }
      setFlow(pending)
      setNotice(reserved || desktop ? 'Google ekranı açılıyor. İşlem tamamlanınca HasarBotu otomatik güncellenecek.' : 'Tarayıcınız yeni sekmeyi engelledi. Aşağıdaki bağlantıyla Google ekranını açın.')
      if (desktop) window.open(url.href, '_blank', 'noopener,noreferrer')
      else if (reserved && !reserved.closed) reserved.location.replace(url.href)
    } catch {
      reserved?.close()
      if (mounted.current) { setNotice('Google bağlantısı başlatılamadı. Bağlantınızı kontrol edip yeniden deneyin.'); setOutcome('failed') }
    } finally { starting.current = false; if (mounted.current) setBusy(false) }
  }
  return <div className="google-connect">
    <button className="button button--secondary google-connect__button" type="button" disabled={!enabled || busy || flow !== null} onClick={() => { void start() }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3c-.9.6-2 .9-3.4.9a6 6 0 1 1 4-10.5l3-2.9A10 10 0 1 0 12 22c2.7 0 5-1 6.7-2.5 1.9-1.8 2.9-4.2 2.9-7.3Z"/></svg>
      {busy ? 'Google bağlantısı hazırlanıyor…' : purpose === 'login' ? 'Kurumsal Google hesabıyla giriş' : 'SBM e-posta hesabını bağla'}
    </button>
    {!enabled && <small>Google bağlantısı henüz yapılandırılmamış.</small>}
    {(flow || notice) && <div className={`google-connect__notice${outcome === 'complete' ? ' google-connect__notice--success' : ''}`} role={outcome && !['complete', 'approval_required'].includes(outcome) ? 'alert' : 'status'} aria-live="polite">
      {flow && <span className="google-connect__spinner" aria-hidden="true" />}
      <span>{notice || 'Google bağlantısı kontrol ediliyor…'}</span>
    </div>}
    {flow?.url && <a className="google-connect__retry" href={flow.url} target="_blank" rel="noopener noreferrer">Google sayfasını yeniden aç</a>}
  </div>
}
