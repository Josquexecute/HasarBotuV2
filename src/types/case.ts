export type CaseType = 'Trafik' | 'Kasko'

export type CaseStage =
  | 'Yeni İhbar'
  | 'Araç / Servis Bekleniyor'
  | 'Ekspertiz Bekliyor'
  | 'Hasar Tespiti'
  | 'Parça ve İşçilik'
  | 'Onarım Onayı Bekleniyor'
  | 'Onarımda'
  | 'Raporlama'
  | 'Kapanış Evrakları'
  | 'Kapanmaya Hazır'

export type CaseStatus = 'Açık' | 'Beklemede' | 'Gecikmiş' | 'Kontrol Bekliyor'

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
