import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, FileDown, Printer, RefreshCw, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import {
  getConfiguredDataSource,
  useCaseSummaryReport,
  type ReportsFeesDataPort,
} from '../../data'
import { formatCurrency, mockCases } from '../../mocks/cases'
import { closedCases, pendingClosedFees } from '../../mocks/workspaces'

export function ReportsPage({
  reportPort,
}: {
  readonly reportPort?: ReportsFeesDataPort
} = {}) {
  const navigate = useNavigate()
  const [source] = useState(getConfiguredDataSource)
  const [period, setPeriod] = useState('Temmuz 2026')
  const [assignee, setAssignee] = useState('Tümü')
  const [service, setService] = useState('Tümü')
  const [apiPeriod, setApiPeriod] = useState(() => new Date().toISOString().slice(0, 7))
  const [apiAssignee, setApiAssignee] = useState('')
  const [apiService, setApiService] = useState('')
  const [notice, setNotice] = useState('')
  const apiReport = useCaseSummaryReport({
    period: apiPeriod,
    ...(apiAssignee.length > 0 ? { responsibleUserId: apiAssignee } : {}),
    ...(apiService.length > 0 ? { serviceId: apiService } : {}),
  }, source === 'api', reportPort)

  const visibleCases = useMemo(() => mockCases.filter((item) => (assignee === 'Tümü' || item.assignee === assignee) && (service === 'Tümü' || item.service === service)), [assignee, service])
  const traffic = visibleCases.filter((item) => item.type === 'Trafik').length
  const kasko = visibleCases.length - traffic
  const approvedFee = closedCases.reduce((sum, item) => sum + item.expertFee, 0)

  if (source === 'api') {
    const report = apiReport.report
    const statusMessage = apiReport.status === 'loading' ? 'Dönem raporu yükleniyor…'
      : apiReport.status === 'unauthorized' ? 'Oturum gerekli; mock rapor gösterilmiyor.'
        : apiReport.status === 'forbidden' ? 'Bu raporu görüntüleme yetkiniz yok.'
          : apiReport.status === 'validation' ? 'Dönem veya filtre değeri geçerli değil.'
            : apiReport.status === 'unavailable' ? 'Rapor servisine ulaşılamıyor; mock fallback yapılmadı.'
              : null
    return (
      <main className="page office-page reports-page">
        <section className="page-heading page-heading--compact">
          <div><h1>Raporlar ve Ücretler</h1><p>Gerçek dönem özeti · yalnız kullanıcı onaylı ücretler kesin toplamda</p></div>
        </section>
        <section className="filterbar" aria-label="Rapor filtreleri">
          <label className="select-field"><span className="select-field__label">Dönem</span><input aria-label="Rapor dönemi" type="month" value={apiPeriod} onChange={(event) => { setApiPeriod(event.target.value); setApiAssignee(''); setApiService('') }} /></label>
          <label className="select-field"><span className="select-field__label">Sorumlu</span><select aria-label="Rapor sorumlusu" value={apiAssignee} onChange={(event) => setApiAssignee(event.target.value)}><option value="">Tümü</option>{report?.responsibleUsers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></label>
          <label className="select-field"><span className="select-field__label">Servis</span><select aria-label="Rapor servisi" value={apiService} onChange={(event) => setApiService(event.target.value)}><option value="">Tümü</option>{report?.services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></label>
          <span className="filterbar__context"><CalendarRange size={14} />{apiPeriod}</span>
        </section>
        <div className="office-scroll">
          {statusMessage !== null && (
            <section className="info-panel">
              <div className="assistant-note" role={apiReport.status === 'loading' ? 'status' : 'alert'}><AlertTriangle size={15} /><span>{statusMessage}</span></div>
              {apiReport.status !== 'loading' && <button className="button button--secondary" type="button" onClick={apiReport.reload}><RefreshCw size={14} /> Yenile</button>}
            </section>
          )}
          {report !== null && (
            <>
              <section className="metric-strip" aria-label="Gerçek rapor özeti">
                <div><span>Toplam Dosya</span><strong>{report.summary.totalCaseCount}</strong><small>{report.period}</small></div>
                <div><span>Açık Dosya</span><strong>{report.summary.openCaseCount}</strong><small>Dönemde oluşturulan</small></div>
                <div><span>Kapanan Dosya</span><strong>{report.summary.closedCaseCount}</strong><small>Dönemde kesinleşen</small></div>
                <div><span>Onaylı Eksper Ücreti</span><strong>{formatCurrency(report.summary.approvedFeeTotalMinor / 100)}</strong><small>{report.summary.approvedFeeCount} onaylı kayıt</small></div>
                <div><span>Onaylı Değer Kaybı</span><strong>{formatCurrency(report.summary.approvedValueLossTotalMinor / 100)}</strong><small>{report.summary.approvedValueLossCount} raporlu Trafik dosyası</small></div>
                <div><span>Kontrol Bekleyen</span><strong>{report.summary.controlRequiredFeeCount + report.summary.controlRequiredValueLossCount}</strong><small>{report.summary.controlRequiredFeeCount} ücret · {report.summary.controlRequiredValueLossCount} değer kaybı</small></div>
              </section>
              <div className="reports-grid">
                <section className="info-panel report-distribution"><header><h2>Dosya Dağılımı</h2><span>Gerçek dönem verisi</span></header>
                  {report.distribution.map((item) => {
                    const label = item.code === 'traffic' ? 'Trafik' : item.code === 'casco' ? 'Kasko' : 'Kapanan'
                    const tone = item.code === 'casco' ? ' distribution-row--kasko' : item.code === 'closed' ? ' distribution-row--closed' : ''
                    return <div className={`distribution-row${tone}`} key={item.code}><span>{label}</span><div><i style={{ width: `${Math.max(item.count > 0 ? 10 : 0, item.count / Math.max(1, report.summary.totalCaseCount) * 100)}%` }} /></div><strong>{item.count}</strong></div>
                  })}
                </section>
                <section className="info-panel"><header><h2>Ücret ve Değer Kaybı</h2><span>{report.period}</span></header><dl className="detail-list"><div><dt>Onaylı Ücret</dt><dd>{formatCurrency(report.summary.approvedFeeTotalMinor / 100)}</dd></div><div><dt>Ücret Kontrolü</dt><dd>{report.summary.controlRequiredFeeCount} dosya</dd></div><div><dt>Ücret Kaydı Yok</dt><dd>{report.summary.closedCaseWithoutFeeCount} dosya</dd></div><div><dt>Onaylı Değer Kaybı</dt><dd>{formatCurrency(report.summary.approvedValueLossTotalMinor / 100)}</dd></div><div><dt>Değer Kaybı Kontrolü</dt><dd>{report.summary.controlRequiredValueLossCount} dosya</dd></div><div><dt>Kasko / Uygulanmaz</dt><dd>{report.summary.notApplicableValueLossCount} dosya</dd></div><div><dt>Kural</dt><dd>traffic-value-loss-closure/1.0.0</dd></div></dl></section>
              </div>
              <section className="office-table-panel report-table"><header className="panel-heading"><div><h2>Kapanış Ücreti Bekleyen Dosyalar</h2><span>Aday tutar kesin toplama eklenmez</span></div></header>
                <div className="table-scroll"><table className="data-table"><thead><tr><th>Kapanış</th><th>Dosya No</th><th>Plaka</th><th>Şirket</th><th>Tür</th><th>Sorumlu</th><th>Servis</th><th>Durum</th><th>Aday Tutar</th></tr></thead><tbody>{report.pendingFees.map((row) => <tr key={row.fee.id} tabIndex={0} onClick={() => navigate(`/dosyalar/${row.caseId}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/dosyalar/${row.caseId}`) }}><td>{new Date(row.closedAt).toLocaleDateString('tr-TR')}</td><td>{row.officeCaseNumber}</td><td><span className="plate plate--table">{row.plate}</span></td><td>{row.insurerName ?? '—'}</td><td>{row.caseType === 'traffic' ? 'Trafik' : 'Kasko'}</td><td>{row.responsibleUserName ?? '—'}</td><td>{row.serviceName ?? '—'}</td><td><span className="status-pill status-pill--review">Kontrol Gerekli</span></td><td>{formatCurrency(row.fee.currentVersion.candidateAmountMinor / 100)}</td></tr>)}</tbody></table></div>
                {report.pendingFees.length === 0 && <div className="metadata-empty"><CheckCircle2 size={18} /><span>Bu filtrede ücret kontrolü bekleyen aday yok.</span></div>}
              </section>
            </>
          )}
        </div>
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
