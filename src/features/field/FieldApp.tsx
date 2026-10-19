import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowUpRight, Camera, Check, CheckCircle2, ChevronRight, ImagePlus, LogOut, Search, ShieldCheck, Upload, X } from 'lucide-react'
import { useSession } from '../../app/sessionContext'
import { HttpAuthError } from '../../data/authPort'
import { GoogleConnectButton } from '../tracking/GoogleConnectButton'
import { fieldRequest, uploadFieldPhoto, fieldErrorMessage, FIELD_KIND_LABELS, FieldApiError, type FieldCase, type FieldUpload, type FieldPhotoKind } from './field-api'
import './field.css'

function FieldLogin() {
  const session = useSession()
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [remember, setRemember] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { await session.login(email.trim(), password, remember) }
    catch (error) { setError(error instanceof HttpAuthError && error.kind === 'invalid_credentials' ? 'E-posta veya parola hatalı.' : error instanceof HttpAuthError && error.kind === 'rate_limited' ? 'Çok fazla deneme yapıldı. Bir süre sonra tekrar deneyin.' : 'Giriş yapılamadı. İnternet bağlantınızı kontrol edin.') }
    finally { setBusy(false) }
  }
  return <main className="field-login"><div className="field-login__intro"><img src="/brand/logo-mark.svg" alt="HasarBotu" width="44" height="44" /><span className="field-eyebrow">HASARBOTU · SAHA</span><h1>Sahadan çekin.<br />Dosyasına ulaşsın.</h1><p>Hasar, şase ve kilometre fotoğraflarını<br className="field-wide" /> doğrudan doğru plakanın dosyasına yükleyin.</p><div className="field-login__steps"><span><Search size={18} /> Plakayı bulun</span><span><Camera size={18} /> Fotoğrafları seçin</span><span><CheckCircle2 size={18} /> Ofise ulaştırın</span></div></div>
    <form className="field-card field-login__form" onSubmit={event => { void submit(event) }}><span className="field-eyebrow">OFİS HESABINIZ</span><h2>Hoş geldiniz</h2><p>Devam etmek için hesabınıza giriş yapın.</p>
      {session.status === 'expired' && <p role="alert" className="field-alert">Oturumunuz sona erdi. Tekrar giriş yapın.</p>}
      <label>E-posta<input name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Parola<input name="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label className="field-check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /><span>Bu cihazda oturumumu hatırla</span></label>
      <details className="field-cookie-info"><summary>Çerez tercihim ne anlama geliyor?</summary><p>Giriş için gerekli güvenli oturum çerezi kullanılır. İzin verirseniz bu çerez tarayıcı kapandıktan sonra da en fazla 12 saat tutulur. İzin vermezseniz kalıcı oturum çerezi oluşturulmaz. Parolanız kaydedilmez; reklam ve izleme çerezi kullanılmaz. Çıkış yaptığınızda oturum çerezi silinir.</p></details>
      {error && <p role="alert" className="field-alert">{error}</p>}
      <button className="field-button field-button--primary" disabled={busy} type="submit">{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}<ArrowUpRight size={18} /></button>
      <div className="field-login-divider"><span>veya</span></div>
      <GoogleConnectButton purpose="login" rememberMe={remember} />
      <div className="field-trust"><ShieldCheck size={16} /><span>Yalnızca yetkili ofis kullanıcıları</span></div>
    </form></main>
}

interface QueuePhoto { id: number; file: File; kind: FieldPhotoKind; preview: string | null; status: 'waiting' | 'uploading' | 'sent' | 'paused'; progress: number; error?: string }
let photoSequence = 0
const statusLabels = { receiving: 'Yükleme sürüyor', queued: 'Ofise aktarım bekliyor', processing: 'Hazırlanıyor', ready: 'Ofis klasörüne kaydedildi', failed: 'İşlenemedi' }
function FieldWorkspace() {
  const { user, logout, reportUnauthorized } = useSession()
  const [query, setQuery] = useState(''), [results, setResults] = useState<FieldCase[]>([]), [searched, setSearched] = useState(false), [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FieldCase | null>(null), [kind, setKind] = useState<FieldPhotoKind>('damage')
  const [queue, setQueue] = useState<QueuePhoto[]>([]), [uploads, setUploads] = useState<FieldUpload[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [historyError, setHistoryError] = useState('')
  const controller = useRef<AbortController | null>(null), mounted = useRef(true), previews = useRef<string[]>([]), searchVersion = useRef(0)
  const caseId = selected?.id
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); previews.current.forEach(url => URL.revokeObjectURL(url)) } }, [])
  useEffect(() => {
    if (!caseId) return
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try { const response = await fieldRequest<{ items: FieldUpload[] }>(`/cases/${caseId}/photos`, { signal: abort.signal }); if (!abort.signal.aborted) { setUploads(response.items); setHistoryError('') } }
      catch (error) { if (!abort.signal.aborted) { if (error instanceof FieldApiError && error.status === 401) reportUnauthorized(); setHistoryError('Yükleme listesi yenilenemedi. Bağlantı gelince tekrar kontrol edilecek.') } }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => { void load() }, 4000) }
    }
    void load(); return () => { abort.abort(); clearTimeout(timer) }
  }, [caseId, reportUnauthorized])
  async function search(event: FormEvent) {
    event.preventDefault(); const version = ++searchVersion.current
    if (query.replace(/\s/gu, '').length < 2) { setError('Plakanın en az 2 karakterini yazın.'); return }
    setSearching(true); setError('')
    try { const response = await fieldRequest<{ items: FieldCase[] }>(`/cases?q=${encodeURIComponent(query.trim())}`); if (version === searchVersion.current) { setResults(response.items); setSearched(true) } }
    catch (error) { if (error instanceof FieldApiError && error.status === 401) reportUnauthorized(); setError(fieldErrorMessage(error)) }
    finally { if (version === searchVersion.current) setSearching(false) }
  }
  function add(files: FileList | null) {
    if (!files) return
    const additions: QueuePhoto[] = []
    for (const file of Array.from(files)) {
      if (queue.length + additions.length >= 100) { setError('Bir seferde en fazla 100 fotoğraf seçebilirsiniz.'); break }
      if (file.size === 0 || file.size > 40 * 1024 * 1024) { setError(`${file.name}: Fotoğraf en fazla 40 MB olabilir.`); continue }
      if (queue.some(photo => photo.file.name === file.name && photo.file.size === file.size && photo.file.lastModified === file.lastModified && photo.kind === kind)) continue
      const preview = /^image\/(jpeg|png|webp)$/u.test(file.type) ? URL.createObjectURL(file) : null
      if (preview) previews.current.push(preview)
      additions.push({ id: ++photoSequence, file, kind, preview, status: 'waiting', progress: 0 })
    }
    setQueue(previous => [...previous, ...additions])
  }
  async function send() {
    if (busy || !selected || !user) return
    setBusy(true); setError(''); controller.current = new AbortController()
    const change = (id: number, update: Partial<QueuePhoto>) => { if (mounted.current) setQueue(current => current.map(photo => photo.id === id ? { ...photo, ...update } : photo)) }
    try {
      for (const photo of queue.filter(item => item.status !== 'sent')) {
        if (controller.current.signal.aborted) throw new DOMException('Upload paused', 'AbortError')
        change(photo.id, { status: 'uploading', error: undefined })
        try {
          const upload = await uploadFieldPhoto({ file: photo.file, kind: photo.kind, caseId: selected.id, userId: user.id, signal: controller.current.signal, onProgress: progress => change(photo.id, { progress }) })
          change(photo.id, { status: 'sent', progress: 100 }); if (mounted.current) setUploads(current => [upload, ...current.filter(item => item.id !== upload.id)])
        } catch (error) {
          change(photo.id, { status: 'paused', error: controller.current.signal.aborted ? 'Durduruldu. Tekrar başlatarak devam edebilirsiniz.' : fieldErrorMessage(error) })
          if (error instanceof FieldApiError && error.status === 401) reportUnauthorized()
          break
        }
      }
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setError(fieldErrorMessage(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const pending = queue.filter(photo => photo.status !== 'sent').length
  async function retryPublished(uploadId: string) {
    try { await fieldRequest(`/uploads/${uploadId}/retry`, { method: 'POST' }); setUploads(current => current.map(upload => upload.id === uploadId ? { ...upload, status: 'queued', errorCode: null } : upload)); setError('') }
    catch (error) { if (error instanceof FieldApiError && error.status === 401) reportUnauthorized(); setError(fieldErrorMessage(error)) }
  }
  async function cancelUpload(uploadId: string) {
    try { await fieldRequest(`/uploads/${uploadId}/cancel`, { method: 'POST' }); setUploads(current => current.map(upload => upload.id === uploadId ? { ...upload, status: 'failed', errorCode: 'upload_cancelled' } : upload)) }
    catch (error) { if (error instanceof FieldApiError && error.status === 401) reportUnauthorized(); setError(fieldErrorMessage(error)) }
  }
  function removePhoto(id: number) {
    const preview = queue.find(photo => photo.id === id)?.preview
    if (preview) {
      URL.revokeObjectURL(preview)
      previews.current = previews.current.filter(url => url !== preview)
    }
    setQueue(current => current.filter(photo => photo.id !== id))
  }
  function clearSelection() { setSelected(null); setQueue([]); setUploads([]); setError(''); previews.current.forEach(url => URL.revokeObjectURL(url)); previews.current = [] }
  return <><header className="field-topbar"><a className="field-brand" href="/saha"><img src="/brand/logo-mark.svg" width="32" height="32" alt="" /><strong>HasarBotu<span>Saha fotoğrafları</span></strong></a><div className="field-account"><span title={user?.displayName}>{user?.displayName}</span><button type="button" aria-label="Oturumu kapat" disabled={busy} onClick={() => { void logout() }}><LogOut size={20} /></button></div></header>
    <main className="field-workspace">
      {!selected ? <><div className="field-heading"><span className="field-eyebrow">SAHADAN OFİSE</span><h1>Hangi dosyaya<br className="field-small" /> fotoğraf yükleyeceksiniz?</h1><p>Plakayı bulun, fotoğrafları seçin. Gerisini biz hazırlayalım.</p></div>
        <form className="field-search field-card" onSubmit={event => { void search(event) }}><label htmlFor="field-plate">Plaka ara</label><div><Search size={20} /><input id="field-plate" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} placeholder="Örn. 34 ABC 123" value={query} onChange={event => setQuery(event.target.value.toLocaleUpperCase('tr'))} /><button className="field-button field-button--primary" disabled={searching}>{searching ? 'Aranıyor…' : 'Ara'}</button></div></form>
        {error && <p role="alert" className="field-alert">{error}</p>}
        {searched && <section className="field-results" aria-label="Bulunan dosyalar"><h2>{results.length ? 'Dosyayı seçin' : 'Dosya bulunamadı'}</h2>{!results.length && <p>Plakayı kontrol edip tekrar arayın. Yalnızca ofis dosyaları gösterilir.</p>}<div className="field-case-grid">{results.map(item => <button type="button" className="field-card field-case" key={item.id} onClick={() => { setSelected(item); setError('') }}><div><span className="field-plate">{item.plate}</span><p>{item.officeNumber}</p></div><div><span className={`field-badge ${item.status === 'closed' ? 'field-badge--muted' : ''}`}>{item.status === 'open' ? 'Açık' : 'Kapalı'}</span><ChevronRight size={20} /></div></button>)}</div></section>}
        {!searched && <div className="field-empty-intro"><div><Camera size={25} /></div><h2>Fotoğraflar doğru yerde.</h2><p>Hasar, şase ve kilometre görselleri<br />seçtiğiniz dosyaya düzenli olarak kaydedilir.</p></div>}
      </> : <><button className="field-back" type="button" disabled={busy} onClick={clearSelection}><ArrowLeft size={18} /> Plaka aramaya dön</button><div className="field-selected"><div><span className="field-eyebrow">SEÇİLEN DOSYA · {selected.officeNumber}</span><h1>{selected.plate}</h1></div><span className="field-badge">{selected.status === 'open' ? 'Açık dosya' : 'Kapalı dosya'}</span></div>
        {!selected.canUpload ? <p role="alert" className="field-alert">Bu dosya kapalı veya klasörü henüz hazır değil. Şu anda fotoğraf yüklenemez.</p> : <section className="field-card field-picker"><h2>Fotoğrafları ekleyin</h2><p>Önce fotoğraf türünü seçin.</p><div className="field-kind-tabs" role="group" aria-label="Fotoğraf türü">{(Object.keys(FIELD_KIND_LABELS) as FieldPhotoKind[]).map(value => <button key={value} type="button" aria-pressed={kind === value} disabled={busy} onClick={() => setKind(value)}>{kind === value && <Check size={16} />}{FIELD_KIND_LABELS[value]}</button>)}</div>
          <p className="field-naming">{kind === 'damage' ? 'HASAR 101, HASAR 102… şeklinde sıralanır.' : kind === 'chassis' ? 'ŞASE adıyla kaydedilir.' : 'KM adıyla kaydedilir.'} Mevcut fotoğraflar korunur.</p>
          <div className="field-pick-actions"><label className={`field-button field-button--primary ${busy ? 'is-disabled' : ''}`}><Camera size={20} /> Fotoğraf çek<input aria-label="Kameradan fotoğraf çek" type="file" accept="image/*,.heic,.heif" capture="environment" disabled={busy} onChange={event => { add(event.target.files); event.target.value = '' }} /></label><label className={`field-button field-button--secondary ${busy ? 'is-disabled' : ''}`}><ImagePlus size={20} /> Galeriden seç<input aria-label="Galeriden fotoğraf seç" type="file" accept="image/*,.heic,.heif" multiple disabled={busy} onChange={event => { add(event.target.files); event.target.value = '' }} /></label></div>
          <p className="field-note">JPEG, PNG, WebP, HEIC ve AVIF · Fotoğraf başına en fazla 40 MB</p>
        </section>}
        {error && <p role="alert" className="field-alert">{error}</p>}
        {queue.length > 0 && <section className="field-card field-queue"><div className="field-section-title"><h2>Seçilen fotoğraflar</h2><span>{queue.length}</span></div><div className="field-photo-grid">{queue.map(photo => <article className="field-photo" key={photo.id}><div className="field-photo__image">{photo.preview ? <img src={photo.preview} alt={`${FIELD_KIND_LABELS[photo.kind]} önizlemesi`} /> : <Camera size={32} />}{!busy && photo.status !== 'sent' && <button type="button" aria-label={`${photo.file.name} seçimini kaldır`} onClick={() => removePhoto(photo.id)}><X size={16} /></button>}{photo.status === 'sent' && <span className="field-photo__sent"><CheckCircle2 size={20} /></span>}</div><div className="field-photo__details"><strong>{FIELD_KIND_LABELS[photo.kind]}</strong><span title={photo.file.name}>{photo.file.name}</span><p>{photo.status === 'sent' ? 'Sunucuya ulaştı' : photo.status === 'uploading' ? `%${photo.progress} yükleniyor` : photo.status === 'paused' ? 'Devam etmeyi bekliyor' : 'Yüklemeye hazır'}</p>{photo.status === 'uploading' && <progress aria-label={`${photo.file.name} yükleme ilerlemesi`} max={100} value={photo.progress} />}{photo.error && <p className="field-inline-error" role="alert">{photo.error}</p>}</div></article>)}</div>
          <div className="field-upload-actions"><div><strong>{pending ? `${pending} fotoğraf yüklenmeyi bekliyor` : 'Seçilen fotoğraflar sunucuya ulaştı'}</strong><p>Ofis klasörüne kayıt durumunu aşağıdan izleyebilirsiniz.</p></div>{busy ? <button className="field-button field-button--secondary" onClick={() => controller.current?.abort()}>Durdur</button> : <button className="field-button field-button--primary" disabled={!pending} onClick={() => { void send() }}><Upload size={18} />{pending ? `${pending} fotoğrafı yükle` : 'Yükleme tamamlandı'}</button>}</div>
        </section>}
        <section className="field-history"><div className="field-section-title"><h2>Dosyaya yüklenenler</h2><span>{uploads.length}</span></div>{historyError && <p role="status">{historyError}</p>}{!uploads.length && !historyError && <div className="field-history-empty"><Camera size={24} /><p>Bu ekrandan henüz fotoğraf yüklenmedi.</p></div>}<div className="field-history-grid">{uploads.map(upload => <article className="field-card field-history-item" key={upload.id}>{upload.status === 'ready' ? <a href={`/api/v1/field/uploads/${upload.id}/jpeg`} target="_blank" rel="noreferrer"><img src={`/api/v1/field/uploads/${upload.id}/jpeg`} alt={upload.outputFileName ?? FIELD_KIND_LABELS[upload.kind]} loading="lazy" /></a> : <div className="field-history-item__pending"><Camera size={24} /></div>}<div><strong>{upload.outputFileName ?? FIELD_KIND_LABELS[upload.kind]}</strong><span className={upload.status === 'failed' ? 'field-inline-error' : ''}>{statusLabels[upload.status]}</span><small>{upload.uploadedBy} · {new Date(upload.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</small>{upload.errorCode && <p>{fieldErrorMessage(new FieldApiError(upload.errorCode, 409))}</p>}{upload.outputBytes !== null && <small>{Math.round(upload.outputBytes / 1024)} KB · JPEG</small>}{upload.status === 'receiving' && upload.uploadedByUserId === user?.id && <button className="field-retry" type="button" disabled={busy} onClick={() => { void cancelUpload(upload.id) }}>Yüklemeyi iptal et</button>}{upload.status === 'failed' && ['storage_unavailable','case_not_fresh','photo_write_failed','case_busy','case_location_changed'].includes(upload.errorCode ?? '') && <button className="field-retry" type="button" onClick={() => { void retryPublished(upload.id) }}>Yeniden aktar</button>}{upload.status === 'ready' && <a className="field-original" href={`/api/v1/field/uploads/${upload.id}/original`}>Orijinali indir <ArrowUpRight size={13} /></a>}</div></article>)}</div></section>
      </>}
      <footer className="field-footer"><ShieldCheck size={16} /><span>Orijinaller korunur. Ofis kopyaları 100–600 KB JPEG olarak hazırlanır.</span></footer>
    </main></>
}
export function FieldApp() {
  const session = useSession()
  if (session.status === 'bootstrapping') return <main className="field-loading" role="status">Oturumunuz kontrol ediliyor…</main>
  if (session.status !== 'authenticated') return <FieldLogin />
  if (!session.user?.roles.some(role => ['admin','expert','case_manager','secretary'].includes(role))) return <main className="field-loading"><h1>Saha yükleme yetkiniz yok</h1><p>Ofis yöneticinizle görüşün.</p><button className="field-button" onClick={() => { void session.logout() }}>Oturumu kapat</button></main>
  return <FieldWorkspace />
}
