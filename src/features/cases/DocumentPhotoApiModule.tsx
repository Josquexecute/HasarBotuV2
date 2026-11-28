import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash2, FileQuestion, RefreshCw, ShieldAlert } from 'lucide-react'
import { useCaseDocuments } from '../../data/useCaseDocuments'
import type { CaseDocumentWorkspaceRecord, DataSourceKind, DocumentPhysicalStatus, DocumentRequirementRecord, DocumentRequirementStatus } from '../../data/ports'
import { DOCUMENT_LABELS } from './document-labels'

const REQUIREMENT_STATUS: Readonly<Record<DocumentRequirementStatus, { label: string; className: string }>> = {
  present: { label: 'Mevcut', className: 'status-pill--open' },
  missing: { label: 'Eksik', className: 'status-pill--late' },
  control_required: { label: 'Kontrol gerekli', className: 'status-pill--review' },
  not_applicable: { label: 'Uygulanmaz', className: 'status-pill--waiting' },
  required: { label: 'Zorunlu', className: 'status-pill--late' },
}

const PHYSICAL_STATUS: Readonly<Record<DocumentPhysicalStatus, { label: string; className: string }>> = {
  ready: { label: 'Fiziksel doğrulandı', className: 'status-pill--open' },
  pending: { label: 'Doğrulama bekliyor', className: 'status-pill--review' },
  failed: { label: 'Doğrulama başarısız', className: 'status-pill--late' },
  missing: { label: 'Fiziksel dosya yok', className: 'status-pill--waiting' },
}

type RequirementGroup = 'base' | 'incident' | 'recourse'

function groupForRequirement(requirement: DocumentRequirementRecord): RequirementGroup {
  if (requirement.requirementCode.startsWith('recourse_') || requirement.sourceRule.includes('recourse')) return 'recourse'
  if (['accident_report', 'ktt', 'statement', 'tramer_result'].includes(requirement.requirementCode)) return 'incident'
  return 'base'
}

function groupHeading(group: RequirementGroup, data: CaseDocumentWorkspaceRecord): string {
  if (group === 'recourse') return 'Rüculu Kasko Evrakları'
  if (group === 'incident') return 'Olay Belgeleri ve Tramer'
  return data.caseType === 'traffic' ? 'Trafik Temel Evrakları' : 'Kasko Temel Evrakları'
}

function statusIcon(status: DocumentRequirementStatus) {
  if (status === 'present') return <CheckCircle2 size={15} aria-hidden="true" />
  if (status === 'not_applicable') return <CircleSlash2 size={15} aria-hidden="true" />
  if (status === 'control_required') return <ShieldAlert size={15} aria-hidden="true" />
  return <AlertTriangle size={15} aria-hidden="true" />
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function RequirementRow({ requirement }: { requirement: DocumentRequirementRecord }) {
  const status = REQUIREMENT_STATUS[requirement.status]
  return (
    <li className={`requirement-row requirement-row--${requirement.status}`}>
      <div className="requirement-row__title">
        {statusIcon(requirement.status)}
        <strong>{DOCUMENT_LABELS[requirement.canonicalDocumentType] ?? requirement.canonicalDocumentType}</strong>
        <span className={`status-pill ${status.className}`}>{status.label}</span>
      </div>
      <p>{requirement.reason}</p>
      {requirement.relatedDocumentStatuses.length > 0 && (
        <div className="requirement-row__physical" aria-label="İlişkili fiziksel doğrulama durumları">
          {requirement.relatedDocumentStatuses.map((related) => {
            const physical = PHYSICAL_STATUS[related.status]
            return <span className={`status-pill ${physical.className}`} key={related.documentId}>{physical.label}</span>
          })}
        </div>
      )}
    </li>
  )
}

function RequirementsPanel({ data }: { data: CaseDocumentWorkspaceRecord }) {
  const groups: readonly RequirementGroup[] = ['base', 'incident', 'recourse']
  return (
    <section className="document-checklist document-checklist--api">
      <header>
        <div><h2>Koşullu Evrak Kontrolü</h2><span>{data.caseType === 'traffic' ? 'Trafik' : 'Kasko'} · kural {data.ruleSetVersion}</span></div>
        <div className="requirement-counts" aria-label="Evrak değerlendirme özeti">
          <span className="status-pill status-pill--late">{data.missingCount} eksik</span>
          <span className="status-pill status-pill--review">{data.controlRequiredCount} kontrol</span>
        </div>
      </header>
      <div className="requirement-groups">
        {groups.map((group) => {
          const requirements = data.requirements.filter((requirement) => groupForRequirement(requirement) === group)
          if (requirements.length === 0) return null
          const alternativeGroups = data.alternativeGroups.filter((alternative) => (
            group === 'recourse' ? alternative.groupCode.startsWith('recourse_') : group === 'incident' && !alternative.groupCode.startsWith('recourse_')
          ))
          return (
            <section className="requirement-group" key={group}>
              <h3>{groupHeading(group, data)}</h3>
              {alternativeGroups.map((alternative) => {
                const status = REQUIREMENT_STATUS[alternative.status]
                return (
                  <div className="alternative-rule" key={alternative.groupCode}>
                    <span className={`status-pill ${status.className}`}>{alternative.operator === 'any_of' ? 'En az biri' : alternative.operator}</span>
                    <p>{alternative.reason}</p>
                  </div>
                )
              })}
              <ul>{requirements.map((requirement) => <RequirementRow requirement={requirement} key={requirement.requirementCode} />)}</ul>
            </section>
          )
        })}
      </div>
    </section>
  )
}

function VerificationBadge({ status }: { status: DocumentPhysicalStatus }) {
  const physical = PHYSICAL_STATUS[status]
  return <span className={`status-pill ${physical.className}`}>{physical.label}</span>
}

function MetadataPanel({ data }: { data: CaseDocumentWorkspaceRecord }) {
  return (
    <section className="metadata-library">
      <header><h2>Belge Sürümleri</h2><strong>{data.documents.length}</strong></header>
      {data.documents.length === 0 ? <div className="metadata-empty"><FileQuestion size={18} /><span>Kayıtlı belge sürümü yok.</span></div> : (
        <div className="table-scroll metadata-table-scroll">
          <table className="data-table metadata-table">
            <thead><tr><th>Belge / Dosya</th><th>Sürüm</th><th>MIME / Boyut</th><th>Doğrulama</th><th>Göreli Konum</th></tr></thead>
            <tbody>{data.documents.map((document) => (
              <tr key={document.id}>
                <td><strong>{DOCUMENT_LABELS[document.documentType] ?? document.documentType}</strong><small>{document.displayName} · {document.originalFileName}</small></td>
                <td className="mono">v{document.versionNumber}</td>
                <td><span>{document.mimeType}</span><small>{formatBytes(document.byteSize)}</small></td>
                <td><VerificationBadge status={document.status} /></td>
                <td className="mono metadata-path" title={document.relativePath}>{document.relativePath}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ModuleState({ kind, onRetry }: { kind: 'loading' | 'empty' | 'unauthorized' | 'not_found' | 'unavailable'; onRetry: () => void }) {
  const content = {
    loading: ['Evraklar yükleniyor…', ''],
    empty: ['Evrak kaydı yok', ''],
    unauthorized: ['Oturum gerekli', 'Gerçek evrak verisini görmek için yeniden giriş yapın.'],
    not_found: ['Dosya bulunamadı', 'Dosya yok veya bu organizasyonun erişim alanında değil.'],
    unavailable: ['Bağlantı kurulamadı', 'Evrak servisine erişilemiyor. Bağlantıyı kontrol edip yeniden deneyin.'],
  } as const
  return (
    <div className="document-module-state" role={kind === 'loading' ? 'status' : 'alert'}>
      {kind === 'loading' ? <RefreshCw className="state-view__spinner" aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
      <strong>{content[kind][0]}</strong>{content[kind][1] && <span>{content[kind][1]}</span>}
      {kind === 'unavailable' && <button className="button button--secondary" type="button" onClick={onRetry}><RefreshCw size={14} /> Yeniden dene</button>}
    </div>
  )
}

export function CaseDocumentsModule({ caseId, source }: { caseId: string; source: DataSourceKind }) {
  const { data, status, retry } = useCaseDocuments(caseId, source, true, undefined, { includePhotos: false })
  useEffect(() => {
    window.addEventListener('tracking-updated', retry)
    window.addEventListener('tracking-received', retry)
    return () => {
      window.removeEventListener('tracking-updated', retry)
      window.removeEventListener('tracking-received', retry)
    }
  }, [retry])
  if (status === 'ok' && data !== null) return <div className="case-document-workspace"><RequirementsPanel data={data} /><MetadataPanel data={data} /></div>
  const state = status === 'idle' || status === 'ok' ? 'loading' : status
  return <ModuleState kind={state} onRetry={retry} />
}
