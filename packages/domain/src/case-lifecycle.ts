import { TURKISH_MONTH_NAMES } from './case-workspace.js'
import { OPEN_CASE_STAGES, type OpenCaseStage } from './case-status.js'
import { parseRelativePath } from './storage-path.js'
import type { ServiceEligibilityEvaluation } from './service-agreement.js'

export const CASE_LIFECYCLE_OPERATION_TYPES = ['close', 'reopen'] as const
export type CaseLifecycleOperationType = (typeof CASE_LIFECYCLE_OPERATION_TYPES)[number]

export const CASE_LIFECYCLE_OPERATION_STATUSES = [
  'planned',
  'blocked',
  'approval_required',
  'approved',
  'queued',
  'moving',
  'verifying',
  'finalizing',
  'closed',
  'reopened',
  'failed',
  'stale',
  'cancelled',
  'cleanup_pending',
  'manual_recovery_required',
] as const
export type CaseLifecycleOperationStatus = (typeof CASE_LIFECYCLE_OPERATION_STATUSES)[number]

export const CLOSURE_MODES = ['normal', 'with_missing_requirements'] as const
export type ClosureMode = (typeof CLOSURE_MODES)[number]

export const CLOSURE_REQUIREMENT_STATUSES = ['present', 'missing', 'control_required', 'not_applicable'] as const
export type ClosureRequirementStatus = (typeof CLOSURE_REQUIREMENT_STATUSES)[number]

export interface ClosureMetadataCandidate {
  readonly id: string
  readonly canonicalType: string
  readonly status: 'pending' | 'ready' | 'failed' | 'missing'
  readonly hashVerified: boolean
  readonly sizeVerified: boolean
  readonly verifiedAt: string | null
}

export interface ClosureRequirementResult {
  readonly requirementCode: string
  readonly sourceType: 'document' | 'photo'
  readonly canonicalType: string
  readonly status: ClosureRequirementStatus
  readonly reason: string
  readonly matchedMetadataIds: readonly string[]
  readonly relatedMetadataStatuses: readonly { readonly metadataId: string; readonly status: ClosureMetadataCandidate['status'] }[]
  readonly requiresHumanReview: boolean
}

export interface ClosureRequirementsEvaluation {
  readonly version: '2026.07.14.2'
  readonly requirements: readonly ClosureRequirementResult[]
  readonly missingCount: number
  readonly controlRequiredCount: number
}

function evaluateCandidate(
  requirementCode: string,
  sourceType: 'document' | 'photo',
  canonicalType: string,
  candidates: readonly ClosureMetadataCandidate[],
  applicable: boolean,
  notApplicableReason: string,
): ClosureRequirementResult {
  if (!applicable) {
    return {
      requirementCode,
      sourceType,
      canonicalType,
      status: 'not_applicable',
      reason: notApplicableReason,
      matchedMetadataIds: [],
      relatedMetadataStatuses: [],
      requiresHumanReview: false,
    }
  }
  const ordered = [...candidates].sort((left, right) => left.id.localeCompare(right.id))
  const ready = ordered.filter((item) => item.status === 'ready' && item.hashVerified && item.sizeVerified && item.verifiedAt !== null)
  const relatedMetadataStatuses = ordered.map((item) => ({ metadataId: item.id, status: item.status }))
  if (ready.length > 0) {
    return {
      requirementCode,
      sourceType,
      canonicalType,
      status: 'present',
      reason: 'En az bir fiziksel olarak dogrulanmis ready metadata adayi bulundu.',
      matchedMetadataIds: ready.map((item) => item.id),
      relatedMetadataStatuses,
      requiresHumanReview: false,
    }
  }
  if (ordered.some((item) => item.status === 'pending' || item.status === 'failed' || item.status === 'ready')) {
    return {
      requirementCode,
      sourceType,
      canonicalType,
      status: 'control_required',
      reason: 'Metadata kaydi var ancak fiziksel dogrulama tamamlanmamis veya basarisiz.',
      matchedMetadataIds: [],
      relatedMetadataStatuses,
      requiresHumanReview: true,
    }
  }
  return {
    requirementCode,
    sourceType,
    canonicalType,
    status: 'missing',
    reason: 'Gecerli metadata adayi bulunamadi.',
    matchedMetadataIds: [],
    relatedMetadataStatuses,
    requiresHumanReview: false,
  }
}

/** Kapanisa ozel, yalniz dogrulanmis metadata kullanan saf degerlendirme katmani. */
export function evaluateClosureRequirements(input: {
  readonly documents: readonly ClosureMetadataCandidate[]
  readonly repairPhotos: readonly ClosureMetadataCandidate[]
  readonly hasService: boolean
  readonly serviceEligibility: ServiceEligibilityEvaluation | null
}): ClosureRequirementsEvaluation {
  const docs = (type: string): readonly ClosureMetadataCandidate[] => input.documents.filter((item) => item.canonicalType === type)
  const requirements = [
    evaluateCandidate('closure.expert_report', 'document', 'expert_report', docs('expert_report'), true, ''),
    evaluateCandidate('closure.preliminary_report', 'document', 'preliminary_report', docs('preliminary_report'), true, ''),
    evaluateCandidate('closure.repair_photos', 'photo', 'repair_photos', input.repairPhotos, true, ''),
    evaluateCandidate('closure.invoice', 'document', 'invoice', docs('invoice'), input.hasService, 'Servis atanmamis; fatura uygulanamaz.'),
    evaluateServiceConditionalCandidate('closure.delivery_release_assignment', 'delivery_release_assignment', docs('delivery_release_assignment'), input),
    evaluateServiceConditionalCandidate('closure.commitment', 'commitment', docs('commitment'), input),
  ] as const
  return {
    version: '2026.07.14.2',
    requirements,
    missingCount: requirements.filter((item) => item.status === 'missing').length,
    controlRequiredCount: requirements.filter((item) => item.status === 'control_required').length,
  }
}

function evaluateServiceConditionalCandidate(
  requirementCode: string,
  canonicalType: string,
  candidates: readonly ClosureMetadataCandidate[],
  input: { readonly hasService: boolean; readonly serviceEligibility: ServiceEligibilityEvaluation | null },
): ClosureRequirementResult {
  if (!input.hasService) {
    return evaluateCandidate(requirementCode, 'document', canonicalType, candidates, false, 'Servis atanmamis; kosullu kapanis evraki uygulanamaz.')
  }
  if (input.serviceEligibility === null || input.serviceEligibility.status === 'control_required') {
    return {
      requirementCode,
      sourceType: 'document',
      canonicalType,
      status: 'control_required',
      reason: input.serviceEligibility?.reason ?? 'Servis profili veya sigortaci anlasmasi dogrulanamadi.',
      matchedMetadataIds: [],
      relatedMetadataStatuses: [...candidates]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((item) => ({ metadataId: item.id, status: item.status })),
      requiresHumanReview: true,
    }
  }
  return evaluateCandidate(
    requirementCode,
    'document',
    canonicalType,
    candidates,
    input.serviceEligibility.status === 'eligible',
    `Servis bu sigortaci ve tarih icin kosulu karsilamiyor. ${input.serviceEligibility.reason}`,
  )
}

export type ClosedWorkspacePathResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly code: 'notification_date_required' | 'location_date_mismatch' | 'invalid_open_location' }

/** Doğrulanmış yıl/ay klasöründe kapanış yolunu üretir; eski YYYY yolları da desteklenir. */
export function buildClosedCaseWorkspacePath(notificationDate: string | null, openRelativePath: string): ClosedWorkspacePathResult {
  if (notificationDate === null) return { ok: false, code: 'notification_date_required' }
  const parsed = parseRelativePath(openRelativePath)
  if (!parsed.ok) return { ok: false, code: 'invalid_open_location' }
  const [yearText, monthFolder, workspaceName, ...rest] = openRelativePath.split('/')
  if (yearText === undefined || monthFolder === undefined || workspaceName === undefined || rest.length > 0) {
    return { ok: false, code: 'invalid_open_location' }
  }
  const year = Number(notificationDate.slice(0, 4))
  const month = Number(notificationDate.slice(5, 7))
  const monthName = TURKISH_MONTH_NAMES[month - 1]
  if (monthName === undefined || (yearText !== String(year) && yearText !== `${year} OFİS`) || monthFolder !== `${monthName} ${year}`) {
    return { ok: false, code: 'location_date_mismatch' }
  }
  const closedFolder = yearText === `${year} OFİS` ? 'KAPALI DOSYALAR' : `KAPALI ${monthName.toLocaleUpperCase('tr-TR')} ${year}`
  return { ok: true, value: `${yearText}/${monthFolder}/${closedFolder}/${workspaceName}` }
}

/** Imported folders already have a verified calendar location; do not invent a claim notification date. */
export function buildClosedImportedCaseWorkspacePath(notificationDate: string | null, openRelativePath: string): ClosedWorkspacePathResult {
  if (!parseRelativePath(openRelativePath).ok) return { ok: false, code: 'invalid_open_location' }
  const parts = openRelativePath.split('/')
  if (parts.length < 3 || parts.length > 5) return { ok: false, code: 'invalid_open_location' }
  const upper = (value: string) => value.normalize('NFC').toLocaleUpperCase('tr-TR')
  const sameMonth = (folder: string, month: string, year: number) => upper(folder).replace(/\s+/gu, '') === upper(`${month}${year}`)
  const yearMatch = /^(\d{4})(?: OF[Iİ]S)?$/.exec(upper(parts[0]!))
  if (!yearMatch) return { ok: false, code: 'invalid_open_location' }
  const year = Number(yearMatch[1])
  if (year < 2000 || year > 2100) return { ok: false, code: 'invalid_open_location' }
  const closedIndex = parts.slice(0, -1).findIndex(part => /^KAPALI(?:\s|$)/u.test(upper(part)))
  if (closedIndex !== -1) {
    const month = TURKISH_MONTH_NAMES.find(name => sameMonth(parts[closedIndex - 1] ?? '', name, year))
    if (closedIndex !== parts.length - 2 || !month || !['KAPALI DOSYALAR', `KAPALI ${upper(month)} ${year}`].includes(upper(parts[closedIndex]!))) return { ok: false, code: 'invalid_open_location' }
    const open = parts.filter((_, index) => index !== closedIndex).join('/')
    if (!buildClosedImportedCaseWorkspacePath(notificationDate, open).ok) return { ok: false, code: 'invalid_open_location' }
    // A manually archived folder is verified in place after approval, never nested or moved again.
    return { ok: true, value: openRelativePath }
  }
  if (parts.length > 4) return { ok: false, code: 'invalid_open_location' }
  const closedFolder = (month: string) => yearMatch[0] === String(year) ? `KAPALI ${upper(month)} ${year}` : 'KAPALI DOSYALAR'
  const parent = parts.at(-2)!, workspaceName = parts.at(-1)!
  const month = TURKISH_MONTH_NAMES.find(name => sameMonth(parent, name, year))
  if (month) return { ok: true, value: `${parts.slice(0, -1).join('/')}/${closedFolder(month)}/${workspaceName}` }
  // A pending folder has no month of its own. An actual notification date is still required here.
  if (parts.length === 3 && upper(parent).replace(/^_/, '') === 'EKSİK DOSYALAR') {
    if (notificationDate === null) return { ok: false, code: 'notification_date_required' }
    const datedMonth = TURKISH_MONTH_NAMES[Number(notificationDate.slice(5, 7)) - 1]
    if (!datedMonth || Number(notificationDate.slice(0, 4)) !== year) return { ok: false, code: 'location_date_mismatch' }
    return { ok: true, value: `${parts[0]}/${datedMonth} ${year}/${closedFolder(datedMonth)}/${workspaceName}` }
  }
  return { ok: false, code: 'invalid_open_location' }
}

/** Recover the open month location when a close operation verified an already archived import in place. */
export function buildOpenImportedCaseWorkspacePath(closedRelativePath: string): ClosedWorkspacePathResult {
  const checked = buildClosedImportedCaseWorkspacePath(null, closedRelativePath)
  if (!checked.ok || checked.value !== closedRelativePath) return { ok: false, code: 'invalid_open_location' }
  const parts = closedRelativePath.split('/')
  return { ok: true, value: parts.filter((_, index) => index !== parts.length - 2).join('/') }
}

export function isOpenWorkflowStage(value: string): value is OpenCaseStage {
  return OPEN_CASE_STAGES.some((stage) => stage === value)
}
