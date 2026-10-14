import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, ExternalLink, Search, Send, X } from 'lucide-react'
import type { z } from 'zod'
import type { LegislationAnswer, LegislationSource, legislationAiSettingsSchema, legislationLibrarySchema, legislationPageSchema } from '@hasarbotu/contracts'
import { useSession } from '../../app/sessionContext'
import { createLegislationPort, LegislationError } from '../../data/legislationPort'

const port = createLegislationPort()
type Draft = { question: string; eventDate: string; sourceId: string }
const drafts = new Map<string, Draft>()
export function LegislationApiContent() {
  const session = useSession()
  return <LegalWorkspace key={`${session.user?.organizationId}:${session.user?.id}`} account={`${session.user?.organizationId}:${session.user?.id}`} />
}
function LegalWorkspace({ account }: { account: string }) {
  const { reportUnauthorized } = useSession()
  const initial = drafts.get(account)
  const [library, setLibrary] = useState<z.infer<typeof legislationLibrarySchema> | null>(null)
  const [settings, setSettings] = useState<z.infer<typeof legislationAiSettingsSchema> | null>(null)
  const [history, setHistory] = useState<LegislationAnswer[]>([])
  const [selected, setSelected] = useState<LegislationSource | null>(null)
  const [page, setPage] = useState(1), [content, setContent] = useState<z.infer<typeof legislationPageSchema> | null>(null)
  const [query, setQuery] = useState(''), [kind, setKind] = useState('Tümü')
  const [question, setQuestion] = useState(initial?.question ?? ''), [eventDate, setEventDate] = useState(initial?.eventDate ?? ''), [sourceId, setSourceId] = useState(initial?.sourceId ?? '')
  const [answer, setAnswer] = useState<LegislationAnswer | null>(null)
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [retry, setRetry] = useState(0)
  const [error, setError] = useState(''), [pageError, setPageError] = useState(''), [notice, setNotice] = useState('')
  const [apiKey, setApiKey] = useState(''), [model, setModel] = useState(''), [enabled, setEnabled] = useState(true)
  const alive = useRef(true), action = useRef<AbortController | null>(null)
  const onFailure = (reason: unknown) => {
    if (!alive.current) return
    if (reason instanceof LegislationError && reason.status === 401) reportUnauthorized()
    setError(reason instanceof LegislationError ? reason.message : 'Mevzuat servisine ulaşılamadı veya yanıt doğrulanamadı.')
  }
  useEffect(() => { alive.current = true;return () => { alive.current = false;action.current?.abort() } }, [])
  useEffect(() => {
    if (drafts.size >= 10 && !drafts.has(account)) drafts.delete(drafts.keys().next().value!)
    drafts.set(account, { question, eventDate, sourceId })
  }, [account, question, eventDate, sourceId])
  useEffect(() => {
    const abort = new AbortController()
    Promise.all([port.library(abort.signal), port.settings(abort.signal), port.history(abort.signal)]).then(([sources, config, past]) => {
      if (abort.signal.aborted) return
      setLibrary(sources);setSettings(config);setModel(config.model);setEnabled(config.configured ? config.enabled : true);setHistory(past.items)
    }).catch(reason => { if (!abort.signal.aborted) onFailure(reason) })
    return () => abort.abort()
    // An account switch remounts this workspace and cancels all old requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry])
  useEffect(() => {
    if (!selected) return
    const abort = new AbortController()
    port.page(selected.id, page, abort.signal).then(result => { if (!abort.signal.aborted) setContent(result) }).catch(reason => {
      if (abort.signal.aborted) return
      if (reason instanceof LegislationError && reason.status === 401) reportUnauthorized()
      setPageError('Kaynak sayfası yüklenemedi.')
    })
    return () => abort.abort()
  }, [selected, page, reportUnauthorized])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  const filtered = useMemo(() => library?.sources.filter(source => (!query || `${source.title} ${source.publisher}`.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))) && (kind === 'Tümü' || source.kind === kind)) ?? [], [library, query, kind])
  const open = (source: LegislationSource, nextPage = 1) => { if (selected === source && page === nextPage) return;setContent(null);setPageError('');setSelected(source);setPage(nextPage) }
  const navigatePage = (nextPage: number) => { if (page === nextPage) return;setContent(null);setPageError('');setPage(nextPage) }
  const ask = async (mode: 'sources' | 'ai') => {
    if (busy || !question.trim()) return
    const abort = new AbortController();action.current = abort
    setBusy(true);setError('');setAnswer(null);setNotice('')
    try {
      const result = await port.ask({ question, eventDate: eventDate || null, mode, sourceIds: sourceId ? [sourceId] : [], caseId: null }, abort.signal)
      if (!alive.current) return
      setAnswer(result);setHistory(past => [result, ...past].slice(0, 20))
    } catch (reason) { onFailure(reason) }
    finally { if (alive.current) setBusy(false) }
  }
  const save = async () => {
    if (!settings || saving) return
    const abort = new AbortController();action.current = abort
    setSaving(true);setError('');setNotice('')
    try {
      const config = await port.saveSettings({ expectedOrganizationId: settings.organizationId, expectedVersion: settings.version, model, enabled, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }, abort.signal)
      if (!alive.current) return
      setSettings(config);setLibrary(value => value ? { ...value, aiEnabled: config.enabled } : value)
      setNotice('Gemini ayarları kaydedildi. Bağlantıyı kaynaklı AI yanıtıyla deneyin.')
    } catch (reason) { onFailure(reason) }
    finally { if (alive.current) { setApiKey('');setSaving(false) } }
  }
  return <>
    <section className="page-heading page-heading--compact"><div><h1>Mevzuat ve AI Yardımcısı</h1><p>Resmî kaynak kütüphanesi ve kaynaklı inceleme desteği</p></div>{library && <span className="connection-status"><i />{library.sources.length} resmî kaynak</span>}</section>
    {error && <div className="legal-warning" role="alert"><span>{error}</span><button type="button" className="button button--secondary" disabled={busy || saving} onClick={() => { setError('');setRetry(value => value + 1) }}>Yeniden yükle</button></div>}
    {notice && <p role="status">{notice}</p>}
    {!library && !error && <p role="status">Kaynak kütüphanesi yükleniyor…</p>}
    {library && <>
      <section className="filterbar" aria-label="Mevzuat filtreleri">
        <label className="field field--search office-search"><Search size={15} /><span className="sr-only">Mevzuat kaynağı ara</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Kaynak başlığı veya yayıncı ara" /></label>
        <label className="select-field"><span>Kaynak türü</span><select aria-label="Mevzuat kaynak türü" value={kind} onChange={e => setKind(e.target.value)}><option>Tümü</option><option>Kanun</option><option>Genel Şartlar</option><option>Değişiklik</option></select></label>
      </section>
      <div className={`legislation-layout${selected ? ' legislation-layout--detail' : ''}`}>
        <section className="source-list-panel"><header className="panel-heading"><div><h2>Kaynak Kütüphanesi</h2><span>{filtered.length} kaynak gösteriliyor</span></div></header><div className="source-list">
          {filtered.map(source => <button type="button" className={`source-row${selected?.id === source.id ? ' is-selected' : ''}`} key={source.id} onClick={() => open(source)}><BookOpenText size={17} /><span><strong>{source.title}</strong><small>{source.kind} · {source.pageCount} {source.format === 'pdf' ? 'sayfa' : 'ek'} · Doğrulama {new Date(source.verifiedAt).toLocaleDateString('tr')}</small></span><span className="status-pill status-pill--waiting">Tarih kontrolü</span></button>)}
          {!filtered.length && <p>Bu filtrede kaynak bulunamadı.</p>}
        </div></section>
        <section className="qa-panel"><header className="panel-heading"><div><h2>Kaynaklı inceleme</h2><span>{library.aiEnabled ? 'Gemini bağlantısı etkin' : 'Kaynak taraması kullanılabilir · Gemini kurulumu bekleniyor'}</span></div></header>
          <div className="qa-panel__body">
            <label className="qa-input"><span>Sorunuz</span><textarea maxLength={2000} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Örnek: Kasko teminatı dışında kalan haller nelerdir?" /></label>
            <p className="form-hint">AI seçeneği soruyu ve resmî kaynak alıntılarını Google Gemini’ye gönderir. Kimlik, plaka ve kişisel evrak bilgisi yazmayın.</p>
            <label className="qa-input"><span>Olay tarihi</span><input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} /></label>
            <label className="qa-input"><span>Aranacak kaynak</span><select value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">Tüm kaynaklar</option>{library.sources.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</select></label>
            <div className="legislation-actions"><button className="button button--primary" type="button" disabled={busy || saving || question.trim().length < 3} onClick={() => void ask('sources')}><Search size={15} />Kaynaklarda ara</button><button className="button button--secondary" type="button" disabled={busy || saving || !library.aiEnabled || question.trim().length < 3} onClick={() => void ask('ai')}><Send size={15} />AI ile kaynaklı yanıt</button></div>
            {busy && <p role="status">Kaynaklar inceleniyor…</p>}
            {answer && <article className="qa-answer" aria-live="polite"><span className="eyebrow">{answer.provider ? `Gemini (${answer.provider.model}) · Kaynaklı tespit` : 'Kaynak taraması · Birebir metin'} · Kullanıcı incelemesi gerekir</span><h3>{answer.question}</h3>
              {answer.statements.map((statement, index) => <div key={index}><p>{statement.text}</p><div className="reference-list">{statement.citationIds.map(id => {
                const citation = answer.citations.find(c => c.id === id), source = library.sources.find(s => s.id === citation?.sourceId && s.contentHash === citation?.contentHash)
                return citation && <button key={id} type="button" disabled={!source} onClick={() => source && open(source, citation.page)}>{citation.title} · {citation.locatorKind === 'page' ? 'Sayfa' : 'Ek'} {citation.page}</button>
              })}</div></div>)}
              {!answer.statements.length && <p>Bu kaynaklarla desteklenen bir sonuç bulunamadı.</p>}
              {answer.missingInformation.length > 0 && <ul>{answer.missingInformation.map((text, index) => <li key={index}>{text}</li>)}</ul>}
              <details><summary>Dayanak alıntıları ve sürümler</summary>{answer.citations.map(c => <div key={c.id}><a href={c.url} target="_blank" rel="noopener noreferrer">{c.title} · {c.locatorKind === 'page' ? 'Sayfa' : 'Ek'} {c.page}</a><blockquote>{c.excerpt}</blockquote><small>SHA256: {c.contentHash}</small></div>)}</details>
              <small>{new Date(answer.createdAt).toLocaleString('tr')} · Kütüphane {answer.libraryVersion.slice(0, 12)}</small>
            </article>}
            <div className="legal-warning"><span>Güncel kaynak görüntüsü, eski olay ve poliçe tarihleri için tek başına yeterli değildir. Uygulanacak sürümü ve dosya evrakını kontrol ederek karar verin.</span></div>
            {history.length > 0 && <details><summary>Geçmiş incelemelerim ({history.length})</summary><div className="reference-list">{history.map(item => <button type="button" key={item.id} disabled={busy} onClick={() => { setAnswer(item);setQuestion(item.question);setEventDate(item.eventDate ?? '') }}>{item.question} · {new Date(item.createdAt).toLocaleDateString('tr')}</button>)}</div></details>}
            {settings?.canConfigure && <details className="legislation-settings"><summary>Gemini bağlantı ayarları</summary><p>Anahtar ofis sunucusunda şifrelenir. Kaydedildikten sonra gösterilmez.</p>
              <label className="qa-input"><span>Gemini API anahtarı {settings.configured ? '(değiştirmek için)' : ''}</span><input type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={saving || !settings.encryptionAvailable} /></label>
              <label className="qa-input"><span>Gemini modeli</span><input value={model} onChange={e => setModel(e.target.value)} disabled={saving} /></label>
              <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={saving} /> AI yanıtlarını etkinleştir</label>
              {!settings.encryptionAvailable && <p role="alert">Sunucuda anahtar şifrelemesi yapılandırılmamış.</p>}
              <button type="button" className="button button--secondary" disabled={saving || busy || !settings.encryptionAvailable || !settings.configured && !apiKey.trim()} onClick={() => void save()}>{saving ? 'Kaydediliyor…' : 'Gemini ayarlarını kaydet'}</button>
            </details>}
          </div>
        </section>
        {selected && <aside className="office-detail source-detail" aria-label="Mevzuat kaynak detayı"><header><div><span className="eyebrow">Resmî kaynak</span><h2>{selected.kind}</h2></div><button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="Kaynak detayını kapat"><X size={18} /></button></header>
          <div className="office-detail__body"><h3>{selected.title}</h3><p>{selected.publisher}</p><dl className="detail-list"><div><dt>Doğrulama</dt><dd>{new Date(selected.verifiedAt).toLocaleString('tr')}</dd></div><div><dt>Yürürlük başlangıcı</dt><dd>{selected.effectiveFrom ?? 'Tarih ve sürüm incelemesi gerekir'}</dd></div></dl>
            <label className="qa-input"><span>{selected.format === 'pdf' ? 'Kaynak sayfası' : 'Ek numarası'}</span><input type="number" min={1} max={selected.pageCount} value={page} onChange={e => navigatePage(Math.max(1, Math.min(selected.pageCount, Number(e.target.value) || 1)))} /></label>
            {pageError ? <p role="alert">{pageError}</p> : content ? <pre className="legislation-source-text">{content.text}</pre> : <p role="status">Sayfa yükleniyor…</p>}
            <details><summary>Dosya doğrulaması</summary><small>SHA256: {selected.contentHash}</small></details>
          </div><footer><a className="button button--secondary button--block" href={selected.url + (selected.format === 'pdf' ? `#page=${page}` : '')} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{selected.format === 'pdf' ? 'Resmî metni aç' : 'Resmî ek arşivini aç'}</a></footer>
        </aside>}
      </div>
    </>}
  </>
}
