import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import type { NotificationPreferencesResponse } from '@hasarbotu/contracts'
import { useSession } from '../../app/sessionContext'

export function NotificationPreferencesEditor() {
  const { user, reportUnauthorized } = useSession()
  const [data, setData] = useState<NotificationPreferencesResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/me/notification-preferences', { credentials: 'include', signal: controller.signal }).then(async response => {
      if (response.status === 401) reportUnauthorized()
      if (!response.ok) throw new Error('read_failed')
      const { notificationPreferencesResponseSchema } = await import('@hasarbotu/contracts')
      const value = notificationPreferencesResponseSchema.parse(await response.json())
      if (!controller.signal.aborted && value.userId === user?.id) { setData(value); setError('') }
    }).catch(() => { if (!controller.signal.aborted) setError('Bildirim ayarları alınamadı. Yeniden deneyin.') })
    return () => controller.abort()
  }, [user?.id, reportUnauthorized, revision])
  return <section className="settings-section"><header><Bell size={19} /><div><h2>Bildirim tercihlerim</h2><span>Hesabınıza özel · tüm cihazlarda geçerli</span></div></header>
    <p>Tramer sonuçları bu ayarlardan etkilenmez; büyük bir pencereyle gösterilir. Bildirimler gelen kutunuzda korunur.</p>
    {data ? <form onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      setBusy(true); setError(''); setNotice('')
      try {
        const response = await fetch('/api/v1/me/notification-preferences', { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedUserId: data.userId, expectedVersion: data.version, preferences: data.preferences }) })
        if (response.status === 401) reportUnauthorized()
        if (!response.ok) throw new Error(response.status === 409 ? 'conflict' : 'save_failed')
        const { notificationPreferencesResponseSchema } = await import('@hasarbotu/contracts')
        setData(notificationPreferencesResponseSchema.parse(await response.json()))
        setNotice('Bildirim tercihleriniz kaydedildi.')
        window.dispatchEvent(new Event('tracking-updated'))
      } catch (reason) { setError(reason instanceof Error && reason.message === 'conflict' ? 'Ayarlar başka oturumda değişti. Yeniden yükleyin.' : 'Bildirim ayarları kaydedilemedi. Yeniden deneyin.') }
      finally { setBusy(false) }
    }}><fieldset disabled={busy}>{([['showPopups', 'Bildirim pencerelerini göster'], ['playSound', 'Bildirim sesini aç'], ['assistantReaction', 'Touch bildirim tepkilerini göster']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={data.preferences[key]} onChange={event => { setData({ ...data, preferences: { ...data.preferences, [key]: event.target.checked } }); setNotice('') }} /> {label}</label>)}</fieldset><button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Bildirim tercihlerini kaydet'}</button></form> : !error && <p role="status">Bildirim tercihleri yükleniyor…</p>}
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Yeniden yükle</button></p>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
