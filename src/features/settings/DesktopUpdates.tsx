import { useEffect, useState } from 'react'
import type { DesktopUpdatesSurface, DesktopUpdateState } from '@hasarbotu/contracts/desktop-update-state'
import { Download } from 'lucide-react'

export function DesktopUpdates({ suppliedSurface }: { suppliedSurface?: DesktopUpdatesSurface }) {
  const surface = suppliedSurface ?? (window as Window & { hasarbotuUpdates?: DesktopUpdatesSurface }).hasarbotuUpdates
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [error, setError] = useState('')
  useEffect(() => surface?.onState(setState), [surface])
  if (!surface) return null
  const run = async (action: 'check' | 'install') => {
    setError('')
    try { setState(await surface[action]()) }
    catch { setError('Güncelleme işlemi başlatılamadı. Uygulamayı yeniden açıp deneyin.') }
  }
  const busy = state && ['checking', 'downloading', 'installing'].includes(state.phase)
  const phase = state?.phase ?? 'idle'
  const messages = {
    idle: 'Yeni sürüm olup olmadığını kontrol edin.',
    checking: 'Güncellemeler kontrol ediliyor…',
    current: 'Bu bilgisayarda güncel sürüm kurulu.',
    available: `${state?.release?.version ?? ''} sürümü hazır.`,
    downloading: 'Güncelleme indiriliyor ve doğrulanıyor…',
    installing: 'Güncelleme kuruluyor. Uygulama yeniden açılacak.',
    disabled: state?.supported ? 'Henüz paylaşılan bir güncelleme yok.' : 'Güncelleme kurulu Windows uygulamasında kullanılabilir.',
    error: state?.message ?? 'Güncelleme kontrol edilemedi.',
  }
  return <section className="settings-section settings-section--updates"><header><Download size={19} /><div><h2>Uygulama güncellemeleri</h2><span>{state ? `Kurulu sürüm: ${state.currentVersion}` : 'Bu bilgisayar'}</span></div></header>
    <div className="desktop-updates-status">
    <p role="status">{messages[phase]}</p>
    {state?.release && phase === 'available' && <p style={{ whiteSpace: 'pre-line' }}>{state.release.notes}</p>}
    {phase === 'downloading' && state?.release && <progress aria-label="Güncelleme indirme" value={state.downloadedBytes} max={state.release.size} />}
    {error && <p role="alert">{error}</p>}
    </div>
    <div className="tracking-actions"><button type="button" className="button button--secondary" disabled={!!busy} onClick={() => { void run('check') }}>Güncellemeleri kontrol et</button>
    {phase === 'available' && <button type="button" className="button button--primary" onClick={() => { void run('install') }}>Güncelle ve yeniden başlat</button>}</div>
    {phase === 'available' && <p className="form-hint">Kurulumdan sonra uygulama yeniden açılır. Hesabınız ve ayarlarınız korunur.</p>}
  </section>
}
