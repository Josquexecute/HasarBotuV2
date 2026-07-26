import { CircleAlert, FileWarning, HelpCircle } from 'lucide-react'
import type { OperationalAlertCaseSummaryRecord } from '../../data/operationalAlertPort'
/**
 * Dosya satırı operasyonel uyarı göstergesi (Paket 52).
 *
 * `summary === undefined` "gösterge yüklenemedi/kapsam dışı" demektir ve
 * ASLA "uyarı yok" olarak gösterilmez. Uyarısı olmayan satırda dikkat çekici
 * rozet yerine sessiz bir işaret kullanılır.
 */
export function CaseRowAlertBadge({
  summary,
  plate,
  onOpen,
}: {
  readonly summary: OperationalAlertCaseSummaryRecord | undefined
  readonly plate: string
  readonly onOpen: () => void
}) {
  if (summary === undefined) {
    return (
      <span className="row-alert row-alert--unknown" title="Uyarı göstergesi yüklenemedi">
        <HelpCircle size={13} aria-hidden="true" />
        <span className="sr-only">{plate} uyarı durumu bilinmiyor</span>
      </span>
    )
  }

  if (summary.totalCount === 0) {
    return (
      <span className="row-alert row-alert--clear" title="Açık operasyonel uyarı yok">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{plate} için açık operasyonel uyarı yok</span>
      </span>
    )
  }

  const parts: string[] = []
  if (summary.byType.overdue_task > 0) parts.push(`${summary.byType.overdue_task} geciken görev`)
  if (summary.byType.overdue_follow_up > 0) parts.push(`${summary.byType.overdue_follow_up} geciken takip`)
  if (summary.byType.missing_required_document > 0) {
    parts.push(`${summary.byType.missing_required_document} eksik evrak`)
  }
  const detail = parts.join(' · ')

  return (
    <button
      className="row-alert row-alert--active"
      type="button"
      onClick={(event) => { event.stopPropagation(); onOpen() }}
      aria-label={`${plate}: ${summary.totalCount} operasyonel uyarı. ${detail}. Dosyayı aç.`}
      title={detail}
    >
      {summary.byType.missing_required_document > 0
        ? <FileWarning size={13} aria-hidden="true" />
        : <CircleAlert size={13} aria-hidden="true" />}
      <strong>{summary.totalCount}</strong>
      <small>{detail}</small>
    </button>
  )
}
