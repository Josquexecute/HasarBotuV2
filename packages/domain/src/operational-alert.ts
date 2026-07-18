import { classifyCaseTaskDueDate, type CaseTaskPriority } from './case-operations.js'
import { DOCUMENT_REQUIREMENT_LABELS } from './document-requirements.js'

/**
 * Paket 49 — operasyonel uyarıların ilk dilimi.
 *
 * Uyarılar kalıcı mesaj kutusu değildir: mevcut görev, takip ve evrak kuralı
 * verisinden **deterministik türetilen salt okunur** bir listedir. Yeni olay
 * tablosu, kuyruk veya arka plan işçisi yoktur; okundu/silindi/ertelendi gibi
 * kullanıcı durumu bu dilimde bulunmaz.
 */
export const OPERATIONAL_ALERT_SCHEMA_VERSION = 'operational-alert/1.0.0' as const

export const OPERATIONAL_ALERT_TYPES = [
  'overdue_task',
  'overdue_follow_up',
  'missing_required_document',
] as const
export type OperationalAlertType = (typeof OPERATIONAL_ALERT_TYPES)[number]

export const OPERATIONAL_ALERT_SEVERITIES = ['high', 'medium', 'low'] as const
export type OperationalAlertSeverity = (typeof OPERATIONAL_ALERT_SEVERITIES)[number]

export const MAX_OPERATIONAL_ALERTS = 200
export const MAX_OPERATIONAL_ALERT_SUMMARY_LENGTH = 200

const SEVERITY_RANK: Readonly<Record<OperationalAlertSeverity, number>> = {
  high: 0,
  medium: 1,
  low: 2,
}

/** Görev önceliği uyarı önem seviyesine birebir eşlenir; eşik uydurulmaz. */
const TASK_PRIORITY_SEVERITY: Readonly<Record<CaseTaskPriority, OperationalAlertSeverity>> = {
  high: 'high',
  normal: 'medium',
  low: 'low',
}

export interface OperationalAlertCaseFacts {
  readonly caseId: string
  readonly plate: string
  readonly officeNumber: string
}

export interface OverdueTaskFact extends OperationalAlertCaseFacts {
  readonly taskId: string
  readonly title: string
  readonly priority: CaseTaskPriority
  readonly dueDate: string
}

export interface OverdueFollowUpFact extends OperationalAlertCaseFacts {
  readonly followUpDate: string
}

export interface MissingDocumentFact extends OperationalAlertCaseFacts {
  readonly requirementCode: string
  readonly evaluatedDate: string
}

export interface OperationalAlert {
  /** Aynı dosya + aynı sebep için tek uyarı üretmeyi sağlayan kararlı anahtar. */
  readonly dedupeKey: string
  readonly type: OperationalAlertType
  readonly severity: OperationalAlertSeverity
  readonly caseId: string
  readonly plate: string
  readonly officeNumber: string
  readonly summary: string
  readonly sourceDate: string
  readonly caseDetailPath: string
}

export interface OperationalAlertFacts {
  readonly overdueTasks: readonly OverdueTaskFact[]
  readonly overdueFollowUps: readonly OverdueFollowUpFact[]
  readonly missingDocuments: readonly MissingDocumentFact[]
}

function boundedSummary(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length > MAX_OPERATIONAL_ALERT_SUMMARY_LENGTH
    ? normalized.slice(0, MAX_OPERATIONAL_ALERT_SUMMARY_LENGTH)
    : normalized
}

function caseDetailPath(caseId: string): string {
  return `/dosyalar/${caseId}`
}

export function requirementLabel(requirementCode: string): string {
  return DOCUMENT_REQUIREMENT_LABELS[requirementCode] ?? requirementCode
}

/** Yalnız süresi geçmiş (bugünden önce) görev uyarı üretir. */
export function buildOverdueTaskAlert(
  fact: OverdueTaskFact,
  asOfDate: string,
): OperationalAlert | null {
  if (classifyCaseTaskDueDate(fact.dueDate, asOfDate) !== 'overdue') return null
  const title = boundedSummary(fact.title)
  return {
    dedupeKey: `overdue_task:${fact.caseId}:${fact.taskId}`,
    type: 'overdue_task',
    severity: TASK_PRIORITY_SEVERITY[fact.priority],
    caseId: fact.caseId,
    plate: fact.plate,
    officeNumber: fact.officeNumber,
    summary: boundedSummary(title.length > 0 ? `Süresi geçmiş görev: ${title}` : 'Süresi geçmiş görev'),
    sourceDate: fact.dueDate,
    caseDetailPath: caseDetailPath(fact.caseId),
  }
}

/** Yalnız takip tarihi bugünden önce olan dosya uyarı üretir. */
export function buildOverdueFollowUpAlert(
  fact: OverdueFollowUpFact,
  asOfDate: string,
): OperationalAlert | null {
  if (classifyCaseTaskDueDate(fact.followUpDate, asOfDate) !== 'overdue') return null
  return {
    dedupeKey: `overdue_follow_up:${fact.caseId}`,
    type: 'overdue_follow_up',
    severity: 'medium',
    caseId: fact.caseId,
    plate: fact.plate,
    officeNumber: fact.officeNumber,
    summary: 'Takip tarihi geçti',
    sourceDate: fact.followUpDate,
    caseDetailPath: caseDetailPath(fact.caseId),
  }
}

/** Eksik zorunlu evrak; gereksinim kodu başına tek uyarı üretir. */
export function buildMissingDocumentAlert(fact: MissingDocumentFact): OperationalAlert {
  return {
    dedupeKey: `missing_required_document:${fact.caseId}:${fact.requirementCode}`,
    type: 'missing_required_document',
    severity: 'high',
    caseId: fact.caseId,
    plate: fact.plate,
    officeNumber: fact.officeNumber,
    summary: boundedSummary(`Eksik zorunlu evrak: ${requirementLabel(fact.requirementCode)}`),
    sourceDate: fact.evaluatedDate,
    caseDetailPath: caseDetailPath(fact.caseId),
  }
}

/**
 * Uyarıları deterministik sıralar: önem (yüksek → düşük), kaynak tarih (eski →
 * yeni), sonra dosya ve kararlı anahtar. Aynı `dedupeKey` yalnız bir kez yer
 * alır ve sonuç `MAX_OPERATIONAL_ALERTS` ile sınırlanır.
 */
export function normalizeOperationalAlerts(
  alerts: readonly OperationalAlert[],
): readonly OperationalAlert[] {
  const unique = new Map<string, OperationalAlert>()
  for (const alert of alerts) {
    if (!unique.has(alert.dedupeKey)) unique.set(alert.dedupeKey, alert)
  }
  return [...unique.values()]
    .sort((left, right) => (
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      || left.sourceDate.localeCompare(right.sourceDate)
      || left.caseId.localeCompare(right.caseId)
      || left.dedupeKey.localeCompare(right.dedupeKey)
    ))
    .slice(0, MAX_OPERATIONAL_ALERTS)
}

/** Kaynak verilerden uyarı listesini deterministik üretir. */
export function collectOperationalAlerts(
  facts: OperationalAlertFacts,
  asOfDate: string,
): readonly OperationalAlert[] {
  const alerts: OperationalAlert[] = []
  for (const task of facts.overdueTasks) {
    const alert = buildOverdueTaskAlert(task, asOfDate)
    if (alert !== null) alerts.push(alert)
  }
  for (const followUp of facts.overdueFollowUps) {
    const alert = buildOverdueFollowUpAlert(followUp, asOfDate)
    if (alert !== null) alerts.push(alert)
  }
  for (const document of facts.missingDocuments) {
    alerts.push(buildMissingDocumentAlert(document))
  }
  return normalizeOperationalAlerts(alerts)
}
