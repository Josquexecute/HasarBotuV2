import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  History,
  Mail,
  NotebookPen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Scale,
  Wrench,
  X,
} from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatCurrency } from '../../mocks/cases'
import { useCases } from '../../data'
import { useSession } from '../../app/sessionContext'
import type { CaseRecord } from '../../types/case'
import { DocumentPhotoApiModule } from './DocumentPhotoApiModule'
import { CaseEditModal } from './CaseEditModal'
import { WorkspaceProvisioningPanel } from './WorkspaceProvisioningPanel'

const tabs = [
  'Özet',
  'Operasyon',
  'Evrak ve Fotoğraf',
  'İşçilik',
  'Ağır Hasar',
  'Değer Kaybı',
  'Raporlar ve Ücretler',
  'E-postalar',
  'Geçmiş',
] as const

type Tab = (typeof tabs)[number]

const tabDescriptions: Record<Tab, string> = {
  Özet: 'Dosyanın operasyonel durumu, kritik uyarıları ve son hareketleri.',
  Operasyon: 'Not, görev, görüşme ve takip kayıtlarının çalışma alanı.',
  'Evrak ve Fotoğraf': 'Koşullu evrak kontrolü ile belge ve fotoğraf metadata alanı.',
  İşçilik: 'Parça ve işçilik kalemleri için onay öncesi taslak görünüm.',
  'Ağır Hasar': 'PERT değerlendirmesi için veri ve kanaat ayrımı.',
  'Değer Kaybı': 'Trafik dosyası için zorunlu değer kaybı hazırlık durumu.',
  'Raporlar ve Ücretler': 'Rapor ve kapanma ücreti kontrol alanı.',
  'E-postalar': 'Dosya bağlamında kullanıcı onaylı taslaklar.',
  Geçmiş: 'Değişiklik ve işlem geçmişi.',
}

const mockPhotoIndexes = Array.from({ length: 108 }, (_, index) => index + 1)
const mockPhotoSource = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" viewBox="0 0 240 150">
    <rect width="240" height="150" fill="#d8dde6"/>
    <path d="M32 112l45-46 34 32 29-27 68 41z" fill="#9aa7ba"/>
    <circle cx="176" cy="44" r="15" fill="#b5c0cf"/>
    <rect x="1" y="1" width="238" height="148" fill="none" stroke="#8793a5" stroke-width="2"/>
  </svg>
`)}`

function CloseCaseModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="modal modal--small" role="dialog" aria-modal="true" aria-labelledby="close-case-title">
        <header className="modal__header">
          <div><span className="eyebrow eyebrow--danger">Kritik işlem önizlemesi</span><h2 id="close-case-title">Dosya Kapatma Kontrolü</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Pencereyi kapat"><X size={18} /></button>
        </header>
        <div className="modal__body">
          <div className="alert-panel alert-panel--warning">
            <AlertTriangle size={18} />
            <div><strong>Bu işlem prototipte uygulanmaz</strong><span>Gerçek kapatma, klasör taşıma veya veri yazma kodu eklenmemiştir.</span></div>
          </div>
          <ul className="check-list">
            <li><CheckCircle2 size={15} />Evrak kontrolü tamamlandı</li>
            <li><CheckCircle2 size={15} />Rapor kontrolü tamamlandı</li>
            <li className="check-list__warning"><AlertTriangle size={15} />Kapanma ücreti kullanıcı onayı bekliyor</li>
          </ul>
        </div>
        <footer className="modal__footer">
          <button className="button button--secondary" type="button" onClick={onClose}>Vazgeç</button>
          <button className="button button--danger" type="button" disabled>Onayla ve Kapat</button>
        </footer>
      </section>
    </div>
  )
}

function WorkmanshipModule({ item, onNotice }: { item: CaseRecord; onNotice: (message: string) => void }) {
  const rows = [
    { name: 'Ön tampon kaplama', action: 'Değişim', part: 18400, labor: 2200 },
    { name: 'Sol ön çamurluk', action: 'Onarım + boya', part: 0, labor: 6750 },
    { name: 'Ön panel', action: 'Ölçüm / düzeltme', part: 0, labor: 4800 },
    { name: 'Far bağlantı ayağı', action: 'Onarım', part: 0, labor: 1650 },
  ]
  return <div className="module-workspace"><section className="info-panel module-workspace__main"><header><h2>Parça ve İşçilik Dağılımı</h2><span className="status-pill status-pill--review">Taslak</span></header><div className="table-scroll module-table-scroll"><table className="data-table module-table"><thead><tr><th>Kalem</th><th>İşlem</th><th>Parça</th><th>İşçilik</th></tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.action}</td><td>{formatCurrency(row.part)}</td><td>{formatCurrency(row.labor)}</td></tr>)}</tbody></table></div></section><aside className="info-panel"><header><h2>AI İşçilik Önerisi</h2><Wrench size={16} /></header><p>Mock öneri, benzer anonim dosya kalemlerine göre hazırlanmıştır. Excel’e veya dosyaya yazmaz.</p><dl className="detail-list"><div><dt>Parça Toplamı</dt><dd>{formatCurrency(18400)}</dd></div><div><dt>İşçilik Toplamı</dt><dd>{formatCurrency(15400)}</dd></div><div><dt>Güven</dt><dd>Orta</dd></div></dl><button className="button button--primary button--block" type="button" onClick={() => onNotice(`${item.plate} işçilik önerisi mock taslağa alındı.`)}>Öneriyi Taslağa Al</button></aside></div>
}

function HeavyDamageModule({ item }: { item: CaseRecord }) {
  return <div className="decision-columns"><section className="decision-card"><span className="eyebrow">AI önerisi</span><h2>PERT adayı değil</h2><p>Tahmini hasar / rayiç oranı mock değerlendirmede sınır altında.</p><strong>Güven: Orta</strong></section><section className="decision-card"><span className="eyebrow">Eksper kanaati</span><h2>İnceleniyor</h2><p>Ön panel ölçümü ve şasi ucu fotoğrafları bekleniyor.</p><strong>{item.expert}</strong></section><section className="decision-card"><span className="eyebrow">Merkez / sigorta kararı</span><h2>Karar beklenmiyor</h2><p>Bu alan AI önerisinden ve eksper kanaatinden ayrı tutulur.</p><strong>Mock durum</strong></section><section className="info-panel decision-columns__wide"><header><h2>Ekonomik Görünüm</h2><AlertTriangle size={16} /></header><dl className="overview-fields"><div><dt>Tahmini Hasar</dt><dd>{formatCurrency(item.estimatedDamage)}</dd></div><div><dt>Sigorta Rayici</dt><dd>{formatCurrency(625000)}</dd></div><div><dt>Mock Oran</dt><dd>%{Math.round(item.estimatedDamage / 625000 * 100)}</dd></div><div><dt>Yapısal Kontrol</dt><dd>Ölçüm bekleniyor</dd></div></dl></section></div>
}

function ValueLossModule({ item, onNotice }: { item: CaseRecord; onNotice: (message: string) => void }) {
  const traffic = item.type === 'Trafik'
  return <div className="value-loss-layout"><section className="info-panel"><header><h2>Değer Kaybı Süreci</h2><span className={`status-pill ${traffic ? 'status-pill--late' : 'status-pill--waiting'}`}>{traffic ? 'Zorunlu süreç' : 'İsteğe bağlı'}</span></header>{traffic ? <><p>Trafik dosyasında Değer Kaybı modülü zorunludur. Hesap için hazırlık koşulları tamamlanmalıdır.</p><ul className="readiness-list"><li className="is-ready"><CheckCircle2 size={15} />Araç bilgileri doğrulandı</li><li><CalendarClock size={15} />Parça listesi kesinleşmeyi bekliyor</li><li><CalendarClock size={15} />Onarım / boya işlemleri kesinleşmeyi bekliyor</li></ul></> : <><p>Kasko dosyasında Değer Kaybı zorunlu değildir. Kullanıcı isterse dosya içinde isteğe bağlı modül açabilir.</p><button className="button button--secondary" type="button" onClick={() => onNotice(`${item.plate} için isteğe bağlı Değer Kaybı önizlemesi açıldı.`)}>İsteğe Bağlı Önizleme</button></>}</section><section className="info-panel"><header><h2>Reel Piyasa Analizi</h2><Scale size={16} /></header><dl className="detail-list"><div><dt>Kural Sürümü</dt><dd>RPA 1.0 · 01.07.2026</dd></div><div><dt>Hazırlık</dt><dd>{traffic ? 'Veri Eksik' : 'Başlatılmadı'}</dd></div><div><dt>Emsal Kayıt</dt><dd>0 / 3</dd></div><div><dt>Eksper Onayı</dt><dd>Bekliyor</dd></div></dl><div className="assistant-note"><AlertTriangle size={15} /><span>Sonuç kullanıcı onayı olmadan kesinleştirilemez.</span></div></section></div>
}

function CaseReportsModule({ item, onNotice }: { item: CaseRecord; onNotice: (message: string) => void }) {
  return <div className="module-workspace"><section className="info-panel module-workspace__main"><header><h2>Raporlar</h2><PanelRight size={16} /></header><div className="report-file-list"><button type="button" onClick={() => onNotice('Ön ekspertiz raporu mock önizlemede açıldı.')}><span><strong>Ön Ekspertiz Raporu</strong><small>08.07.2026 · PDF mock</small></span><span className="status-pill status-pill--open">Hazır</span></button><button type="button" onClick={() => onNotice('Nihai rapor henüz hazır değil.')}><span><strong>Nihai Ekspertiz Raporu</strong><small>Kapanışta beklenecek</small></span><span className="status-pill status-pill--waiting">Bekliyor</span></button></div></section><aside className="info-panel"><header><h2>Kapanma Ücreti</h2><span className="status-pill status-pill--review">Kontrol Bekliyor</span></header><dl className="detail-list"><div><dt>Aday Tutar</dt><dd>{formatCurrency(5275)}</dd></div><div><dt>Kaynak</dt><dd>Nihai rapor · sayfa 6</dd></div><div><dt>Dosya</dt><dd>{item.officeNumber}</dd></div></dl><button className="button button--secondary button--block" type="button" onClick={() => onNotice('Kapanma ücreti onay önizlemesi açıldı; kesinleştirme yapılmadı.')}>Onay Önizlemesi</button></aside></div>
}

function EmailsModule({ item, onNotice }: { item: CaseRecord; onNotice: (message: string) => void }) {
  return <div className="email-workspace"><section className="info-panel"><header><h2>E-posta Taslağı</h2><Mail size={16} /></header><div className="email-form"><label><span>Alıcı</span><input value="hasar@ornek-sigorta.test" readOnly /></label><label><span>Konu</span><input value={`${item.officeNumber} · ${item.plate} · Eksik Evrak Talebi`} readOnly /></label><label><span>Mesaj</span><textarea defaultValue={`Merhaba,\n\n${item.officeNumber} numaralı anonim mock dosya için eksik evrakların iletilmesini rica ederiz.\n\nBu metin yalnız UI prototipidir.`} /></label></div></section><aside className="info-panel"><header><h2>Ek Önerileri</h2><FileCheck2 size={16} /></header><ul className="attachment-list"><li>Ön ekspertiz raporu.pdf</li><li>Eksik evrak listesi.pdf</li><li>En fazla 3 hasar fotoğrafı</li></ul><button className="button button--primary button--block" type="button" onClick={() => onNotice('Gmail oluşturma ekranı mock olarak hazırlandı; e-posta gönderilmedi.')}>Gmail Taslağını Aç</button><div className="assistant-note"><AlertTriangle size={15} /><span>Otomatik gönderim yoktur.</span></div></aside></div>
}

function HistoryModule({ item }: { item: CaseRecord }) {
  const events = [
    ['Bugün, 11:45', 'Servis görüşmesi notu eklendi', item.assignee],
    ['Bugün, 10:20', `Dosya aşaması “${item.stage}” olarak kontrol edildi`, 'Sistem'],
    ['Dün, 16:20', 'Eksik evrak kontrolü yenilendi', item.assignee],
    ['08.07.2026', 'Sorumlu ataması yapıldı', 'Ömer Faruk Kaya'],
    ['07.07.2026', 'Dosya mock ihbar akışıyla oluşturuldu', 'Sistem'],
  ]
  return <section className="info-panel history-panel"><header><h2>Dosya Geçmişi</h2><History size={16} /></header><div className="audit-timeline">{events.map(([date, action, actor]) => <article key={`${date}-${action}`}><i /><time>{date}</time><div><strong>{action}</strong><span>{actor}</span></div></article>)}</div></section>
}

export function CaseDetailPage() {
  const { cases, source, status: dataStatus, reload } = useCases()
  const { caseId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = window.sessionStorage.getItem('hasarbotu-active-case-tab')
    return tabs.includes(saved as Tab) ? saved as Tab : 'Özet'
  })
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const [prototypeNotice, setPrototypeNotice] = useState('')
  const [assistantAnswer, setAssistantAnswer] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [photoMode, setPhotoMode] = useState<'normal' | 'stress'>('normal')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [caseOverride, setCaseOverride] = useState<CaseRecord | null>(null)
  const baseItem = cases.find((candidate) => candidate.caseId === caseId)
  const item = caseOverride?.caseId === caseId ? caseOverride : baseItem
  const currentIndex = cases.findIndex((candidate) => candidate.caseId === caseId)
  const creationResult = (location.state as {
    creationResult?: { caseId: string; officeNumber: string; plate: string }
  } | null)?.creationResult

  useEffect(() => {
    window.sessionStorage.setItem('hasarbotu-active-case-tab', activeTab)
  }, [activeTab])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (editModalOpen) setEditModalOpen(false)
      else if (closeModalOpen) setCloseModalOpen(false)
      else if (assistantOpen) setAssistantOpen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [assistantOpen, closeModalOpen, editModalOpen])

  useEffect(() => {
    setCaseOverride(null)
  }, [caseId, baseItem?.version])

  if (source === 'api' && dataStatus !== 'ok') {
    const message = dataStatus === 'loading'
      ? 'Gerçek veriler yükleniyor…'
      : dataStatus === 'unauthorized'
        ? 'Oturum gerekli: gerçek veriye erişmek için API oturumu açın.'
        : 'Servis şu anda kullanılamıyor; bağlantıyı kontrol edin.'
    return (
      <div className="page">
        <h1>Dosya Detayı</h1>
        <p role={dataStatus === 'loading' ? 'status' : 'alert'}>{message}</p>
      </div>
    )
  }

  if (!item) {
    return (
      <main className="not-found">
        <h1>Dosya bulunamadı</h1>
        <p>{source === 'api' ? 'Dosya yok veya organizasyonunuzun erişim alanında değil.' : 'Mock veri içinde bu kimlikle eşleşen dosya yok.'}</p>
        <button className="button button--primary" type="button" onClick={() => navigate('/dosyalar')}>Dosyalara dön</button>
      </main>
    )
  }

  return (
    <main className="page case-detail-page">
      <section className="case-detail-head">
        <button className="icon-button" type="button" onClick={() => navigate('/dosyalar')} aria-label="Dosya listesine dön"><ArrowLeft size={19} /></button>
        <div className="case-switcher" aria-label="Dosyalar arasında geçiş">
          <button className="icon-button" type="button" disabled={currentIndex <= 0} onClick={() => navigate(`/dosyalar/${cases[currentIndex - 1].caseId}`)} aria-label="Önceki dosyaya geç"><ChevronLeft size={17} /></button>
          <button className="icon-button" type="button" disabled={currentIndex >= cases.length - 1} onClick={() => navigate(`/dosyalar/${cases[currentIndex + 1].caseId}`)} aria-label="Sonraki dosyaya geç"><ChevronRight size={17} /></button>
        </div>
        <div className="case-detail-head__identity">
          <span className="plate plate--large">{item.plate}</span>
          <div><strong>{item.officeNumber}</strong><span>{item.company} · {item.type}</span></div>
        </div>
        <div className="case-detail-head__stage"><span>Aşama</span><strong>{item.stage}</strong></div>
        <div className="case-detail-head__actions">
          <button className="button button--secondary" type="button" onClick={() => {
            if (source === 'api') {
              reload()
              setPrototypeNotice('Güncel dosya verisi sunucudan yükleniyor.')
            } else setPrototypeNotice(`${item.plate} mock verisi yenilendi.`)
          }}><RefreshCw size={15} /> Tek Dosyayı Yenile</button>
          {source === 'api' ? (
            <button className="button button--primary" type="button" onClick={() => setEditModalOpen(true)}><Save size={15} /> Temel Bilgileri Düzenle</button>
          ) : (
            <>
              <button className="button button--secondary" type="button" onClick={() => setPrototypeNotice('Mock not düzenleyicisi hazırlandı.')}><NotebookPen size={15} /> Not Ekle</button>
              <button className="button button--secondary" type="button" onClick={() => setPrototypeNotice('UI taslağı yerel mock durumda saklandı.')}><Save size={15} /> Taslağı Kaydet</button>
            </>
          )}
          <button className="button button--secondary" type="button" onClick={() => setAssistantOpen((value) => !value)}>
            {assistantOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            {assistantOpen ? 'Asistanı kapat' : 'Asistanı aç'}
          </button>
          {source === 'mock' && <button className="button button--danger-ghost" type="button" onClick={() => setCloseModalOpen(true)}>Dosyayı Kapat</button>}
        </div>
      </section>

      {creationResult?.caseId === item.caseId && (
        <div className="case-created-banner" role="status">
          <CheckCircle2 size={17} />
          <span><strong>Dosya oluşturuldu.</strong> Backend sonucu: {creationResult.officeNumber} · {creationResult.caseId}</span>
        </div>
      )}

      <nav className="case-tabs" aria-label="Dosya modülleri">
        {tabs.map((tab) => (
          <button className={activeTab === tab ? 'is-active' : ''} type="button" key={tab} onClick={() => setActiveTab(tab)}>{tab}</button>
        ))}
      </nav>

      <div className={`case-detail-content${assistantOpen ? '' : ' case-detail-content--assistant-closed'}`}>
        <section className="case-module">
          <header className="module-heading">
            <div><span className="eyebrow">{item.officeNumber}</span><h1>{activeTab}</h1><p>{tabDescriptions[activeTab]}</p></div>
            <span className="mock-label">{source === 'mock' ? 'Mock prototip' : 'Gerçek API'}</span>
          </header>

          {activeTab === 'Özet' ? (
            <div className="overview-grid">
              <section className="info-panel overview-grid__main">
                <header><h2>Dosya Özeti</h2><span className="status-pill status-pill--open">{item.status}</span></header>
                <dl className="overview-fields">
                  <div><dt>Sigortalı</dt><dd>{item.insured}</dd></div>
                  <div><dt>Araç</dt><dd>{item.vehicle}</dd></div>
                  <div><dt>Hasar Dosya No</dt><dd>{item.claimNumber}</dd></div>
                  <div><dt>İhbar Föyü No</dt><dd>{item.noticeNumber}</dd></div>
                  <div><dt>Servis</dt><dd>{item.service}</dd></div>
                  <div><dt>Tahmini Hasar</dt><dd>{formatCurrency(item.estimatedDamage)}</dd></div>
                  <div><dt>Sorumlu</dt><dd>{item.assignee}</dd></div>
                  <div><dt>Eksper</dt><dd>{item.expert}</dd></div>
                </dl>
              </section>
              <section className="info-panel">
                <header><h2>Bugünkü Takip</h2><CalendarClock size={16} /></header>
                <strong className={`overview-follow overview-follow--${item.followUpTone}`}>{item.followUp}</strong>
                <p>Servisten işlem durumu ve eksik evrak dönüşü alınacak.</p>
                <button className="text-button" type="button">Takibi düzenle <ChevronRight size={14} /></button>
              </section>
              <section className="info-panel">
                <header><h2>Evrak Durumu</h2><FileCheck2 size={16} /></header>
                <strong className={item.missingDocuments ? 'text-warning' : 'text-success'}>{item.missingDocuments ? `${item.missingDocuments} eksik evrak` : 'Evraklar tam'}</strong>
                <p>Koşullu evrak kuralları dosya türüne göre gösteriliyor.</p>
                <button className="text-button" type="button" onClick={() => setActiveTab('Evrak ve Fotoğraf')}>Evraklara git <ChevronRight size={14} /></button>
              </section>
              <section className="info-panel overview-grid__wide">
                <header><h2>Notlar ve Görevler</h2><History size={16} /></header>
                <div className="note-list">
                  {item.notes.map((note) => <div key={note}><span>Bugün</span><p>{note}</p></div>)}
                  <div><span>Görev · 14:30</span><p>Eksik evrak dönüşünü kontrol et · {item.assignee}</p></div>
                </div>
              </section>
              {source === 'api' && (
                <WorkspaceProvisioningPanel
                  caseId={item.caseId}
                  notificationDate={item.notificationDate ?? null}
                  onUnauthorized={session.reportUnauthorized}
                />
              )}
            </div>
          ) : activeTab === 'Operasyon' ? (
            <div className="module-workspace">
              <section className="info-panel module-workspace__main">
                <header><h2>Notlar ve Görüşmeler</h2><NotebookPen size={16} /></header>
                <article className="long-note">
                  <div><strong>Servis Görüşmesi</strong><span>Bugün, 11:45 · Ahmet Yılmaz</span></div>
                  <p>Servis yetkilisiyle yapılan görüşmede aracın söküm işleminin tamamlandığı, ön panel ve sol şasi ucunda ölçüm gerektiği bildirildi. Parça listesi kesinleşmeden işçilik dağılımının onaya gönderilmemesi, ölçüm sonuçlarının fotoğraf ve servis formuyla birlikte dosyaya eklenmesi istendi. Mağdura gün içinde bilgi verilecek; sigorta şirketi onarım onayı için güncel tahmini hasar tutarı ve gerekçeli servis notu bekliyor.</p>
                </article>
                <article className="long-note">
                  <div><strong>İç Not</strong><span>Dün, 16:20 · Sistem</span></div>
                  <p>Eksik evrak kontrolü yenilendi. İmzalı KTT ve ruhsat görüntüsü talep edildi; görev sonucu notu girilmeden takip tamamlanmış sayılmayacak.</p>
                </article>
              </section>
              <aside className="info-panel">
                <header><h2>Açık Görevler</h2><ClipboardList size={16} /></header>
                <ul className="task-list">
                  <li><span>Servis ölçüm formunu al</span><strong>Bugün</strong></li>
                  <li><span>Eksik evrak dönüşünü kontrol et</span><strong>14:30</strong></li>
                  <li><span>Mağdura bilgi ver</span><strong>16:00</strong></li>
                </ul>
              </aside>
            </div>
          ) : activeTab === 'Evrak ve Fotoğraf' && source === 'mock' ? (
            <div className="document-photo-workspace">
              <section className="document-checklist">
                <header><div><h2>Koşullu Evrak Kontrolü</h2><span>{item.type} dosyası · mock kural görünümü</span></div><span className="status-pill status-pill--review">{item.missingDocuments} eksik</span></header>
                <ul>
                  <li className="is-complete"><CheckCircle2 size={15} /><span>Poliçe</span><strong>Mevcut</strong></li>
                  <li className="is-complete"><CheckCircle2 size={15} /><span>SBM Ağır Hasar</span><strong>Mevcut</strong></li>
                  <li className="is-missing"><AlertTriangle size={15} /><span>İmzalı KTT</span><strong>Eksik</strong></li>
                  <li className="is-missing"><AlertTriangle size={15} /><span>Ruhsat görüntüsü</span><strong>Eksik</strong></li>
                </ul>
              </section>
              <section className="photo-library">
                <header><div><h2>Hasar Fotoğrafları</h2><span>{photoMode === 'normal' ? '12 anonim mock görsel' : '108 anonim mock görsel · lazy loading stres testi'}</span></div><div className="photo-mode"><button type="button" className={photoMode === 'normal' ? 'is-active' : ''} onClick={() => setPhotoMode('normal')}>Normal (12)</button><button type="button" className={photoMode === 'stress' ? 'is-active' : ''} onClick={() => setPhotoMode('stress')}>Yoğun Test (108)</button></div></header>
                <div className="photo-grid" aria-label="Mock hasar fotoğrafları">
                  {mockPhotoIndexes.slice(0, photoMode === 'normal' ? 12 : 108).map((photoNumber) => (
                    <figure key={photoNumber}>
                      <img src={mockPhotoSource} loading="lazy" alt={`Mock hasar fotoğrafı ${photoNumber}`} />
                      <figcaption>HASAR_{String(photoNumber).padStart(3, '0')}.jpg</figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            </div>
          ) : activeTab === 'Evrak ve Fotoğraf' ? (
            <DocumentPhotoApiModule caseId={item.caseId} source={source} />
          ) : activeTab === 'İşçilik' ? <WorkmanshipModule item={item} onNotice={setPrototypeNotice} />
            : activeTab === 'Ağır Hasar' ? <HeavyDamageModule item={item} />
              : activeTab === 'Değer Kaybı' ? <ValueLossModule item={item} onNotice={setPrototypeNotice} />
                : activeTab === 'Raporlar ve Ücretler' ? <CaseReportsModule item={item} onNotice={setPrototypeNotice} />
                  : activeTab === 'E-postalar' ? <EmailsModule item={item} onNotice={setPrototypeNotice} />
                    : <HistoryModule item={item} />}
        </section>

        {assistantOpen && <aside className="assistant-rail">
          <header><Bot size={17} /><div><strong>Dosya Asistanı</strong><span>Karar desteği · mock</span></div></header>
          <div className="assistant-rail__body">
            <span className="assistant-rail__label">Hızlı sorular</span>
            <button type="button" onClick={() => setAssistantAnswer(item.missingDocuments ? `${item.missingDocuments} eksik evrak görünüyor; kullanıcı kontrolü gerekli.` : 'Mock kural kontrolünde eksik evrak görünmüyor.')}>Eksik evrak var mı?</button>
            <button type="button" onClick={() => setAssistantAnswer('Onarım onayı gerekliliği dosya türü, olay belgesi ve hasar eşiğiyle birlikte kontrol edilmelidir.')}>Onarım onayı gerekiyor mu?</button>
            <button type="button" onClick={() => setAssistantAnswer('Muafiyet bilgisi için poliçe belgesi ve kaynak sayfa kullanıcı tarafından doğrulanmalıdır.')}>Bu dosyada muafiyet var mı?</button>
            {assistantAnswer && <div className="assistant-answer" aria-live="polite"><strong>Mock yanıt</strong><span>{assistantAnswer}</span></div>}
            <div className="assistant-note"><AlertTriangle size={15} /><span>AI önerileri kullanıcı onayı olmadan dosyada değişiklik yapamaz.</span></div>
          </div>
        </aside>}
      </div>

      {closeModalOpen && <CloseCaseModal onClose={() => setCloseModalOpen(false)} />}
      {editModalOpen && source === 'api' && session.user !== null && (
        <CaseEditModal
          item={item}
          currentUser={session.user}
          onClose={() => setEditModalOpen(false)}
          onUnauthorized={session.reportUnauthorized}
          onReload={() => {
            setEditModalOpen(false)
            reload()
            setPrototypeNotice('Çakışma sonrası güncel veri sunucudan yükleniyor.')
          }}
          onUpdated={(updated) => {
            setCaseOverride(updated)
            setEditModalOpen(false)
            setPrototypeNotice(`Değişiklik kaydedildi · yeni sürüm ${updated.version ?? '—'}`)
          }}
        />
      )}
      {prototypeNotice && <button className="prototype-toast" type="button" onClick={() => setPrototypeNotice('')} aria-live="polite"><CheckCircle2 size={15} />{prototypeNotice}<X size={14} /></button>}
    </main>
  )
}
