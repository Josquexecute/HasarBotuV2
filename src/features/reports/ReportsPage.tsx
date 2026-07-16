import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, FileDown, Printer, X } from 'lucide-react'
import { getConfiguredDataSource } from '../../data'
import { formatCurrency, mockCases } from '../../mocks/cases'
import { closedCases, pendingClosedFees } from '../../mocks/workspaces'

export function ReportsPage() {
  const [source] = useState(getConfiguredDataSource)
  const [period, setPeriod] = useState('Temmuz 2026')
  const [assignee, setAssignee] = useState('Tümü')
  const [service, setService] = useState('Tümü')
  const [notice, setNotice] = useState('')

  const visibleCases = useMemo(() => mockCases.filter((item) => (assignee === 'Tümü' || item.assignee === assignee) && (service === 'Tümü' || item.service === service)), [assignee, service])
  const traffic = visibleCases.filter((item) => item.type === 'Trafik').length
  const kasko = visibleCases.length - traffic
  const approvedFee = closedCases.reduce((sum, item) => sum + item.expertFee, 0)

  if (source === 'api') {
    return (
      <main className="page office-page reports-page">
        <section className="page-heading page-heading--compact">
          <div><h1>Raporlar ve Ücretler</h1><p>Gerçek API modu</p></div>
        </section>
        <section className="info-panel">
          <header><h2>Gerçek rapor verisi henüz bağlı değil</h2><AlertTriangle size={16} /></header>
          <div className="assistant-note"><AlertTriangle size={15} /><span>Mock dosya, ücret veya dönem toplamı gösterilmiyor.</span></div>
          <p>Rapor ve kullanıcı onaylı ücret endpoint’leri tamamlandığında bu çalışma alanı gerçek veriye bağlanacaktır.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="page office-page reports-page">
      <section className="page-heading page-heading--compact">
        <div><h1>Raporlar ve Ücretler</h1><p>Operasyon dağılımı ve onaylı ücretlerin mock dönem özeti</p></div>
        <div className="heading-actions"><button className="button button--secondary" type="button" onClick={() => setNotice('Excel dışa aktarma önizlemesi hazırlandı.')}><FileDown size={15} /> Excel Taslağı</button><button className="button button--secondary" type="button" onClick={() => setNotice('Yazdırma önizlemesi mock olarak açıldı.')}><Printer size={15} /> Yazdır</button></div>
      </section>
      <section className="filterbar" aria-label="Rapor filtreleri">
        <label className="select-field"><span className="select-field__label">Dönem</span><select aria-label="Rapor dönemi" value={period} onChange={(event) => setPeriod(event.target.value)}><option>Temmuz 2026</option><option>Haziran 2026</option><option>2026 2. Çeyrek</option></select><ChevronDown size={14} /></label>
        <label className="select-field"><span className="select-field__label">Sorumlu</span><select aria-label="Rapor sorumlusu" value={assignee} onChange={(event) => setAssignee(event.target.value)}><option>Tümü</option>{Array.from(new Set(mockCases.map((item) => item.assignee))).map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></label>
        <label className="select-field"><span className="select-field__label">Servis</span><select aria-label="Rapor servisi" value={service} onChange={(event) => setService(event.target.value)}><option>Tümü</option>{Array.from(new Set(mockCases.map((item) => item.service))).map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></label>
        <span className="filterbar__context"><CalendarRange size={14} />{period}</span>
      </section>

      <div className="office-scroll">
        <section className="metric-strip" aria-label="Rapor özeti">
          <div><span>Toplam Dosya</span><strong>{visibleCases.length + closedCases.length}</strong><small>{period}</small></div>
          <div><span>Açık Dosya</span><strong>{visibleCases.length}</strong><small>Aktif operasyon</small></div>
          <div><span>Kapanan Dosya</span><strong>{closedCases.length}</strong><small>Dönem kapanışı</small></div>
          <div><span>Onaylı Eksper Ücreti</span><strong>{formatCurrency(approvedFee)}</strong><small>Kesin toplama giren</small></div>
          <div><span>Ücret Kontrolü Bekleyen</span><strong>{pendingClosedFees.length}</strong><small>Kesin toplam dışında</small></div>
        </section>

        <div className="reports-grid">
          <section className="info-panel report-distribution"><header><h2>Dosya Dağılımı</h2><span>Grafik kütüphanesi kullanılmadı</span></header>
            <div className="distribution-row"><span>Trafik</span><div><i style={{ width: `${Math.max(10, traffic / Math.max(1, visibleCases.length) * 100)}%` }} /></div><strong>{traffic}</strong></div>
            <div className="distribution-row distribution-row--kasko"><span>Kasko</span><div><i style={{ width: `${Math.max(10, kasko / Math.max(1, visibleCases.length) * 100)}%` }} /></div><strong>{kasko}</strong></div>
            <div className="distribution-row distribution-row--closed"><span>Kapanan</span><div><i style={{ width: '62%' }} /></div><strong>{closedCases.length}</strong></div>
          </section>
          <section className="info-panel"><header><h2>Ücret Durumu</h2><span>Temmuz 2026</span></header><dl className="detail-list"><div><dt>Kullanıcı Onaylı</dt><dd>{formatCurrency(approvedFee)}</dd></div><div><dt>Kontrol Bekliyor</dt><dd>{formatCurrency(28750)}</dd></div><div><dt>Tutar Bulunamadı</dt><dd>2 dosya</dd></div><div><dt>Birden Fazla Aday</dt><dd>1 dosya</dd></div></dl></section>
        </div>

        <section className="office-table-panel report-table"><header className="panel-heading"><div><h2>Kapanış Ücreti Bekleyen Dosyalar</h2><span>Kullanıcı onayı olmadan kesin toplama eklenmez</span></div></header>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Kapanış</th><th>Dosya No</th><th>Plaka</th><th>Şirket</th><th>Tür</th><th>Sorumlu</th><th>Servis</th><th>Durum</th><th>Aday Tutar</th></tr></thead><tbody>{pendingClosedFees.map((item) => <tr key={item.id}><td>{item.closedAt}</td><td>{item.officeNumber}</td><td><span className="plate plate--table">{item.plate}</span></td><td>{item.company}</td><td>{item.type}</td><td>{item.assignee}</td><td>{item.service}</td><td><span className="status-pill status-pill--review">{item.status}</span></td><td>{item.candidateFee === null ? '—' : formatCurrency(item.candidateFee)}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      {notice && <button className="prototype-toast" type="button" onClick={() => setNotice('')}><CheckCircle2 size={15} />{notice}<X size={14} /></button>}
    </main>
  )
}
