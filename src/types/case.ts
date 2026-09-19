export type CaseType = 'Trafik' | 'Kasko'

export type CaseStage =
  | 'Yeni İhbar'
  | 'Araç / Servis Bekleniyor'
  | 'Ekspertiz Bekliyor'
  | 'Hasar Tespiti'
  | 'Onarım Takibi'
  | 'Onarım Onayı Bekleniyor'
  | 'Onarımda'
  | 'Raporlama'
  | 'Kapanış Evrakları'
  | 'Kapanmaya Hazır'
  | 'Kapalı'

export type CaseStatus = 'Açık' | 'Kapalı' | 'Beklemede' | 'Gecikmiş' | 'Kontrol Bekliyor'

export type CaseStageCode =
  | 'new_notification'
  | 'vehicle_or_service_pending'
  | 'inspection_pending'
  | 'damage_assessment'
  | 'parts_and_labor'
  | 'repair_approval_pending'
  | 'under_repair'
  | 'reporting'
  | 'closing_documents'
  | 'ready_to_close'
  | 'closed'

export interface CaseRecord {
  caseId: string
  plate: string
  officeNumber: string
  noticeNumber: string
  claimNumber: string
  company: string
  type: CaseType
  status: CaseStatus
  stage: CaseStage
  missingDocuments: number
  assignee: string
  expert: string
  service: string
  followUp: string
  followUpTone: 'normal' | 'today' | 'late'
  lastAction: string
  vehicle: string
  insured: string
  estimatedDamage: number
  notes: readonly string[]
  /** Gercek API komutlari icin wire metadata; mock kayitlarda bulunmaz. */
  version?: number
  workflowStage?: CaseStageCode
  responsibleUserId?: string | null
  expertUserId?: string | null
  serviceId?: string | null
  serviceProfile?: {
    readonly id: string
    readonly name: string
    readonly serviceType: 'authorized' | 'private' | 'glass' | 'mobile' | 'other'
    readonly isActive: boolean
    readonly agreement: {
      readonly status: 'eligible' | 'not_eligible' | 'control_required'
      readonly agreementStatus: 'agreed' | 'not_agreed' | 'control_required'
      readonly serviceType: 'authorized' | 'private' | 'glass' | 'mobile' | 'other'
      readonly operation: 'closure_documents' | 'deductible_assessment' | 'policy_assessment' | 'repair_authorization'
      readonly evaluationDate: string | null
      readonly dateSource: 'loss_date' | 'policy_date'
      readonly isAuthorized: boolean
      readonly isInsurerAgreed: boolean | null
      readonly reason: string
      readonly ruleVersion: string
      readonly matchedAgreementIds: readonly string[]
      readonly requiresHumanReview: boolean
    }
  } | null
  insurerId?: string | null
  followUpDate?: string | null
  lossDate?: string | null
  notificationDate?: string | null
  lifecycleStatus?: 'open' | 'closed'
  /** V1 immutable provenance'dan gelen tarihsel adlar; aktif V2 ilişkisi değildir. */
  legacyReferences?: {
    readonly responsibleNames: readonly string[]
    readonly expertNames: readonly string[]
    readonly serviceNames: readonly string[]
  }
}

export type SortKey =
  | 'plate'
  | 'officeNumber'
  | 'company'
  | 'type'
  | 'stage'
  | 'missingDocuments'
  | 'assignee'
  | 'followUp'
  | 'lastAction'
