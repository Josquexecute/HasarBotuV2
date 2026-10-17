import { useEffect, useMemo, useRef, useState } from 'react'
import type { AccountProfile } from '@hasarbotu/contracts'
import { useSession } from '../../app/sessionContext'
import { PROFILE_UPDATED_EVENT, USER_DIRECTORY_UPDATED_EVENT } from '../../app/userDirectory'
import { AccountProfileError, createAccountProfilePort, type AccountProfilePort } from '../../data/accountProfilePort'

export function AccountProfileEditor({ port: suppliedPort }: { port?: AccountProfilePort }) {
  const { user, reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createAccountProfilePort(), [suppliedPort])
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [name, setName] = useState('')
  const [generation, setGeneration] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const busy = useRef(false)
  const userId = user?.id
  useEffect(() => {
    const controller = new AbortController()
    void port.load(controller.signal).then(data => {
      if (controller.signal.aborted) return
      if (data.userId !== userId) throw new AccountProfileError('conflict')
      setProfile(data); setName(data.displayName); setError('')
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof AccountProfileError && failure.kind === 'unauthorized') reportUnauthorized()
      setError('Profil yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.')
    })
    return () => controller.abort()
  }, [generation, port, reportUnauthorized, userId])
  async function save() {
    if (!profile || busy.current) return
    busy.current = true; setSaving(true); setError(''); setNotice('')
    try {
      const { accountDisplayNameSchema } = await import('@hasarbotu/contracts')
      const parsed = accountDisplayNameSchema.safeParse(name)
      if (!parsed.success) { setError('Ad soyad 1–160 karakter olmalı ve kontrol karakteri içermemeli.'); return }
      const saved = await port.save(profile, parsed.data)
      if (saved.userId !== userId) throw new AccountProfileError('conflict')
      setProfile(saved); setName(saved.displayName)
      window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT))
      window.dispatchEvent(new Event(USER_DIRECTORY_UPDATED_EVENT))
      setNotice('Adınız soyadınız kaydedildi. Değişiklik tüm ofiste görünür.')
    } catch (failure) {
      if (failure instanceof AccountProfileError && failure.kind === 'unauthorized') reportUnauthorized()
      setError(failure instanceof AccountProfileError && failure.kind === 'conflict'
        ? 'Profil başka bir oturumda değişti. Güncel bilgileri yükleyip tekrar deneyin.'
        : 'Ad soyad kaydedilemedi. Yeniden deneyin.')
    } finally { busy.current = false; setSaving(false) }
  }
  return <form onSubmit={event => { event.preventDefault(); void save() }}>
    <label className="settings-field"><span>Ad Soyad</span><input autoComplete="name" required maxLength={160} value={name} disabled={!profile || saving} onChange={event => { setName(event.target.value); setNotice('') }} /></label>
    <p className="settings-description">Adınız ve soyadınız tüm ofis kullanıcılarına aynı şekilde görünür.</p>
    <div className="tracking-actions"><button className="button button--primary" disabled={!profile || saving || name.trim() === profile.displayName}>{saving ? 'Kaydediliyor…' : 'Ad Soyadı Kaydet'}</button>
      {error && <button className="button button--secondary" type="button" disabled={saving} onClick={() => setGeneration(value => value + 1)}>Güncel bilgileri yükle</button>}</div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </form>
}
