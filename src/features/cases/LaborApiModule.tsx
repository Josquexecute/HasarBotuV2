import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, History, Plus, RefreshCw, Save, Trash2, Wrench } from 'lucide-react'
import { formatCurrency } from '../../mocks/cases'
import {
  LaborError,
  useLabor,
  type DataSourceKind,
  type LaborDataPort,
  type LaborItemInputRecord,
  type LaborSheetVersionRecord,
} from '../../data'
import type { CaseRecord } from '../../types/case'

interface Props {
  readonly item: CaseRecord
  readonly source: DataSourceKind
  readonly onUnauthorized: () => void
  readonly port?: LaborDataPort
}

interface EditableRow {
  description: string
  action: string
  part: string
  labor: string
}

function formatMinor(minor: number): string {
  return formatCurrency(minor / 100)
}

/** Kullanıcı tutarını minor birime çevirir; boş alan 0 sayılır. Geçersizse null. */
function parseMinorAllowZero(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') return 0
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null
}

function loadMessage(status: string): string | null {
  if (status === 'loading') return 'İşçilik föyü yükleniyor…'
  if (status === 'unauthorized') return 'Oturum gerekli; mock işçilik gösterilmiyor.'
  if (status === 'forbidden') return 'Bu işlem için yetkiniz yok.'
  if (status === 'not_found') return 'Dosya bulunamadı.'
  if (status === 'unavailable') return 'İşçilik servisine ulaşılamıyor; mock fallback yapılmadı.'
  return null
}

function emptyRow(): EditableRow {
  return { description: '', action: '', part: '', labor: '' }
}

function rowsFromVersion(version: LaborSheetVersionRecord): EditableRow[] {
  return version.items.map((line) => ({
    description: line.description,
    action: line.action,
    part: line.partAmountMinor === 0 ? '' : String(line.partAmountMinor / 100),
    labor: line.laborAmountMinor === 0 ? '' : String(line.laborAmountMinor / 100),
  }))
}

function safeMessage(error: unknown): string {
  if (error instanceof LaborError) {
    if (error.kind === 'conflict') return 'Föy değişti veya bu durumda işlem yapılamıyor. Güncel veriyi yükleyin.'
    if (error.kind === 'validation') return 'Girilen kalem, işlem veya tutar geçerli değil.'
    if (error.kind === 'forbidden') return 'Bu işlem için yetkiniz yok.'
    if (error.kind === 'unavailable') return 'İşçilik servisine ulaşılamadı; mock fallback yapılmadı.'
  }
  return 'İşlem tamamlanamadı.'
}

export function LaborApiModule({ item, source, onUnauthorized, port }: Props) {
  const workspace = useLabor(item.caseId, source, true, port)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<EditableRow[]>([emptyRow()])
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const data = workspace.data
  const sheet = data?.sheet ?? null
  const canWrite = data?.permissions.canWrite === true && data.lifecycleStatus === 'open'

  const totals = useMemo(() => {
    let part = 0
    let labor = 0
    for (const row of rows) {
      part += parseMinorAllowZero(row.part) ?? 0
      labor += parseMinorAllowZero(row.labor) ?? 0
    }
    return { part, labor, grand: part + labor }
  }, [rows])

  const run = async (label: string, operation: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (caught) {
      setError(safeMessage(caught))
      if (caught instanceof LaborError && caught.kind === 'unauthorized') onUnauthorized()
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const startEdit = () => {
    setRows(sheet ? rowsFromVersion(sheet.currentVersion) : [emptyRow()])
    setReason('')
    setConfirmed(false)
    setError('')
    setNotice('')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setError('')
    setNotice('')
  }

  const updateRow = (index: number, field: keyof EditableRow, value: string) => {
    setRows((current) => current.map((row, position) => position === index ? { ...row, [field]: value } : row))
  }

  const addRow = () => setRows((current) => [...current, emptyRow()])
  const removeRow = (index: number) => setRows((current) => current.length <= 1 ? current : current.filter((_, position) => position !== index))

  const buildItems = (): readonly LaborItemInputRecord[] | null => {
    const items: LaborItemInputRecord[] = []
    for (const row of rows) {
      const description = row.description.trim()
      const action = row.action.trim()
      const partAmountMinor = parseMinorAllowZero(row.part)
      const laborAmountMinor = parseMinorAllowZero(row.labor)
      if (description === '' || action === '') {
        setError('Her satırda kalem ve işlem alanı zorunludur.')
        return null
      }
      if (partAmountMinor === null || laborAmountMinor === null) {
        setError('Parça ve işçilik tutarları geçerli sayı olmalıdır.')
        return null
      }
      if (partAmountMinor + laborAmountMinor === 0) {
        setError('Her satırda parça veya işçilik tutarından en az biri girilmelidir.')
        return null
      }
      items.push({ description, action, partAmountMinor, laborAmountMinor })
    }
    return items
  }

  const save = () => {
    if (!confirmed) {
      setError('Föyün kaydedilmesini açıkça onaylayın.')
      return
    }
    if (sheet !== null && reason.trim().length === 0) {
      setError('Sürüm gerekçesi zorunludur.')
      return
    }
    const items = buildItems()
    if (items === null) return
    void run('save', async () => {
      if (sheet === null) {
        if (data === null) return
        await workspace.port.create(item.caseId, {
          expectedCaseVersion: data.caseVersion,
          items,
          confirmed: true,
        })
        setNotice('İşçilik föyü kullanıcı onayıyla kaydedildi.')
      } else {
        await workspace.port.revise(item.caseId, {
          expectedVersion: sheet.version,
          items,
          reason: reason.trim(),
          confirmed: true,
        })
        setNotice('İşçilik föyünün yeni sürümü kaydedildi.')
      }
      setEditing(false)
      setConfirmed(false)
      workspace.reload()
    })
  }

  if (source !== 'api') return null

  const message = loadMessage(workspace.status)
  if (workspace.status !== 'ok' || data === null) {
    return (
      <div className="module-placeholder">
        <Wrench size={26} />
        <h2>İşçilik</h2>
        <p>{message ?? 'İşçilik föyü hazırlanıyor…'}</p>
        <button className="button" type="button" onClick={() => workspace.reload()}><RefreshCw size={15} /> Yeniden dene</button>
      </div>
    )
  }

  return (
    <div className="module-workspace labor-module">
      <section className="info-panel module-workspace__main">
        <header>
          <h2>Parça ve İşçilik Dağılımı</h2>
          <span className={`status-pill ${sheet ? 'status-pill--open' : 'status-pill--review'}`}>
            {sheet ? `Sürüm ${sheet.version}` : 'Föy yok'}
          </span>
        </header>

        {error !== '' && <p className="form-alert form-alert--error"><AlertTriangle size={15} /> {error}</p>}
        {notice !== '' && <p className="form-alert form-alert--ok"><CheckCircle2 size={15} /> {notice}</p>}

        {!editing && (
          sheet === null
            ? <p className="labor-empty">Bu dosya için henüz kullanıcı kontrollü işçilik föyü oluşturulmadı. Kalemler AI veya Excel’den otomatik alınmaz.</p>
            : (
              <div className="table-scroll module-table-scroll">
                <table className="data-table module-table">
                  <thead><tr><th>Kalem</th><th>İşlem</th><th>Parça</th><th>İşçilik</th></tr></thead>
                  <tbody>
                    {sheet.currentVersion.items.map((line) => (
                      <tr key={line.ordinal}>
                        <td>{line.description}</td>
                        <td>{line.action}</td>
                        <td>{formatMinor(line.partAmountMinor)}</td>
                        <td>{formatMinor(line.laborAmountMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Toplam</td>
                      <td>{formatMinor(sheet.currentVersion.totals.partTotalMinor)}</td>
                      <td>{formatMinor(sheet.currentVersion.totals.laborTotalMinor)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
        )}

        {editing && (
          <div className="labor-editor">
            <div className="table-scroll module-table-scroll">
              <table className="data-table module-table labor-editor__table">
                <thead><tr><th>Kalem</th><th>İşlem</th><th>Parça (₺)</th><th>İşçilik (₺)</th><th aria-label="İşlemler" /></tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      <td><input aria-label={`Kalem ${index + 1}`} value={row.description} onChange={(event) => updateRow(index, 'description', event.target.value)} placeholder="Ön tampon" /></td>
                      <td><input aria-label={`İşlem ${index + 1}`} value={row.action} onChange={(event) => updateRow(index, 'action', event.target.value)} placeholder="Değişim" /></td>
                      <td><input aria-label={`Parça tutarı ${index + 1}`} value={row.part} inputMode="decimal" onChange={(event) => updateRow(index, 'part', event.target.value)} placeholder="0,00" /></td>
                      <td><input aria-label={`İşçilik tutarı ${index + 1}`} value={row.labor} inputMode="decimal" onChange={(event) => updateRow(index, 'labor', event.target.value)} placeholder="0,00" /></td>
                      <td><button className="icon-button" type="button" aria-label={`Satırı sil ${index + 1}`} onClick={() => removeRow(index)} disabled={rows.length <= 1}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Taslak toplam</td>
                    <td>{formatMinor(totals.part)}</td>
                    <td>{formatMinor(totals.labor)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <button className="button button--secondary" type="button" onClick={addRow}><Plus size={15} /> Satır ekle</button>
            {sheet !== null && (
              <label className="form-field"><span>Sürüm gerekçesi</span>
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Örnek: Parça bedeli güncellendi" maxLength={500} />
              </label>
            )}
            <label className="email-draft-confirm labor-confirm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>Kalem, işlem ve tutarları kontrol ettim; föyün sürümlü olarak kaydedilmesini onaylıyorum.</span>
            </label>
            <div className="labor-editor__actions">
              <button className="button button--primary" type="button" onClick={save} disabled={busy !== '' || !confirmed}><Save size={15} /> {sheet === null ? 'Föyü Kaydet' : 'Yeni Sürümü Kaydet'}</button>
              <button className="button" type="button" onClick={cancelEdit} disabled={busy !== ''}>Vazgeç</button>
            </div>
          </div>
        )}

        {!editing && canWrite && (
          <div className="labor-editor__actions">
            <button className="button button--primary" type="button" onClick={startEdit}>
              {sheet === null ? 'İşçilik Föyü Oluştur' : 'Föyü Düzenle'}
            </button>
          </div>
        )}
        {!editing && !canWrite && (
          <p className="labor-empty">{data.lifecycleStatus === 'closed' ? 'Kapalı dosyanın işçilik föyü salt okunurdur.' : 'İşçilik föyünü düzenleme yetkiniz yok.'}</p>
        )}
      </section>

      <aside className="info-panel labor-side">
        <header><h2>Föy Bilgisi</h2><Wrench size={16} /></header>
        {sheet === null
          ? <p>Föy kullanıcı tarafından oluşturulur. Tutarlar minor birimde saklanır; AI önerisi ve güvenli Excel yazımı sonraki geliştirme aşamalarına bırakılmıştır.</p>
          : (
            <>
              <dl className="detail-list">
                <div><dt>Parça Toplamı</dt><dd>{formatMinor(sheet.currentVersion.totals.partTotalMinor)}</dd></div>
                <div><dt>İşçilik Toplamı</dt><dd>{formatMinor(sheet.currentVersion.totals.laborTotalMinor)}</dd></div>
                <div><dt>Genel Toplam</dt><dd>{formatMinor(sheet.currentVersion.totals.grandTotalMinor)}</dd></div>
                <div><dt>Kaydeden</dt><dd>{sheet.currentVersion.createdByDisplayName}</dd></div>
              </dl>
              <h3 className="labor-side__title"><History size={14} /> Sürüm Geçmişi</h3>
              <ul className="labor-history">
                {sheet.versions.map((version) => (
                  <li key={version.id}>
                    <strong>Sürüm {version.sheetVersion}</strong> · {formatMinor(version.totals.grandTotalMinor)}
                    <span>{version.sourceType === 'user_entered' ? 'İlk kayıt' : version.revisionReason ?? 'Düzeltme'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
      </aside>
    </div>
  )
}
