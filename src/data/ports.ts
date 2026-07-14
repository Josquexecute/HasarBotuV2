import type { CaseRecord } from '../types/case'

/**
 * DataPort siniri (Paket 08): Feature UI yalniz bu arayuzu tuketir.
 * MockDataAdapter varsayilan ve guvenli fallback'tir; HttpApiAdapter
 * salt okunur Cases API'sine baglanir. UI davranisi degismez.
 */
export interface CasesDataPort {
  listCases(): Promise<readonly CaseRecord[]>
}

export interface NamedReferenceRecord {
  readonly id: string
  readonly name: string
}

export interface UserReferenceRecord {
  readonly id: string
  readonly displayName: string
}

export interface ServiceReferenceRecord extends NamedReferenceRecord {
  readonly centerType: 'yetkili' | 'ozel'
}

export interface CaseReferenceWorkspace {
  readonly insurers: readonly NamedReferenceRecord[]
  readonly services: readonly ServiceReferenceRecord[]
  readonly users: readonly UserReferenceRecord[]
  readonly experts: readonly UserReferenceRecord[]
}

export interface CaseReferenceDataPort {
  getCaseReferences(): Promise<CaseReferenceWorkspace>
}

export type DocumentPhysicalStatus = 'pending' | 'ready' | 'failed' | 'missing'
export type DocumentRequirementStatus = 'required' | 'present' | 'missing' | 'not_applicable' | 'control_required'

export interface RelatedDocumentStatus {
  readonly documentId: string
  readonly status: DocumentPhysicalStatus
}

export interface DocumentRequirementRecord {
  readonly requirementCode: string
  readonly canonicalDocumentType: string
  readonly status: DocumentRequirementStatus
  readonly reason: string
  readonly ruleVersion: string
  readonly sourceRule: string
  readonly matchedDocumentIds: readonly string[]
  readonly relatedDocumentStatuses: readonly RelatedDocumentStatus[]
  readonly evaluatedAt: string
  readonly requiresHumanReview: boolean
}

export interface AlternativeDocumentGroupRecord {
  readonly groupCode: string
  readonly operator: 'all_of' | 'any_of' | 'exactly_one'
  readonly status: DocumentRequirementStatus
  readonly reason: string
  readonly memberRequirementCodes: readonly string[]
  readonly matchedDocumentIds: readonly string[]
  readonly requiresHumanReview: boolean
}

export interface DocumentVersionMetadataRecord {
  readonly id: string
  readonly documentId: string
  readonly documentType: string
  readonly versionNumber: number
  readonly originalFileName: string
  readonly displayName: string
  readonly mimeType: string
  readonly byteSize: number
  readonly relativePath: string
  readonly status: DocumentPhysicalStatus
  readonly hashVerified: boolean
  readonly sizeVerified: boolean
  readonly verifiedAt: string | null
}

export interface PhotoMetadataRecord {
  readonly id: string
  readonly originalFileName: string
  readonly displayName: string
  readonly mimeType: string
  readonly byteSize: number
  readonly relativePath: string
  readonly status: DocumentPhysicalStatus
  readonly hashVerified: boolean
  readonly sizeVerified: boolean
  readonly verifiedAt: string | null
}

export interface CaseDocumentWorkspaceRecord {
  readonly caseId: string
  readonly caseType: 'traffic' | 'casco'
  readonly ruleSetVersion: string
  readonly overallStatus: DocumentRequirementStatus
  readonly requirements: readonly DocumentRequirementRecord[]
  readonly alternativeGroups: readonly AlternativeDocumentGroupRecord[]
  readonly missingCount: number
  readonly controlRequiredCount: number
  readonly evaluatedAt: string
  readonly documents: readonly DocumentVersionMetadataRecord[]
  readonly photos: readonly PhotoMetadataRecord[]
}

export interface CaseDocumentsDataPort {
  getCaseDocumentWorkspace(caseId: string): Promise<CaseDocumentWorkspaceRecord>
}

export type DataSourceKind = 'mock' | 'api'

/** localStorage acik secimi ortam varsayilanina baskindir; varsayilan yine mock'tur. */
export const DATA_SOURCE_STORAGE_KEY = 'hasarbotu-data-source'

export function getConfiguredDataSource(): DataSourceKind {
  try {
    const stored = window.localStorage.getItem(DATA_SOURCE_STORAGE_KEY)
    if (stored === 'api' || stored === 'mock') return stored
  } catch {
    // localStorage kapaliysa guvenli ortam varsayilanina gecilir.
  }
  return import.meta.env.VITE_DATA_SOURCE === 'api' ? 'api' : 'mock'
}
