import type {
  AlternativeDocumentGroupRecord,
  CaseDocumentsDataPort,
  CaseDocumentWorkspaceRecord,
  DocumentPhysicalStatus,
  DocumentRequirementRecord,
  DocumentRequirementStatus,
  DocumentVersionMetadataRecord,
  PhotoMetadataRecord,
} from './ports'

interface RequirementsDto {
  readonly caseId: string
  readonly caseType: 'traffic' | 'casco'
  readonly ruleSetVersion: string
  readonly overallStatus: DocumentRequirementStatus
  readonly requirements: readonly DocumentRequirementRecord[]
  readonly alternativeGroups: readonly AlternativeDocumentGroupRecord[]
  readonly missingCount: number
  readonly controlRequiredCount: number
  readonly evaluatedAt: string
}

export type HttpDocumentWorkspaceErrorKind = 'unauthorized' | 'not_found' | 'unavailable'

export class HttpDocumentWorkspaceError extends Error {
  readonly kind: HttpDocumentWorkspaceErrorKind

  constructor(kind: HttpDocumentWorkspaceErrorKind, message: string) {
    super(message)
    this.name = 'HttpDocumentWorkspaceError'
    this.kind = kind
  }
}

export interface HttpDocumentWorkspaceAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasArray(value: unknown, key: string): value is Record<string, unknown> {
  return isRecord(value) && Array.isArray(value[key])
}

function isPhysicalStatus(value: unknown): value is DocumentPhysicalStatus {
  return value === 'pending' || value === 'ready' || value === 'failed' || value === 'missing'
}

function isRequirementStatus(value: unknown): value is DocumentRequirementStatus {
  return value === 'required' || value === 'present' || value === 'missing' || value === 'not_applicable' || value === 'control_required'
}

/** API sozlesmesi goreli yol ister; savunmali olarak mutlak ve ust-dizin yollarini reddeder. */
export function isSafeMetadataRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith('/') || value.startsWith('\\')) return false
  if (/^[a-z]:[\\/]/i.test(value)) return false
  return !value.split(/[\\/]+/).some((segment) => segment === '..')
}

function ensureSafePath(value: unknown): string {
  if (typeof value !== 'string' || !isSafeMetadataRelativePath(value)) {
    throw new HttpDocumentWorkspaceError('unavailable', 'metadata API returned unsafe relative path')
  }
  return value
}

function ensureRequirements(value: unknown): RequirementsDto {
  if (!isRecord(value) || typeof value.caseId !== 'string' || (value.caseType !== 'traffic' && value.caseType !== 'casco')
    || typeof value.ruleSetVersion !== 'string' || !Array.isArray(value.requirements) || !Array.isArray(value.alternativeGroups)
    || !isRequirementStatus(value.overallStatus) || typeof value.missingCount !== 'number'
    || typeof value.controlRequiredCount !== 'number' || typeof value.evaluatedAt !== 'string') {
    throw new HttpDocumentWorkspaceError('unavailable', 'document requirements response is invalid')
  }
  for (const requirement of value.requirements) {
    if (!isRecord(requirement) || typeof requirement.requirementCode !== 'string' || typeof requirement.canonicalDocumentType !== 'string'
      || !isRequirementStatus(requirement.status) || typeof requirement.reason !== 'string' || typeof requirement.ruleVersion !== 'string'
      || typeof requirement.sourceRule !== 'string' || !Array.isArray(requirement.matchedDocumentIds)
      || !Array.isArray(requirement.relatedDocumentStatuses) || typeof requirement.evaluatedAt !== 'string'
      || typeof requirement.requiresHumanReview !== 'boolean'
      || requirement.relatedDocumentStatuses.some((related) => !isRecord(related) || typeof related.documentId !== 'string' || !isPhysicalStatus(related.status))) {
      throw new HttpDocumentWorkspaceError('unavailable', 'document requirement item is invalid')
    }
  }
  for (const group of value.alternativeGroups) {
    if (!isRecord(group) || typeof group.groupCode !== 'string' || !['all_of', 'any_of', 'exactly_one'].includes(String(group.operator))
      || !isRequirementStatus(group.status) || typeof group.reason !== 'string' || !Array.isArray(group.memberRequirementCodes)
      || !Array.isArray(group.matchedDocumentIds) || typeof group.requiresHumanReview !== 'boolean') {
      throw new HttpDocumentWorkspaceError('unavailable', 'alternative document group is invalid')
    }
  }
  return value as unknown as RequirementsDto
}

function mapDocumentVersions(value: unknown): readonly DocumentVersionMetadataRecord[] {
  if (!isRecord(value) || !isRecord(value.document) || typeof value.document.documentType !== 'string' || !Array.isArray(value.document.versions)) {
    throw new HttpDocumentWorkspaceError('unavailable', 'document detail response is invalid')
  }
  const documentType = value.document.documentType
  return (value.document.versions as readonly unknown[]).map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.documentId !== 'string'
      || typeof candidate.versionNumber !== 'number' || typeof candidate.originalFileName !== 'string'
      || typeof candidate.displayName !== 'string' || typeof candidate.mimeType !== 'string'
      || typeof candidate.byteSize !== 'number' || !isPhysicalStatus(candidate.status)) {
      throw new HttpDocumentWorkspaceError('unavailable', 'document version response is invalid')
    }
    if (candidate.status === 'ready' && (candidate.hashVerified !== true || candidate.sizeVerified !== true || typeof candidate.verifiedAt !== 'string')) {
      throw new HttpDocumentWorkspaceError('unavailable', 'ready document version is not physically verified')
    }
    return {
      id: candidate.id,
      documentId: candidate.documentId,
      documentType,
      versionNumber: candidate.versionNumber,
      originalFileName: candidate.originalFileName,
      displayName: candidate.displayName,
      mimeType: candidate.mimeType,
      byteSize: candidate.byteSize,
      relativePath: ensureSafePath(candidate.relativePath),
      status: candidate.status,
      hashVerified: candidate.hashVerified === true,
      sizeVerified: candidate.sizeVerified === true,
      verifiedAt: typeof candidate.verifiedAt === 'string' ? candidate.verifiedAt : null,
    }
  })
}

function mapPhotos(items: readonly unknown[]): readonly PhotoMetadataRecord[] {
  return items.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.originalFileName !== 'string'
      || typeof candidate.displayName !== 'string' || typeof candidate.mimeType !== 'string'
      || typeof candidate.byteSize !== 'number' || !isPhysicalStatus(candidate.status)) {
      throw new HttpDocumentWorkspaceError('unavailable', 'photo metadata response is invalid')
    }
    if (candidate.status === 'ready' && (candidate.hashVerified !== true || candidate.sizeVerified !== true || typeof candidate.verifiedAt !== 'string')) {
      throw new HttpDocumentWorkspaceError('unavailable', 'ready photo metadata is not physically verified')
    }
    return {
      id: candidate.id,
      originalFileName: candidate.originalFileName,
      displayName: candidate.displayName,
      mimeType: candidate.mimeType,
      byteSize: candidate.byteSize,
      relativePath: ensureSafePath(candidate.relativePath),
      status: candidate.status,
      hashVerified: candidate.hashVerified === true,
      sizeVerified: candidate.sizeVerified === true,
      verifiedAt: typeof candidate.verifiedAt === 'string' ? candidate.verifiedAt : null,
    }
  })
}

export function createHttpDocumentWorkspaceAdapter(options: HttpDocumentWorkspaceAdapterOptions = {}): CaseDocumentsDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = { accept: 'application/json', ...(options.headers ?? {}) }

  const requestJson = async (path: string): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { credentials: 'include', headers })
    } catch {
      throw new HttpDocumentWorkspaceError('unavailable', 'document metadata API unreachable')
    }
    if (response.status === 401) throw new HttpDocumentWorkspaceError('unauthorized', `document metadata API HTTP ${response.status}`)
    if (response.status === 404) throw new HttpDocumentWorkspaceError('not_found', `document metadata API HTTP ${response.status}`)
    if (!response.ok) throw new HttpDocumentWorkspaceError('unavailable', `document metadata API HTTP ${response.status}`)
    try {
      return await response.json()
    } catch {
      throw new HttpDocumentWorkspaceError('unavailable', 'document metadata API returned invalid JSON')
    }
  }

  const requestAllPages = async (path: string, label: string): Promise<readonly unknown[]> => {
    const items: unknown[] = []
    let page = 1
    while (true) {
      const value = await requestJson(`${path}?page=${page}&pageSize=100`)
      if (!hasArray(value, 'items') || !isRecord(value.pageInfo) || value.pageInfo.page !== page
        || typeof value.pageInfo.totalPages !== 'number' || !Number.isInteger(value.pageInfo.totalPages)
        || value.pageInfo.totalPages < 0 || value.pageInfo.totalPages > 10_000) {
        throw new HttpDocumentWorkspaceError('unavailable', `${label} pagination response is invalid`)
      }
      items.push(...value.items as readonly unknown[])
      if (page >= value.pageInfo.totalPages) return items
      page += 1
    }
  }

  return {
    async getCaseDocumentWorkspace(caseId: string): Promise<CaseDocumentWorkspaceRecord> {
      const encodedCaseId = encodeURIComponent(caseId)
      const [requirementsValue, documentItems, photoItems] = await Promise.all([
        requestJson(`/api/v1/cases/${encodedCaseId}/document-requirements`),
        requestAllPages(`/api/v1/cases/${encodedCaseId}/documents`, 'documents'),
        requestAllPages(`/api/v1/cases/${encodedCaseId}/photos`, 'photos'),
      ])
      const requirements = ensureRequirements(requirementsValue)
      const details = await Promise.all(documentItems.map(async (candidate) => {
        if (!isRecord(candidate) || typeof candidate.id !== 'string') {
          throw new HttpDocumentWorkspaceError('unavailable', 'document list response is invalid')
        }
        return requestJson(`/api/v1/documents/${encodeURIComponent(candidate.id)}`)
      }))
      const documents = details.flatMap(mapDocumentVersions).sort((left, right) => (
        left.documentType.localeCompare(right.documentType, 'tr') || right.versionNumber - left.versionNumber || left.id.localeCompare(right.id)
      ))
      const photos = [...mapPhotos(photoItems)].sort((left, right) => left.displayName.localeCompare(right.displayName, 'tr') || left.id.localeCompare(right.id))
      return { ...requirements, documents, photos }
    },
  }
}
