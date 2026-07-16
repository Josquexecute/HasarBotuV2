import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArchiveRestore, CheckCircle2, ChevronDown, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  useClosedCases,
  useClosureFeeList,
  useValueLossClosureList,
  type CasesDataPort,
  type ClosureFeeStatusRecord,
  type ReportsFeesDataPort,
  type TrafficValueLossClosureSummaryRecord,
} from '../../data'
import { formatCurrency } from '../../mocks/cases'
import { closedCases } from '../../mocks/workspaces'
import type { CaseType } from '../../types/case'

type ClosedSort = 'closedAt' | 'officeNumber' | 'plate' | 'expertFee'

interface ClosedCaseView {
  readonly id: string
  readonly caseId: string
  readonly closedAt: string
  readonly officeNumber: string
  readonly plate: string
  readonly type: CaseType
  readonly company: string
  readonly reason: string
  readonly expertFee: number | null
  readonly feeStatus: ClosureFeeStatusRecord | 'mock_approved' | null
  readonly valueLossStatus: string
  readonly valueLossSummary: TrafficValueLossClosureSummaryRecord | null
  readonly service: string
  readonly assignee: string
  readonly hasClosureDetails: boolean
}

function feeLabel(value: number | null, status: ClosedCaseView['feeStatus']): string {
  if (status === 'control_required') return 'Kontrol gerekli'
  return value === null ? '—' : formatCurrency(value)
}

function valueLossLabel(summary: TrafficValueLossClosureSummaryRecord | null, fallback: string): string {
  if (summary === null) return fallback
  if (summary.status === 'not_applicable') return 'Uygulanmaz'
  if (summary.status === 'control_required') return 'Kontrol gerekli'
  if (summary.resultCode === 'no_value_loss') return 'Değer kaybı oluşmaz'
  return summary.amountMinor === null ? 'Onaylı ve raporlu' : formatCurrency(summary.amountMinor / 100)
}

export function ClosedCasesPage({
  casesPort,
  feePort,
}: {
  readonly casesPort?: CasesDataPort
  readonly feePort?: ReportsFeesDataPort
} = {}) {
  const navigate = useNavigate()
  const { cases: apiCases, source, status } = useClosedCases(casesPort)
  const feeList = useClosureFeeList(source === 'api', feePort)
  const valueLossList = useValueLossClosureList(source === 'api', feePort)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('Tümü')
  const [reason, setReason] = useState('Tümü')
  const [sort, setSort] = useState<ClosedSort>('closedAt')
  const [selectedId, setSelectedId] = useState<string | null>(
    source === 'mock' ? closedCases[0]?.id ?? null : null,
  )
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  const records = useMemo<readonly ClosedCaseView[]>(() => {
    if (source === 'mock') {
      return closedCases.map((item) => ({ ...item, feeStatus: 'mock_approved' as const, valueLossSummary: null, hasClosureDetails: true }))
    }
    const feeByCase = new Map(feeList.items.map((item) => [item.caseId, item]))
    const valueLossByCase = new Map(valueLossList.items.map((item) => [item.caseId, item]))
    return apiCases.map((item) => {
      const feeItem = feeByCase.get(item.caseId)
      const feeVersion = feeItem?.fee.currentVersion
      const valueLossItem = valueLossByCase.get(item.caseId)
      return {
      id: item.caseId,
      caseId: item.caseId,
      closedAt: valueLossItem === undefined
        ? feeItem === undefined ? '—' : new Date(feeItem.closedAt).toLocaleDateString('tr-TR')
        : new Date(valueLossItem.closedAt).toLocaleDateString('tr-TR'),
      officeNumber: item.officeNumber,
      plate: item.plate,
      type: item.type,
      company: item.company,
      reason: valueLossItem === undefined
        ? 'Kapanış ayrıntısı henüz bağlı değil'
        : valueLossItem.closureReason ?? (valueLossItem.closureMode === 'with_missing_requirements' ? 'Eksiklerle kapatıldı' : 'Normal kapanış'),
      expertFee: feeVersion?.approvedAmountMinor === null || feeVersion?.approvedAmountMinor === undefined
        ? null
        : feeVersion.approvedAmountMinor / 100,
      feeStatus: feeVersion?.status ?? null,
      valueLossStatus: valueLossLabel(valueLossItem?.summary ?? null, 'Kapanış özeti bağlı değil'),
      valueLossSummary: valueLossItem?.summary ?? null,
      service: item.service,
      assignee: item.assignee,
      hasClosureDetails: valueLossItem !== undefined,
    }}
    )
  }, [apiCases, feeList.items, source, valueLossList.items])

  const filtered = useMemo(() => {
    const normalized = query.toLocaleLowerCase('tr-TR')
    return [...records]
      .filter((item) => !normalized || [item.officeNumber, item.plate, item.company, item.service, item.assignee].some((value) => value.toLocaleLowerCase('tr-TR').includes(normalized)))
      .filter((item) => type === 'Tümü' || item.type === type)
      .filter((item) => reason === 'Tümü' || item.reason === reason)
      .sort((a, b) => {
        if (sort === 'expertFee') return (b.expertFee ?? -1) - (a.expertFee ?? -1)
        return a[sort].localeCompare(b[sort], 'tr') * (sort === 'closedAt' ? -1 : 1)
      })
  }, [query, reason, records, sort, type])

  const selected = selectedId === null ? null : filtered.find((item) => item.id === selectedId) ?? null

  return (
    <main className="page office-page">
      <section className="page-heading page-heading--compact">
        <div>
          <h1>Kapanan Dosyalar <span className="heading-count">{filtered.length}</span></h1>
          <p>{source === 'api' ? 'Gerçek API · kapalı case kayıtları' : 'Kapanış bilgileri ve kullanıcı onaylı ücret görünümü'}</p>
          {source === 'api' && status === 'loading' && <p role="status" className="page-subtitle">Kapalı dosyalar yükleniyor…</p>}
          {source === 'api' && status === 'unauthorized' && <p role="alert" className="page-subtitle">Oturum gerekli; mock veri gösterilmiyor.</p>}
          {source === 'api' && status === 'unavailable' && <p role="alert" className="page-subtitle">Kapalı dosya servisine ulaşılamıyor; mock veri gösterilmiyor.</p>}
          {source === 'api' && feeList.status === 'unavailable' && <p role="alert" className="page-subtitle">Ücret servisine ulaşılamıyor; ücret alanlarında varsayım yapılmıyor.</p>}
          {source === 'api' && valueLossList.status === 'unavailable' && <p role="alert" className="page-subtitle">Değer kaybı kapanış özetine ulaşılamıyor; mock veya tahmini sonuç gösterilmiyor.</p>}
        </div>
        {source === 'mock' && (
          <button className="button button--secondary" type="button" onClick={() => setNotice('Yeniden açma önizlemesi mock olarak hazırlandı.')}><ArchiveRestore size={15} /> Yeniden Açma Önizlemesi</button>
        )}
      </section>

      <section className="filterbar" aria-label="Kapanan dosya filtreleri">
        <label className="field field--search office-search"><Search size={15} /><span className="sr-only">Kapanan dosyalarda ara</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dosya no, plaka, şirket, servis veya sorumlu ara..." /></label>
        <label className="select-field"><span className="select-field__label">Tür</span><select aria-label="Kapanan dosya türü" value={type} onChange={(event) => setType(event.target.value)}><option>Tümü</option><option>Trafik</option><option>Kasko</option></select><ChevronDown size={14} /></label>
        {source === 'mock' && <label className="select-field"><span className="select-field__label">Sebep</span><select aria-label="Kapanış sebebi" value={reason} onChange={(event) => setReason(event.target.value)}><option>Tümü</option>{Array.from(new Set(closedCases.map((item) => item.reason))).map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></label>}
        <label className="select-field"><span className="select-field__label">Sırala</span><select aria-label="Kapanan dosya sıralaması" value={sort} onChange={(event) => setSort(event.target.value as ClosedSort)}><option value="closedAt">Kapanış tarihi</option><option value="officeNumber">Dosya no</option><option value="plate">Plaka A–Z</option>{source === 'mock' && <option value="expertFee">Eksper ücreti</option>}</select><ChevronDown size={14} /></label>
      </section>

      <div className={`office-workarea${selected ? ' office-workarea--detail' : ''}`}>
        <section className="office-table-panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Kapanış</th><th>Dosya No</th><th>Plaka</th><th>Tür</th><th>Sigorta Şirketi</th><th>Kapanış Sebebi</th><th>Eksper Ücreti</th><th>Değer Kaybı</th></tr></thead>
              <tbody>{filtered.map((item) => (
                <tr key={item.id} tabIndex={0} className={selected?.id === item.id ? 'is-selected' : ''} onClick={() => setSelectedId(item.id)} onKeyDown={(event) => { if (event.key === 'Enter') setSelectedId(item.id) }}>
                  <td>{item.closedAt}</td><td className="mono">{item.officeNumber}</td><td><span className="plate plate--table">{item.plate}</span></td><td>{item.type}</td><td>{item.company}</td><td>{item.reason}</td><td><strong>{feeLabel(item.expertFee, item.feeStatus)}</strong></td><td>{item.valueLossStatus}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <footer className="table-footer">
            <span>{filtered.length} kapanan dosya</span>
            <span>{source === 'api' ? 'Bağlı olmayan kapanış ve ücret alanlarında varsayım yapılmaz' : 'Yalnız kullanıcı onaylı ücretler kesin toplamda gösterilir'}</span>
          </footer>
        </section>

        {selected && <aside className="office-detail" aria-label="Kapanan dosya hızlı detayı">
          <header><div><span className="eyebrow">Kapanan dosya</span><h2>{selected.plate}</h2></div><button className="icon-button" type="button" onClick={() => setSelectedId(null)} aria-label="Kapanan dosya detayını kapat"><X size={18} /></button></header>
          <div className="office-detail__body">
            <span className="plate plate--large">{selected.plate}</span>
            <dl className="detail-list office-detail__list"><div><dt>Dosya No</dt><dd>{selected.officeNumber}</dd></div><div><dt>Kapanış</dt><dd>{selected.closedAt}</dd></div><div><dt>Şirket</dt><dd>{selected.company}</dd></div><div><dt>Servis</dt><dd>{selected.service}</dd></div><div><dt>Sorumlu</dt><dd>{selected.assignee}</dd></div><div><dt>Ücret</dt><dd>{feeLabel(selected.expertFee, selected.feeStatus)}</dd></div><div><dt>Ücret Durumu</dt><dd>{selected.feeStatus === 'approved' ? 'Kullanıcı Onaylı' : selected.feeStatus === 'corrected' ? 'Kullanıcı Düzeltti' : selected.feeStatus === 'control_required' ? 'Kontrol Gerekli' : 'Kayıt yok'}</dd></div><div><dt>Değer Kaybı</dt><dd>{selected.valueLossStatus}</dd></div><div><dt>Değer Kaybı Kuralı</dt><dd>{selected.valueLossSummary?.calculationRuleVersion ?? selected.valueLossSummary?.ruleVersion ?? '—'}</dd></div><div><dt>Nihai Rapor</dt><dd>{selected.valueLossSummary?.reportId === null || selected.valueLossSummary === null ? '—' : 'Doğrulanmış rapor bağlı'}</dd></div></dl>
            {selected.valueLossSummary?.status === 'control_required'
              ? <div className="alert-panel alert-panel--warning"><AlertTriangle size={17} /><div><strong>Kapanış özeti kontrol gerektiriyor</strong><span>{selected.valueLossSummary.reason}</span></div></div>
              : selected.hasClosureDetails
              ? <div className="alert-panel alert-panel--success"><CheckCircle2 size={17} /><div><strong>Kapanış kontrolü tamamlandı</strong><span>{selected.reason}</span></div></div>
              : <div className="alert-panel alert-panel--warning"><AlertTriangle size={17} /><div><strong>Kapanış ayrıntıları bağlı değil</strong><span>Case kimliği ve yaşam döngüsü gerçektir; ücret veya kapanış gerekçesi varsayılmadı.</span></div></div>}
          </div>
          <footer><button className="button button--primary button--block" type="button" onClick={() => navigate(`/dosyalar/${selected.caseId}`)}>Salt Okunur Dosyayı Aç</button></footer>
        </aside>}
      </div>
      {notice && <button className="prototype-toast" type="button" onClick={() => setNotice('')}><CheckCircle2 size={15} />{notice}<X size={14} /></button>}
    </main>
  )
}
