import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, LockKeyhole } from 'lucide-react'
import type { LaborExcelProfileCandidateRecord, LaborExcelProjectionRecord } from '../../data/laborExcelProfilePort'
import { LaborWorkbookApplyClientError, createHttpLaborWorkbookApplyAdapter, type LaborWorkbookApplyDataPort, type LaborWorkbookApplyResponseRecord } from '../../data/laborWorkbookApplyPort'
function newKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function minor(value: number | null): string {
  if (value === null) return '—'
  return `${(value / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₺`
}

export function LaborWorkbookApplyPanel(props: {
  readonly caseId: string
  readonly applicationId: string
  readonly profile: LaborExcelProfileCandidateRecord
  readonly projection: LaborExcelProjectionRecord
  readonly port?: LaborWorkbookApplyDataPort
}) {
  const adapter = useMemo(
    () => props.port ?? createHttpLaborWorkbookApplyAdapter(),
    [props.port],
  )
  const [relativePath, setRelativePath] = useState('')
  const [headerCell, setHeaderCell] = useState('D1')
  const [headerText, setHeaderText] = useState('')
  const [plateCell, setPlateCell] = useState('')
  const [officeCell, setOfficeCell] = useState('')
  const [rows, setRows] = useState<Record<number, string>>({})
  const [result, setResult] = useState<LaborWorkbookApplyResponseRecord | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requiredRowsValid = props.projection.lines.every((line) => {
    const row = Number(rows[line.lineOrdinal])
    return Number.isInteger(row) && row >= 2 && row <= 1_048_576
  })
  const identityValid =
    (!props.profile.identityChecks.plate || /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(plateCell))
    && (!props.profile.identityChecks.officeNumber
      || /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(officeCell))
  const previewBlocked = busy
    || relativePath.trim() === ''
    || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(headerCell)
    || headerText.trim() === ''
    || !requiredRowsValid
    || !identityValid
    || !props.profile.writable
    || props.profile.targetSheet === null
    || props.projection.manualEntryLineCount > 0
    || props.projection.reviewRequiredLineCount > 0
    || props.projection.unmappedTotalMinor > 0

  useEffect(() => {
    const operation = result?.operation
    if (operation === undefined
      || !['preview_pending', 'approved', 'applying'].includes(operation.status)) {
      return undefined
    }
    let cancelled = false
    const timer = setInterval(() => {
      void adapter.get(props.caseId, operation.id)
        .then((next) => {
          if (!cancelled) setResult(next)
        })
        .catch(() => undefined)
    }, 1_500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [adapter, props.caseId, result?.operation])

  const preview = async () => {
    setBusy(true)
    setError(null)
    setConfirmed(false)
    try {
      setResult(await adapter.preview(props.caseId, {
        applicationId: props.applicationId,
        profileId: props.profile.profileId,
        workbookRelativePath: relativePath.trim(),
        expectedSourceSha256: null,
        headers: [{ cell: headerCell, text: headerText.trim() }],
        identityCellReferences: {
          plateCell: props.profile.identityChecks.plate ? plateCell : null,
          officeNumberCell: props.profile.identityChecks.officeNumber
            ? officeCell
            : null,
        },
        sourceRows: props.projection.lines.map((line) => ({
          lineOrdinal: line.lineOrdinal,
          rowNumber: Number(rows[line.lineOrdinal]),
        })),
        idempotencyKey: newKey('labor-workbook-preview'),
      }))
    } catch (caught) {
      setResult(null)
      setError(caught instanceof LaborWorkbookApplyClientError
        ? caught.kind
        : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    if (result === null || !confirmed) return
    setBusy(true)
    setError(null)
    try {
      setResult(await adapter.approve(
        props.caseId,
        result.operation,
        newKey('labor-workbook-approve'),
      ))
      setConfirmed(false)
    } catch (caught) {
      setError(caught instanceof LaborWorkbookApplyClientError
        ? caught.kind
        : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  const operation = result?.operation ?? null
  const applyBlocked = operation === null
    || operation.status !== 'preview_ready'
    || operation.planHash === null
    || operation.controlRequiredRowCount > 0
    || result?.permissions.canApprove !== true
    || !confirmed
    || busy

  return (
    <section className="workbook-apply" aria-label="Güvenli workbook yazımı">
      <header>
        <h3><FileSpreadsheet size={16} /> Güvenli Workbook Yazımı</h3>
        <p>
          Yalnız hedef sayfadaki D hücreleri yazılır. Önizleme tamamlanmadan ve
          açık onay verilmeden fiziksel dosya değişmez.
        </p>
      </header>

      <div className="workbook-apply__fields">
        <label className="field">
          <span>Vaka klasörüne göre workbook yolu</span>
          <input
            value={relativePath}
            onChange={(event) => setRelativePath(event.target.value)}
            placeholder="EVRAK/ISÇILIK.xlsx"
          />
        </label>
        <label className="field">
          <span>Başlık hücresi</span>
          <input value={headerCell} onChange={(event) => setHeaderCell(event.target.value.toUpperCase())} />
        </label>
        <label className="field">
          <span>Beklenen başlık</span>
          <input value={headerText} onChange={(event) => setHeaderText(event.target.value)} />
        </label>
        {props.profile.identityChecks.plate && (
          <label className="field">
            <span>Plaka hücresi</span>
            <input value={plateCell} onChange={(event) => setPlateCell(event.target.value.toUpperCase())} />
          </label>
        )}
        {props.profile.identityChecks.officeNumber && (
          <label className="field">
            <span>Dosya numarası hücresi</span>
            <input value={officeCell} onChange={(event) => setOfficeCell(event.target.value.toUpperCase())} />
          </label>
        )}
      </div>

      <div className="table-scroll">
        <table className="data-table module-table">
          <thead>
            <tr>
              <th>Kalem</th>
              <th>Kaynak workbook satırı</th>
              <th>Hedef</th>
            </tr>
          </thead>
          <tbody>
            {props.projection.lines.map((line) => (
              <tr key={line.lineOrdinal}>
                <td>{line.lineOrdinal}. {line.description}</td>
                <td>
                  <input
                    aria-label={`${line.lineOrdinal}. kalem workbook satırı`}
                    inputMode="numeric"
                    value={rows[line.lineOrdinal] ?? ''}
                    onChange={(event) => setRows((current) => ({
                      ...current,
                      [line.lineOrdinal]: event.target.value,
                    }))}
                    placeholder="2"
                  />
                </td>
                <td>
                  {rows[line.lineOrdinal] === undefined
                    ? 'D—'
                    : `D${rows[line.lineOrdinal]}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        className="button button--primary"
        type="button"
        disabled={previewBlocked}
        onClick={() => void preview()}
      >
        {busy ? 'İşleniyor…' : 'Değişiklik Önizlemesi Oluştur'}
      </button>

      {error !== null && (
        <p className="allocation-panel__error" role="alert">
          Workbook işlemi tamamlanamadı ({error}). Fiziksel yazım yapılmadı.
        </p>
      )}

      {operation !== null && (
        <div className="workbook-apply__result" role="status">
          <strong>Durum: {operation.status}</strong>
          <span>
            Sayfa: {operation.sheetName} · Değişen {operation.changedRowCount}
            {' · '}Değişmeyen {operation.unchangedRowCount}
            {' · '}Kontrol gerekli {operation.controlRequiredRowCount}
          </span>
          <span>
            Eski toplam {minor(operation.previousTotalMinor)}
            {' → '}Yeni toplam {minor(operation.newTotalMinor)}
          </span>
          {operation.rows.length > 0 && (
            <div className="table-scroll">
              <table className="data-table module-table">
                <thead>
                  <tr>
                    <th>Satır</th><th>Parça</th><th>İşlem</th>
                    <th>Eski D</th><th>Yeni D</th><th>Kaynak</th><th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {operation.rows.map((row) => (
                    <tr key={row.lineOrdinal}>
                      <td>{row.cell}</td>
                      <td>{row.partCode ?? '—'} · {row.partName}</td>
                      <td>{row.operationType}</td>
                      <td>{row.previousValue ?? '—'}</td>
                      <td>{row.newValue}</td>
                      <td>
                        Onaylı nihai değer
                        {row.manuallyModified ? ' · kullanıcı düzeltmesi' : ''}
                      </td>
                      <td>
                        {row.conflictCodes.length > 0
                          ? `control_required: ${row.conflictCodes.join(', ')}`
                          : row.matchConfidence}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {operation.status === 'preview_ready' && (
            <>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  Plan hash’i ve yukarıdaki D hücresi değişikliklerini
                  inceledim; fiziksel yazımı onaylıyorum.
                </span>
              </label>
              <button
                className="button button--primary"
                type="button"
                disabled={applyBlocked}
                onClick={() => void approve()}
              >
                <LockKeyhole size={14} /> Onayla ve File Agent Job’ını Başlat
              </button>
            </>
          )}
          {operation.status === 'completed' && (
            <p className="allocation-panel__notice">
              <CheckCircle2 size={14} /> Yazım tamamlandı. Yedek:
              {' '}{operation.backupReference ?? 'doğrulanamadı'}.
            </p>
          )}
          {['failed', 'control_required'].includes(operation.status) && (
            <p className="allocation-panel__error" role="alert">
              <AlertTriangle size={14} /> Fiziksel yazım kapalı kaldı:
              {' '}{operation.safeErrorCode ?? operation.status}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
