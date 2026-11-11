import { useEffect, useRef, useState } from 'react'
import { folderCheckSchema, folderRecoveryResponseSchema, type FolderRecoveryResponse } from '@hasarbotu/contracts'
import { trackingRequest } from '../tracking/trackingApi'

const statusLabels = {
  verified: 'Bağlantı doğrulanmış',
  needs_check: 'Kontrol gerekiyor',
  manually_archived: 'Elle arşivlenmiş',
}
const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException('İşlem iptal edildi.', 'AbortError')) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1500)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
})

export function FolderRecovery() {
  const [search, setSearch] = useState('')
  const [data, setData] = useState<FolderRecoveryResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function run(check: boolean) {
    const plate = search.trim()
    if (!plate || controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(true); setError(''); setNotice(''); setData(null)
    const load = async () => folderRecoveryResponseSchema.parse(await trackingRequest(
      'administration/folder-recovery?' + new URLSearchParams({ search: plate }), undefined, current.signal))
    try {
      if (!check) setData(await load())
      else {
        const requested = folderCheckSchema.parse(await trackingRequest('administration/folder-recovery/check', {}, current.signal))
        setNotice('Ofis klasörleri kontrol ediliyor…')
        const deadline = Date.now() + 90_000
        let completed = false
        while (Date.now() < deadline) {
          const response = await load()
          if (current.signal.aborted) return
          setData(response)
          if (response.latestCheck?.id === requested.id && response.latestCheck.completedAt) {
            setNotice(`Kontrol tamamlandı. ${response.latestCheck.repaired ?? 0} düzeltme yapıldı. Aradığınız kaydın durumunu aşağıdan kontrol edin.`)
            completed = true
            break
          }
          await pause(current.signal)
        }
        if (!completed) setNotice('Kontrol henüz tamamlanmadı. Biraz sonra Bul ile sonucu sorgulayın; bu durum onarımın tamamlandığı anlamına gelmez.')
      }
    } catch (cause) {
      if (!current.signal.aborted) { setNotice(''); setError(cause instanceof Error ? cause.message : 'Klasör kontrolü yapılamadı.') }
    } finally {
      if (!current.signal.aborted) setBusy(false)
      controller.current = null
    }
  }

  return <section className="office-table-panel">
    <header className="panel-heading"><div><h2>Klasör Bağlantıları</h2><span>Botta görünmeyen dosyanın plakasını girin.</span></div></header>
    <p>Klasör taşınmışsa sabit klasör kimliği ve kayıtlı belgeler doğrulanarak mevcut kayıt onarılır. Kayıtlar ve belgeler korunur.</p>
    <form className="filter-bar" onSubmit={event => { event.preventDefault(); void run(false) }}>
      <label>Plaka<input value={search} maxLength={120} required disabled={busy} onChange={event => { setSearch(event.target.value); setData(null); setNotice(''); setError('') }} placeholder="Örn. 72ACJ327" /></label>
      <button className="button button--secondary" type="submit" disabled={busy || !search.trim()}>Bul</button>
      <button className="button button--primary" type="button" disabled={busy || !search.trim()} onClick={() => { void run(true) }}>{busy ? 'Kontrol sürüyor…' : 'Kontrol et ve düzelt'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {data && (data.items.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Plaka</th><th>Dosya No</th><th>Kayıtlı Klasör</th><th>Durum</th></tr></thead>
      <tbody>{data.items.map(item => <tr key={item.caseId}><td>{item.plate}</td><td>{item.officeNumber}</td><td>{item.relativePath ?? 'Klasör bağlantısı yok'}</td><td>{statusLabels[item.status]}</td></tr>)}</tbody>
    </table></div> : <p>Bu plakayla kayıt bulunamadı. Plakayı ve ofis klasörünün adını kontrol edin.</p>)}
    <p>“Kontrol gerekiyor” kalırsa eşleşme kanıtı yetersizdir veya klasörler çakışıyordur. Yeni kayıt oluşturmayın. Elle arşivlenen dosyalar bu işlemle açılmaz.</p>
  </section>
}
