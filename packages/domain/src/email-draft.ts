import type { CaseType } from './case-type.js'
import { DOCUMENT_REQUIREMENT_LABELS } from './document-requirements.js'

export const EMAIL_DRAFT_TEMPLATE_VERSION = 'email-draft-template/1.0.0' as const
export const EMAIL_DRAFT_TYPES = [
  'repair_approval_request',
  'missing_document_request',
  'preliminary_report_notice',
  'service_change_notice',
  'deductible_service_part_notice',
  'portal_deductible_note',
  'closure_documents_request',
  'case_status_update',
  'recourse_documents_request',
  'pert_evaluation_notice',
  'custom_instruction',
] as const
export type EmailDraftType = (typeof EMAIL_DRAFT_TYPES)[number]

export const EMAIL_DRAFT_SOURCE_TYPES = [
  'deterministic_template',
  'ai_assisted',
  'manual_revision',
] as const
export type EmailDraftSourceType = (typeof EMAIL_DRAFT_SOURCE_TYPES)[number]

export const EMAIL_HANDOFF_PROVIDERS = ['gmail_web'] as const
export type EmailHandoffProvider = (typeof EMAIL_HANDOFF_PROVIDERS)[number]

export const EMAIL_RECIPIENT_KINDS = ['to', 'cc'] as const
export type EmailRecipientKind = (typeof EMAIL_RECIPIENT_KINDS)[number]

export const MAX_EMAIL_DRAFT_SUBJECT_LENGTH = 240
export const MAX_EMAIL_DRAFT_BODY_LENGTH = 20_000
export const MAX_EMAIL_DRAFT_INSTRUCTION_LENGTH = 2_000
export const MAX_EMAIL_DRAFT_RECIPIENTS = 10
export const MAX_EMAIL_DRAFT_ATTACHMENTS = 20

export interface EmailDraftTemplateContext {
  readonly draftType: EmailDraftType
  readonly officeNumber: string
  readonly plate: string
  readonly caseType: CaseType
  readonly missingRequirementCodes?: readonly string[]
  readonly instruction?: string | null
}

export interface EmailDraftTemplate {
  readonly draftType: EmailDraftType
  readonly subject: string
  readonly body: string
  readonly templateVersion: typeof EMAIL_DRAFT_TEMPLATE_VERSION
  readonly sourceType: 'deterministic_template'
  readonly sourceRule: string
  readonly suggestedDocumentTypes: readonly string[]
  readonly requiresHumanReview: true
}

export interface EmailRecipientValidation {
  readonly valid: boolean
  readonly normalizedTo: readonly string[]
  readonly normalizedCc: readonly string[]
  readonly reasonCode:
    | 'ok'
    | 'to_required'
    | 'too_many_recipients'
    | 'invalid_address'
    | 'duplicate_address'
}

const TEMPLATE_DEFINITIONS: Readonly<Record<EmailDraftType, {
  readonly subject: (context: EmailDraftTemplateContext) => string
  readonly paragraphs: (context: EmailDraftTemplateContext) => readonly string[]
  readonly sourceRule: string
  readonly suggestedDocumentTypes: readonly string[]
}>> = {
  repair_approval_request: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Onarım Onayı Talebi`,
    paragraphs: () => ['İlgili dosya için onarım onayının iletilmesini rica ederiz.'],
    sourceRule: 'repair_approval_request',
    suggestedDocumentTypes: ['preliminary_report', 'damage_report'],
  },
  missing_document_request: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Eksik Evrak Talebi`,
    paragraphs: (context) => {
      const missing = [...(context.missingRequirementCodes ?? [])].sort((left, right) => left.localeCompare(right, 'tr'))
      return missing.length === 0
        ? ['Dosyanın evrak kontrolünde eksik veya kontrol gerektiren kayıtlar bulunmaktadır. Gerekli evrakların iletilmesini rica ederiz.']
        : [
            'Dosyanın evrak kontrolünde aşağıdaki kayıtlar eksik veya kontrol gerektirir durumdadır:',
            missing.map((code) => `- ${EMAIL_REQUIREMENT_LABELS[code] ?? code}`).join('\n'),
            'Gerekli evrakların iletilmesini rica ederiz.',
          ]
    },
    sourceRule: 'document_requirements_snapshot',
    suggestedDocumentTypes: [],
  },
  preliminary_report_notice: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Ön Rapor Bilgilendirmesi`,
    paragraphs: () => ['Dosyaya ilişkin ön rapor hazırlanmıştır. Bilginize sunarız.'],
    sourceRule: 'preliminary_report_notice',
    suggestedDocumentTypes: ['preliminary_report'],
  },
  service_change_notice: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Servis Değişikliği`,
    paragraphs: () => ['Dosyanın servis bilgisinde değişiklik planlanmaktadır. Güncel servis bilgisinin teyidini rica ederiz.'],
    sourceRule: 'service_change_notice',
    suggestedDocumentTypes: [],
  },
  deductible_service_part_notice: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Muafiyet ve Servis/Parça Koşulu`,
    paragraphs: () => [
      'Poliçe kapsamındaki muafiyet, tenzil ve servis/parça koşulları insan kontrolü gerektirmektedir.',
      'İşleme devam edilmeden önce koşulların teyidini rica ederiz.',
    ],
    sourceRule: 'policy_condition_notice',
    suggestedDocumentTypes: ['casco_policy'],
  },
  portal_deductible_note: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Portal Muafiyet Notu`,
    paragraphs: () => ['Portal kaydı için muafiyet/tenzil koşuluna ilişkin kontrollü taslak not hazırlanmıştır.'],
    sourceRule: 'portal_deductible_note',
    suggestedDocumentTypes: ['casco_policy'],
  },
  closure_documents_request: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Kapanış Evrakları Talebi`,
    paragraphs: () => ['Dosya kapanış kontrollerinin tamamlanabilmesi için gerekli kapanış evraklarının iletilmesini rica ederiz.'],
    sourceRule: 'closure_documents_request',
    suggestedDocumentTypes: ['preliminary_report', 'expert_report'],
  },
  case_status_update: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Dosya Durumu`,
    paragraphs: (context) => [`${context.caseType === 'traffic' ? 'Trafik' : 'Kasko'} dosyasının güncel durumu hakkında bilgilendirme taslağıdır.`],
    sourceRule: 'case_status_update',
    suggestedDocumentTypes: [],
  },
  recourse_documents_request: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Rücu Evrakları Talebi`,
    paragraphs: () => ['Rücu değerlendirmesinin tamamlanabilmesi için gerekli evrakların iletilmesini rica ederiz.'],
    sourceRule: 'recourse_documents_request',
    suggestedDocumentTypes: ['ktt', 'accident_report', 'tramer_result', 'fault_ratio'],
  },
  pert_evaluation_notice: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · PERT Değerlendirmesi`,
    paragraphs: () => ['Dosya PERT/ağır hasar değerlendirmesi için insan incelemesine alınmıştır. Değerlendirme kesin karar değildir.'],
    sourceRule: 'pert_evaluation_notice',
    suggestedDocumentTypes: ['sbm_heavy_damage_result', 'expert_report'],
  },
  custom_instruction: {
    subject: (context) => `${context.officeNumber} · ${context.plate} · Dosya Hakkında`,
    paragraphs: (context) => [context.instruction?.trim() || 'Kullanıcı talimatı girilmelidir.'],
    sourceRule: 'custom_instruction',
    suggestedDocumentTypes: [],
  },
}

/** Etiketler tek kaynaktan gelir (document-requirements); burada kopyalanmaz. */
const EMAIL_REQUIREMENT_LABELS = DOCUMENT_REQUIREMENT_LABELS

function boundedInstruction(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = value.trim()
  if (normalized.length === 0) return null
  return normalized.slice(0, MAX_EMAIL_DRAFT_INSTRUCTION_LENGTH)
}

/**
 * Saf ve deterministik e-posta taslağı. AI veya dış servis çağırmaz; çıktının
 * kullanıcı tarafından incelenmesi zorunludur.
 */
export function buildEmailDraftTemplate(context: EmailDraftTemplateContext): EmailDraftTemplate {
  const definition = TEMPLATE_DEFINITIONS[context.draftType]
  const instruction = boundedInstruction(context.instruction)
  const paragraphs = [...definition.paragraphs({ ...context, instruction })]
  if (context.draftType !== 'custom_instruction' && instruction !== null) {
    paragraphs.push(`Ek kullanıcı notu:\n${instruction}`)
  }
  return {
    draftType: context.draftType,
    subject: definition.subject(context).slice(0, MAX_EMAIL_DRAFT_SUBJECT_LENGTH),
    body: ['Merhaba,', ...paragraphs, 'İyi çalışmalar.'].join('\n\n').slice(0, MAX_EMAIL_DRAFT_BODY_LENGTH),
    templateVersion: EMAIL_DRAFT_TEMPLATE_VERSION,
    sourceType: 'deterministic_template',
    sourceRule: definition.sourceRule,
    suggestedDocumentTypes: definition.suggestedDocumentTypes,
    requiresHumanReview: true,
  }
}

export function normalizeEmailAddress(value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase('en-US')
  if (normalized.length < 3 || normalized.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null
  return normalized
}

export function validateEmailRecipients(
  to: readonly string[],
  cc: readonly string[],
): EmailRecipientValidation {
  if (to.length === 0) {
    return { valid: false, normalizedTo: [], normalizedCc: [], reasonCode: 'to_required' }
  }
  if (to.length > MAX_EMAIL_DRAFT_RECIPIENTS || cc.length > MAX_EMAIL_DRAFT_RECIPIENTS) {
    return { valid: false, normalizedTo: [], normalizedCc: [], reasonCode: 'too_many_recipients' }
  }
  const normalizedTo = to.map(normalizeEmailAddress)
  const normalizedCc = cc.map(normalizeEmailAddress)
  if (normalizedTo.some((value) => value === null) || normalizedCc.some((value) => value === null)) {
    return { valid: false, normalizedTo: [], normalizedCc: [], reasonCode: 'invalid_address' }
  }
  const all = [...normalizedTo, ...normalizedCc] as string[]
  if (new Set(all).size !== all.length) {
    return { valid: false, normalizedTo: [], normalizedCc: [], reasonCode: 'duplicate_address' }
  }
  return {
    valid: true,
    normalizedTo: normalizedTo as string[],
    normalizedCc: normalizedCc as string[],
    reasonCode: 'ok',
  }
}

export function buildGmailComposeUrl(input: {
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly body: string
}): string {
  const recipients = validateEmailRecipients(input.to, input.cc)
  if (!recipients.valid) throw new Error(`invalid_email_recipients:${recipients.reasonCode}`)
  const parameters: [string, string][] = [
    ['view', 'cm'],
    ['fs', '1'],
    ['tf', '1'],
    ['to', recipients.normalizedTo.join(',')],
  ]
  if (recipients.normalizedCc.length > 0) parameters.push(['cc', recipients.normalizedCc.join(',')])
  parameters.push(['su', input.subject], ['body', input.body])
  return `https://mail.google.com/mail/?${parameters
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`
}
