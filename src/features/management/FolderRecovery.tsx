import { useEffect, useRef, useState } from 'react'
import { folderCheckSchema, folderManagementResponseSchema, type FolderManagementResponse, type FolderManagementDecision } from '@hasarbotu/contracts'
import { trackingRequest } from '../tracking/trackingApi'
import { ModalFrame } from '../../components/ModalFrame'

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
  const [data, setData] = useState<FolderManagementResponse | null>(null)
  const [includeRemoved, setIncludeRemoved] = useState(false)
  const [decision, setDecision] = useState<{ item: FolderManagementResponse['items'][number]; action: FolderManagementDecision['action'] } | null>(null)
  const [reason, setReason] = useState<FolderManagementDecision['reason']>('missing_folder')
  const [explanation, setExplanation] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [decisionError, setDecisionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const load = async (plate: string, signal: AbortSignal) => folderManagementResponseSchema.parse(await trackingRequest(
    'administration/folder-management?' + new URLSearchParams({ search: plate, includeRemoved: String(includeRemoved) }), undefined, signal))

  async function run(check: boolean) {
    const plate = search.trim()
    if (!plate || controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(true); setChecking(check); setError(''); setNotice(''); setData(null)
    try {
      if (!check) {
        const response = await load(plate, current.signal)
        if (!current.signal.aborted) setData(response)
      }
      else {
        const requested = folderCheckSchema.parse(await trackingRequest('administration/folder-recovery/check', {}, current.signal))
        setNotice('Ofis klasörleri kontrol ediliyor…')
        const deadline = Date.now() + 90_000
        let completed = false
        while (Date.now() < deadline) {
          const response = await load(plate, current.signal)
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
      if (!current.signal.aborted) { setBusy(false); setChecking(false) }
      if (controller.current === current) controller.current = null
    }
  }

  function choose(item: FolderManagementResponse['items'][number], action: FolderManagementDecision['action']) {
    setDecision({ item, action }); setReason(action === 'dispute' ? 'wrong_link' : 'missing_folder')
    setExplanation(''); setAcknowledged(false); setDecisionError('')
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path)
      setError(''); setNotice('Kayıtlı göreli klasör yolu kopyalandı.')
    } catch { setError('Yol kopyalanamadı. Tablodaki yolu seçip kopyalayın.') }
  }

  async function saveDecision() {
    if (!decision || !acknowledged || explanation.trim().length < 3 || controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(true); setDecisionError(''); setError(''); setNotice('')
    let saved = false
    try {
      await trackingRequest(`administration/folder-management/${encodeURIComponent(decision.item.caseId)}/decision`, {
        action: decision.action, expectedVersion: decision.item.version, expectedLocationVersion: decision.item.locationVersion, reason, explanation: explanation.trim(),
      } satisfies FolderManagementDecision, current.signal)
      saved = true
      setDecision(null); setData(null)
      setNotice(decision.action === 'remove'
        ? 'Kayıt bottan kaldırıldı. Otomatik tarama geri getirmez. Geri almak için “Kaldırılanları da göster” seçeneğini kullanın. Diskteki klasörler ve kayıt geçmişi korundu.'
        : decision.action === 'recover'
          ? 'Geri getirme izni kaydedildi. “Kontrol et ve düzelt” ile klasör kimliğini doğrulatın; doğrulama tamamlanana kadar kayıt arşivde kalır.'
          : 'Kayıtlı klasörün yeniden doğrulaması sıraya alındı; klasöre yazma işlemleri doğrulama bekler. Sonucu Bul ile yenileyin. Klasör taşındıysa “Kontrol et ve düzelt” işlemini kullanın.')
      setData(await load(search.trim(), current.signal))
    } catch (cause) {
      if (!current.signal.aborted) {
        const message = cause instanceof Error ? cause.message : 'İşlem yapılamadı.'
        if (saved) setError('Karar kaydedildi, liste yenilenemedi. Bul ile yenileyin. ' + message)
        else setDecisionError(message)
      }
    } finally {
      if (!current.signal.aborted) setBusy(false)
      if (controller.current === current) controller.current = null
    }
  }

  return <section className="office-table-panel">
    <header className="panel-heading"><div><h2>Klasör Bağlantıları</h2><span>Eksik klasör, yanlış bağlantı veya mükerrer kayıt için plakayı arayın.</span></div></header>
    <p>Klasör taşınmışsa sabit klasör kimliği ve kayıtlı belgeler doğrulanarak mevcut kayıt onarılır. Kayıtlar ve belgeler korunur.</p>
    <form className="filter-bar" onSubmit={event => { event.preventDefault(); void run(false) }}>
      <label>Plaka<input value={search} maxLength={120} required disabled={busy} onChange={event => { setSearch(event.target.value); setData(null); setNotice(''); setError('') }} placeholder="Örn. 72ACJ327" /></label>
      <button className="button button--secondary" type="submit" disabled={busy || !search.trim()}>Bul</button>
      <button className="button button--primary" type="button" disabled={busy || !search.trim()} onClick={() => { void run(true) }}>{busy ? 'Kontrol sürüyor…' : 'Kontrol et ve düzelt'}</button>
      <label><input type="checkbox" checked={includeRemoved} disabled={busy} onChange={event => { setIncludeRemoved(event.target.checked); setData(null); setNotice(''); setError('') }} />Kaldırılanları da göster</label>
    </form>
    {checking && <button type="button" className="button button--secondary" onClick={() => {
      controller.current?.abort(); controller.current = null; setBusy(false); setChecking(false)
      setNotice('Bekleme durduruldu. Sunucudaki tarama devam edebilir; sonucu Bul ile yenileyin.')
    }}>Kontrol sonucunu beklemeyi bırak</button>}
    <p>Kontrol tüm ofis klasörlerini tarar. “Bağlantı doğrulanmış” son kayıtlı doğrulamadır; anlık disk kontrolü değildir. Aynı plaka farklı hasarlara ait olabilir; işlemden önce dosya numarasını ve ayrıntıları karşılaştırın.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {data?.truncated && <p role="status">İlk 50 kayıt gösteriliyor. Plakayı tam yazarak aramayı daraltın.</p>}
    {data && (data.items.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Plaka</th><th>Dosya No</th><th>Kayıtlı Klasör</th><th>Durum</th><th>İşlemler</th></tr></thead>
      <tbody>{data.items.map(item => <tr key={item.caseId}>
        <td>{item.plate}</td><td>{item.officeNumber}</td><td>{item.relativePath ?? 'Klasör bağlantısı yok'}</td>
        <td>{item.disposition === 'removed' ? 'Bottan kaldırılmış' : statusLabels[item.status]}{item.disposition === 'recovery_requested' && item.archived && <p>Geri getirme doğrulaması bekleniyor</p>}</td>
        <td><details><summary>Ayrıntılar ve işlemler · {item.officeNumber}</summary>
          <p>Kayıt: {item.caseId}<br />Depolama alanı: {item.storageRootKey ?? 'Yok'}<br />Klasör kimliği: {item.sourceFolderId ?? 'Yok'}<br />Klasör konumunun son güncellemesi: {item.locationUpdatedAt ? new Date(item.locationUpdatedAt).toLocaleString('tr-TR') : 'Yok'}<br />
            Hasar dosya no: {item.insurerClaimNumber ?? 'Kayıtlı değil'} · Hasar tarihi: {item.lossDate ?? 'Kayıtlı değil'} · {item.caseType === 'casco' ? 'Kasko' : item.caseType === 'traffic' ? 'Trafik' : 'Tür belirtilmemiş'}<br />
            {item.documentCount} belge · {item.noteCount} not · {item.lifecycleStatus === 'closed' ? 'Kapalı dosya' : 'Açık dosya'}{item.archived ? ' · Arşivde' : ''}</p>
          {item.explanation && <p>Son yönetici açıklaması: {item.explanation}</p>}
          {!item.archived && <a className="button button--secondary" href={`/dosyalar/${encodeURIComponent(item.caseId)}`}>Dosyayı aç</a>}
          {item.archived && <p>Arşivdeki dosya, klasörü doğrulanarak geri getirildikten sonra açılabilir.</p>}
          {item.relativePath && <button type="button" className="button button--secondary" disabled={busy} onClick={() => { void copyPath(item.relativePath!) }}>Kayıtlı yolu kopyala</button>}
          {item.hasActiveOperations && <p>Devam eden klasör veya fotoğraf işlemi var; kayıt değişiklikleri tamamlanmasını bekler.</p>}
          {item.disposition !== 'removed' && <>
            <button type="button" className="button button--secondary" disabled={busy || item.hasActiveOperations || !item.relativePath} onClick={() => choose(item, 'dispute')}>Kayıtlı klasörü yeniden doğrula</button>
            <button type="button" className="button button--secondary" disabled={busy || item.hasActiveOperations} onClick={() => choose(item, 'remove')}>Bottan kaldır</button>
          </>}
          {item.archived && <button type="button" className="button button--secondary" disabled={busy || item.hasActiveOperations} onClick={() => choose(item, 'recover')}>{item.disposition === 'removed' ? 'Kaldırmayı geri al' : 'Doğrulayarak geri getir'}</button>}
        </details></td>
      </tr>)}</tbody>
    </table></div> : <p>Bu plakayla kayıt bulunamadı. Plakayı ve ofis klasörünün adını kontrol edin.</p>)}
    <p>Klasör taşındıysa kontrolü çalıştırın. Bulunamayan veya mükerrer kaydı “Bottan kaldır” ile listelerden kaldırabilirsiniz; diskten dosya silinmez, belgeler ve geçmiş geri alma için korunur. Yanlış bağlantıda klasör yolunu tahminen değiştirmeyin; kayıtlı klasörü yeniden doğrulatın. Bu işlem aynı plakalı kayıtları birleştirmez. Elle arşivlenen kayıtta geri getirme izni ayrıca verilir.</p>
    {decision && <ModalFrame labelledBy="folder-decision-title" onClose={() => setDecision(null)} busy={busy} role="alertdialog">
      <form onSubmit={event => { event.preventDefault(); void saveDecision() }}>
        <header className="modal-header"><h2 id="folder-decision-title">{decision.action === 'remove' ? 'Kaydı bottan kaldır' : decision.action === 'recover' ? 'Doğrulayarak geri getirme izni ver' : 'Kayıtlı klasörü yeniden doğrula'}</h2></header>
        <div className="modal-body">
          <p><strong>{decision.item.plate} · {decision.item.officeNumber}</strong><br />{decision.item.relativePath ?? 'Klasör bağlantısı yok'}</p>
          <p>{decision.action === 'remove' ? 'Yalnız bu kayıt tüm normal bot listelerinden kaldırılır ve tarama ile kendiliğinden geri gelmez. Diskteki klasörler, belgeler, notlar ve denetim geçmişi korunur. Kaldırılanları göstererek geri alabilirsiniz.'
            : decision.action === 'recover' ? 'Kayıt, klasör kimliği doğrulanana kadar arşivde kalır. Ardından Kontrol et ve düzelt işlemini çalıştırın. Kapalı dosyanın iş durumu bu izinle değiştirilmez.'
              : 'Bu bağlantıyla klasöre yeni yazma işlemleri doğrulama bekler. Arka planda kayıtlı dizinin varlığı denetlenir; yol veya dosya sahipliği değiştirilmez. Taşınan klasörleri bulmak için ayrıca Kontrol et ve düzelt işlemini kullanın.'}</p>
          <label>Neden<select value={reason} disabled={busy} onChange={event => setReason(event.target.value as FolderManagementDecision['reason'])}>
            <option value="missing_folder">Klasör bulunamıyor / silinmiş</option><option value="duplicate">Mükerrer kayıt</option><option value="wrong_link">Yanlış klasör bağlantısı</option><option value="other">Diğer / geri getirme</option>
          </select></label>
          <label>Açıklama<textarea value={explanation} minLength={3} maxLength={1000} required disabled={busy} onChange={event => setExplanation(event.target.value)} /></label>
          <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />Plaka, dosya numarası ve klasörü karşılaştırdım; yalnız bu kayıt için işlemi onaylıyorum.</label>
          {decisionError && <p role="alert">{decisionError}</p>}
        </div>
        <footer className="modal-footer"><button type="button" className="button button--secondary" disabled={busy} onClick={() => setDecision(null)}>Vazgeç</button><button type="submit" className="button button--primary" disabled={busy || !acknowledged || explanation.trim().length < 3}>{busy ? 'Kaydediliyor…' : 'İşlemi onayla'}</button></footer>
      </form>
    </ModalFrame>}
  </section>
}
