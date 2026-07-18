import { useEffect, useMemo, useState } from 'react'
import { BookOpenText, ChevronDown, ExternalLink, Search, Send, ShieldAlert, X } from 'lucide-react'
import { legislationSources, type LegislationSource } from '../../mocks/workspaces'
import { BackendUnavailableState } from '../../components/StateViews'
import { getConfiguredDataSource, type DataSourceKind } from '../../data'

/**
 * Prototip mevzuat kütüphanesi ve mock soru–cevap. Yalnız açıkça seçilmiş mock
 * veri modunda render edilir; API modunda bu bileşen hiç çağrılmaz, dolayısıyla
 * örnek kaynaklar ve mock yanıt metni DOM'a hiç girmez.
 */
function LegislationMockContent() {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('Tümü')
  const [status, setStatus] = useState('Geçerli')
  const [selected, setSelected] = useState<LegislationSource | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.toLocaleLowerCase('tr-TR')
    return legislationSources.filter((source) => (!normalized || `${source.title} ${source.reference}`.toLocaleLowerCase('tr-TR').includes(normalized)) && (type === 'Tümü' || source.type === type) && (status === 'Tümü' || source.status === status))
  }, [query, status, type])

  const ask = () => {
    if (!question.trim()) return
    setAnswer('Mock değerlendirmeye göre onarım onayı; dosya türü, olay belgesi ve yürürlükteki hasar eşiği birlikte kontrol edilerek belirlenmelidir. Kullanıcı, kaynak belgede belirtilen maddeyi ve dosyanın gerçek belgelerini ayrıca doğrulamalıdır.')
  }

  return (
    <>
      <section className="page-heading page-heading--compact"><div><h1>Mevzuat ve AI Yardımcısı</h1><p>Geçerli kaynakları inceleyin ve kaynaklı mock karar desteği alın</p></div><span className="connection-status"><i />6 yerel mock kaynak</span></section>
      <section className="filterbar" aria-label="Mevzuat filtreleri">
        <label className="field field--search office-search"><Search size={15} /><span className="sr-only">Mevzuat kaynağı ara</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kaynak başlığı veya bölüm ara..." /></label>
        <label className="select-field"><span className="select-field__label">Kaynak Türü</span><select aria-label="Mevzuat kaynak türü" value={type} onChange={(event) => setType(event.target.value)}><option>Tümü</option><option>Kanun</option><option>Yönetmelik</option><option>Genelge</option><option>Tarife</option><option>Yargı Kararı</option></select><ChevronDown size={14} /></label>
        <label className="select-field"><span className="select-field__label">Sürüm</span><select aria-label="Mevzuat sürüm durumu" value={status} onChange={(event) => setStatus(event.target.value)}><option>Tümü</option><option>Geçerli</option><option>Eski Sürüm</option></select><ChevronDown size={14} /></label>
      </section>

      <div className={`legislation-layout${selected ? ' legislation-layout--detail' : ''}`}>
        <section className="source-list-panel">
          <header className="panel-heading"><div><h2>Kaynak Kütüphanesi</h2><span>{filtered.length} kaynak gösteriliyor</span></div></header>
          <div className="source-list">
            {filtered.map((source) => <button type="button" className={`source-row${selected?.id === source.id ? ' is-selected' : ''}`} key={source.id} onClick={() => setSelected(source)}>
              <BookOpenText size={17} /><span><strong>{source.title}</strong><small>{source.type} · Yayın {source.publishedAt} · Yürürlük {source.effectiveAt}</small></span><span className={`status-pill ${source.status === 'Geçerli' ? 'status-pill--open' : 'status-pill--waiting'}`}>{source.status}</span>
            </button>)}
          </div>
        </section>

        <section className="qa-panel">
          <header className="panel-heading"><div><h2>Mock Soru–Cevap</h2><span>Kaynaklı karar desteği</span></div></header>
          <div className="qa-panel__body">
            <label className="qa-input"><span>Sorunuz</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Örnek: Bu trafik dosyasında onarım onayı hangi durumda gerekir?" /></label>
            <button className="button button--primary" type="button" disabled={!question.trim()} onClick={ask}><Send size={15} /> Kaynaklarda Ara</button>
            {answer && <article className="qa-answer" aria-live="polite"><span className="eyebrow">Mock yanıt · Güven: Orta</span><p>{answer}</p><div className="reference-list"><strong>Dayanak kaynaklar</strong><button type="button" onClick={() => setSelected(legislationSources[0])}>Karayolları Trafik Kanunu · Madde 85–99</button><button type="button" onClick={() => setSelected(legislationSources[1])}>Zorunlu Mali Sorumluluk Sigortası Genel Şartları · B.2</button></div></article>}
            <div className="legal-warning"><ShieldAlert size={17} /><span>Bu alan kesin hukuki görüş üretmez. Sonuçlar kullanıcı kontrolü ve güncel kaynak doğrulaması gerektirir.</span></div>
          </div>
        </section>

        {selected && <aside className="office-detail source-detail" aria-label="Mevzuat kaynak detayı">
          <header><div><span className="eyebrow">Kaynak detayı</span><h2>{selected.type}</h2></div><button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="Kaynak detayını kapat"><X size={18} /></button></header>
          <div className="office-detail__body"><h3>{selected.title}</h3><span className={`status-pill ${selected.status === 'Geçerli' ? 'status-pill--open' : 'status-pill--waiting'}`}>{selected.status}</span><dl className="detail-list office-detail__list"><div><dt>Yayın Tarihi</dt><dd>{selected.publishedAt}</dd></div><div><dt>Yürürlük</dt><dd>{selected.effectiveAt}</dd></div><div><dt>Sürüm</dt><dd>{selected.version}</dd></div><div><dt>Referans</dt><dd>{selected.reference}</dd></div></dl><p>{selected.summary}</p></div>
          <footer><button className="button button--secondary button--block" type="button" onClick={() => setAnswer(`Seçili kaynak: ${selected.title}. ${selected.summary}`)}><ExternalLink size={15} /> Mock Kaynağı Cevaba Ekle</button></footer>
        </aside>}
      </div>
    </>
  )
}

export function LegislationPage() {
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)

  return (
    <main className="page office-page legislation-page">
      {source === 'mock' ? <LegislationMockContent /> : (
        <>
          <section className="page-heading page-heading--compact">
            <div>
              <h1>Mevzuat ve AI Yardımcısı</h1>
              <p>Kaynak kütüphanesi ve kaynaklı karar desteği</p>
            </div>
          </section>
          <BackendUnavailableState
            title="Mevzuat kaynak kütüphanesi henüz yapılandırılmadı."
            detail="Gerçek kaynak kütüphanesi bağlanana kadar örnek mevzuat kaydı ve mock karar desteği gösterilmez."
          />
        </>
      )}
    </main>
  )
}
