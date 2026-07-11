import { useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, CheckCircle2, ChevronDown, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatCurrency } from '../../mocks/cases'
import { closedCases, type ClosedCaseRecord } from '../../mocks/workspaces'

type ClosedSort = 'closedAt' | 'officeNumber' | 'plate' | 'expertFee'

export function ClosedCasesPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [type, setType] = useState('Tümü')
  const [reason, setReason] = useState('Tümü')
  const [sort, setSort] = useState<ClosedSort>('closedAt')
  const [selected, setSelected] = useState<ClosedCaseRecord | null>(closedCases[0])
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.toLocaleLowerCase('tr-TR')
    return [...closedCases]
      .filter((item) => !normalized || [item.officeNumber, item.plate, item.company, item.service, item.assignee].some((value) => value.toLocaleLowerCase('tr-TR').includes(normalized)))
      .filter((item) => type === 'Tümü' || item.type === type)
      .filter((item) => reason === 'Tümü' || item.reason === reason)
      .sort((a, b) => {
        if (sort === 'expertFee') return b.expertFee - a.expertFee
        return a[sort].localeCompare(b[sort], 'tr') * (sort === 'closedAt' ? -1 : 1)
      })
  }, [query, reason, sort, type])

  return (
    <main className="page office-page">
      <section className="page-heading page-heading--compact">
        <div><h1>Kapanan Dosyalar <span className="heading-count">{filtered.length}</span></h1><p>Kapanış bilgileri ve kullanıcı onaylı ücret görünümü</p></div>
        <button className="button button--secondary" type="button" onClick={() => setNotice('Yeniden açma önizlemesi mock olarak hazırlandı.')}><ArchiveRestore size={15} /> Yeniden Açma Önizlemesi</button>
      </section>

      <section className="filterbar" aria-label="Kapanan dosya filtreleri">
        <label className="field field--search office-search"><Search size={15} /><span className="sr-only">Kapanan dosyalarda ara</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dosya no, plaka, şirket, servis veya sorumlu ara..." /></label>
        <label className="select-field"><span className="select-field__label">Tür</span><select aria-label="Kapanan dosya türü" value={type} onChange={(event) => setType(event.target.value)}><option>Tümü</option><option>Trafik</option><option>Kasko</option></select><ChevronDown size={14} /></label>
        <label className="select-field"><span className="select-field__label">Sebep</span><select aria-label="Kapanış sebebi" value={reason} onChange={(event) => setReason(event.target.value)}><option>Tümü</option>{Array.from(new Set(closedCases.map((item) => item.reason))).map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></label>
        <label className="select-field"><span className="select-field__label">Sırala</span><select aria-label="Kapanan dosya sıralaması" value={sort} onChange={(event) => setSort(event.target.value as ClosedSort)}><option value="closedAt">Kapanış tarihi</option><option value="officeNumber">Dosya no</option><option value="plate">Plaka A–Z</option><option value="expertFee">Eksper ücreti</option></select><ChevronDown size={14} /></label>
      </section>

      <div className={`office-workarea${selected ? ' office-workarea--detail' : ''}`}>
        <section className="office-table-panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Kapanış</th><th>Dosya No</th><th>Plaka</th><th>Tür</th><th>Sigorta Şirketi</th><th>Kapanış Sebebi</th><th>Eksper Ücreti</th><th>Değer Kaybı</th></tr></thead>
              <tbody>{filtered.map((item) => (
                <tr key={item.id} tabIndex={0} className={selected?.id === item.id ? 'is-selected' : ''} onClick={() => setSelected(item)} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(item) }}>
                  <td>{item.closedAt}</td><td className="mono">{item.officeNumber}</td><td><span className="plate plate--table">{item.plate}</span></td><td>{item.type}</td><td>{item.company}</td><td>{item.reason}</td><td><strong>{formatCurrency(item.expertFee)}</strong></td><td>{item.valueLossStatus}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <footer className="table-footer"><span>{filtered.length} kapanan dosya</span><span>Yalnız kullanıcı onaylı ücretler kesin toplamda gösterilir</span></footer>
        </section>

        {selected && <aside className="office-detail" aria-label="Kapanan dosya hızlı detayı">
          <header><div><span className="eyebrow">Kapanan dosya</span><h2>{selected.plate}</h2></div><button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="Kapanan dosya detayını kapat"><X size={18} /></button></header>
          <div className="office-detail__body">
            <span className="plate plate--large">{selected.plate}</span>
            <dl className="detail-list office-detail__list"><div><dt>Dosya No</dt><dd>{selected.officeNumber}</dd></div><div><dt>Kapanış</dt><dd>{selected.closedAt}</dd></div><div><dt>Şirket</dt><dd>{selected.company}</dd></div><div><dt>Servis</dt><dd>{selected.service}</dd></div><div><dt>Sorumlu</dt><dd>{selected.assignee}</dd></div><div><dt>Ücret</dt><dd>{formatCurrency(selected.expertFee)}</dd></div></dl>
            <div className="alert-panel alert-panel--success"><CheckCircle2 size={17} /><div><strong>Kapanış kontrolü tamamlandı</strong><span>{selected.reason}</span></div></div>
          </div>
          <footer><button className="button button--primary button--block" type="button" onClick={() => navigate(`/dosyalar/${selected.caseId}`)}>Salt Okunur Dosyayı Aç</button></footer>
        </aside>}
      </div>
      {notice && <button className="prototype-toast" type="button" onClick={() => setNotice('')}><CheckCircle2 size={15} />{notice}<X size={14} /></button>}
    </main>
  )
}
