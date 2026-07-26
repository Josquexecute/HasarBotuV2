import { AlertTriangle, CheckCircle2, CircleSlash2, FileQuestion, RefreshCw, ShieldAlert } from 'lucide-react'
import { useCaseDocuments } from '../../data/useCaseDocuments'
import type { CaseDocumentWorkspaceRecord, DataSourceKind, DocumentPhysicalStatus, DocumentRequirementRecord, DocumentRequirementStatus } from '../../data/ports'
const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  victim_traffic_policy: 'Mağdur trafik poliçesi',
  insured_traffic_policy: 'Sigortalı trafik poliçesi',
  sbm_heavy_damage_result: 'SBM Ağır Hasar sonucu',
  victim_registration: 'Mağdur ruhsat',
  insured_registration: 'Sigortalı ruhsat',
  victim_driver_license: 'Mağdur ehliyet',
  insured_driver_license: 'Sigortalı ehliyet',
  casco_policy: 'Kasko poliçesi',
  casco_vehicle_registration: 'Kasko aracı ruhsatı',
  casco_driver_license: 'Kasko aracı sürücü ehliyeti',
  accident_report: 'Zabıt',
  ktt: 'KTT',
  statement: 'Beyan',
  tramer_result: 'Tramer sonucu',
  opposing_vehicle_registration: 'Karşı araç ruhsatı',
  opposing_driver_license: 'Karşı araç sürücü ehliyeti',
  opposing_traffic_policy: 'Karşı araç trafik poliçesi',
  fault_ratio: 'Kusur oranı',
}

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
    <section className="photo-library metadata-library">
      <header><div><h2>Belge ve Fotoğraf Metadata</h2><span>Yalnız güvenli göreli konum · içerik gösterilmez</span></div><strong>{data.documents.length + data.photos.length}</strong></header>
      <div className="metadata-sections">
        <section className="metadata-section" aria-labelledby="document-metadata-heading">
          <div className="metadata-section__heading"><h3 id="document-metadata-heading">Belge Sürümleri</h3><span>{data.documents.length} sürüm</span></div>
          {data.documents.length === 0 ? <div className="metadata-empty"><FileQuestion size={18} /><span>Kayıtlı belge metadata’sı yok.</span></div> : (
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
        <section className="metadata-section" aria-labelledby="photo-metadata-heading">
          <div className="metadata-section__heading"><h3 id="photo-metadata-heading">Fotoğraf Metadata</h3><span>{data.photos.length} fotoğraf</span></div>
          {data.photos.length === 0 ? <div className="metadata-empty"><FileQuestion size={18} /><span>Kayıtlı fotoğraf metadata’sı yok.</span></div> : (
            <div className="table-scroll metadata-table-scroll">
              <table className="data-table metadata-table">
                <thead><tr><th>Dosya</th><th>Sürüm</th><th>MIME / Boyut</th><th>Doğrulama</th><th>Göreli Konum</th></tr></thead>
                <tbody>{data.photos.map((photo) => (
                  <tr key={photo.id}>
                    <td><strong>{photo.displayName}</strong><small>{photo.originalFileName}</small></td>
                    <td>—</td>
                    <td><span>{photo.mimeType}</span><small>{formatBytes(photo.byteSize)}</small></td>
                    <td><VerificationBadge status={photo.status} /></td>
                    <td className="mono metadata-path" title={photo.relativePath}>{photo.relativePath}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

function ModuleState({ kind, onRetry }: { kind: 'loading' | 'empty' | 'unauthorized' | 'not_found' | 'unavailable'; onRetry: () => void }) {
  const content = {
    loading: ['Evrak ve fotoğraf verileri yükleniyor…', 'Kural değerlendirmesi ve güvenli metadata okunuyor.'],
    empty: ['Evrak veya fotoğraf kaydı yok', 'Bu dosyada henüz kural sonucu ya da metadata bulunmuyor.'],
    unauthorized: ['Oturum gerekli', 'Gerçek evrak verisini görmek için yeniden giriş yapın.'],
    not_found: ['Dosya bulunamadı', 'Dosya yok veya bu organizasyonun erişim alanında değil.'],
    unavailable: ['Bağlantı kurulamadı', 'Evrak servisine erişilemiyor. Bağlantıyı kontrol edip yeniden deneyin.'],
  } as const
  return (
    <div className="document-module-state" role={kind === 'loading' ? 'status' : 'alert'}>
      {kind === 'loading' ? <RefreshCw className="state-view__spinner" aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
      <strong>{content[kind][0]}</strong><span>{content[kind][1]}</span>
      {kind === 'unavailable' && <button className="button button--secondary" type="button" onClick={onRetry}><RefreshCw size={14} /> Yeniden dene</button>}
    </div>
  )
}

export function DocumentPhotoApiModule({ caseId, source }: { caseId: string; source: DataSourceKind }) {
  const { data, status, retry } = useCaseDocuments(caseId, source, true)
  if (status === 'ok' && data !== null) return <div className="document-photo-workspace document-photo-workspace--api"><RequirementsPanel data={data} /><MetadataPanel data={data} /></div>
  const state = status === 'idle' || status === 'ok' ? 'loading' : status
  return <ModuleState kind={state} onRetry={retry} />
}
