import {
  formatOfficeCaseNumber,
  parseCaseId,
  parseCaseStage,
  parseCaseStatus,
  parseCaseType,
  parseEntityVersion,
  parseInsurerClaimNumber,
  parseInsurerId,
  parseLocalDate,
  parseNotificationFormNumber,
  parseOfficeCaseNumber,
  parsePlateNumber,
  parseServiceId,
  parseUserId,
  parseUtcDateTime,
  parseFailure,
  parseSuccess,
  type CaseCore,
  type DomainParseError,
  type ParseResult,
} from '@hasarbotu/domain'
import type { CaseDetail, CaseListItem } from './dto.js'

/**
 * Saf domain <-> wire DTO donusum mapper'lari.
 *
 * Domain sinirinda opsiyonel alanlar `undefined` / alanin bulunmamasi ile;
 * wire DTO'da tutarli `null` ile temsil edilir. Donusum burada aciktir.
 * Takip tarihi her iki tarafta da `followUpDate` (LocalDate, `YYYY-MM-DD`) tasir;
 * timezone donusumu veya gizli saat varsayimi yapilmaz.
 */

function nullable<Value extends string>(value: Value | undefined): Value | null {
  return value === undefined ? null : value
}

/** Domain CaseCore -> liste ogesi DTO'su. */
export function caseCoreToListItem(core: CaseCore): CaseListItem {
  return {
    id: core.id,
    caseType: core.caseType,
    officeCaseNumber: formatOfficeCaseNumber(core.officeCaseNumber),
    notificationFormNumber: nullable(core.notificationFormNumber),
    insurerClaimNumber: nullable(core.insurerClaimNumber),
    plate: core.plate,
    status: core.status,
    stage: core.stage,
    responsibleUserId: nullable(core.responsibleUserId),
    serviceId: nullable(core.serviceId),
    insurerId: nullable(core.insurerId),
    followUpDate: nullable(core.followUpDate),
    lastInterventionAt: nullable(core.lastInterventionAt),
    createdAt: core.createdAt,
    updatedAt: core.updatedAt,
    version: core.version,
  }
}

/** Domain CaseCore -> detay DTO'su (cekirdek alanlar liste ogesiyle ortak). */
export function caseCoreToDetail(core: CaseCore): CaseDetail {
  return caseCoreToListItem(core)
}

function fail(error: DomainParseError): ParseResult<CaseCore> {
  return parseFailure<CaseCore>(error.code, error.field)
}

/**
 * Wire detay DTO'su -> domain CaseCore.
 *
 * Domain dogrulayicilarini yeniden kullanir; `null` degerler `undefined`/alan yoklugu
 * olarak geri cevrilir. Gecerli bir DTO icin round-trip domain degerini yeniden uretir.
 */
export function caseDetailToCaseCore(dto: CaseDetail): ParseResult<CaseCore> {
  const id = parseCaseId(dto.id)
  if (!id.ok) return fail(id.error)
  const officeCaseNumber = parseOfficeCaseNumber(dto.officeCaseNumber)
  if (!officeCaseNumber.ok) return fail(officeCaseNumber.error)
  const plate = parsePlateNumber(dto.plate)
  if (!plate.ok) return fail(plate.error)
  const caseType = parseCaseType(dto.caseType)
  if (!caseType.ok) return fail(caseType.error)
  const status = parseCaseStatus(dto.status)
  if (!status.ok) return fail(status.error)
  const stage = parseCaseStage(dto.stage)
  if (!stage.ok) return fail(stage.error)
  const createdAt = parseUtcDateTime(dto.createdAt)
  if (!createdAt.ok) return fail(createdAt.error)
  const updatedAt = parseUtcDateTime(dto.updatedAt)
  if (!updatedAt.ok) return fail(updatedAt.error)
  const version = parseEntityVersion(dto.version)
  if (!version.ok) return fail(version.error)

  const notificationFormNumber =
    dto.notificationFormNumber === null ? undefined : parseNotificationFormNumber(dto.notificationFormNumber)
  if (notificationFormNumber !== undefined && !notificationFormNumber.ok) return fail(notificationFormNumber.error)
  const insurerClaimNumber =
    dto.insurerClaimNumber === null ? undefined : parseInsurerClaimNumber(dto.insurerClaimNumber)
  if (insurerClaimNumber !== undefined && !insurerClaimNumber.ok) return fail(insurerClaimNumber.error)
  const responsibleUserId = dto.responsibleUserId === null ? undefined : parseUserId(dto.responsibleUserId)
  if (responsibleUserId !== undefined && !responsibleUserId.ok) return fail(responsibleUserId.error)
  const serviceId = dto.serviceId === null ? undefined : parseServiceId(dto.serviceId)
  if (serviceId !== undefined && !serviceId.ok) return fail(serviceId.error)
  const insurerId = dto.insurerId === null ? undefined : parseInsurerId(dto.insurerId)
  if (insurerId !== undefined && !insurerId.ok) return fail(insurerId.error)
  const followUpDate = dto.followUpDate === null ? undefined : parseLocalDate(dto.followUpDate)
  if (followUpDate !== undefined && !followUpDate.ok) return fail(followUpDate.error)
  const lastInterventionAt = dto.lastInterventionAt === null ? undefined : parseUtcDateTime(dto.lastInterventionAt)
  if (lastInterventionAt !== undefined && !lastInterventionAt.ok) return fail(lastInterventionAt.error)

  const core: CaseCore = {
    id: id.value,
    officeCaseNumber: officeCaseNumber.value,
    plate: plate.value,
    caseType: caseType.value,
    status: status.value,
    stage: stage.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    version: version.value,
    ...(notificationFormNumber !== undefined && notificationFormNumber.ok
      ? { notificationFormNumber: notificationFormNumber.value }
      : {}),
    ...(insurerClaimNumber !== undefined && insurerClaimNumber.ok
      ? { insurerClaimNumber: insurerClaimNumber.value }
      : {}),
    ...(responsibleUserId !== undefined && responsibleUserId.ok
      ? { responsibleUserId: responsibleUserId.value }
      : {}),
    ...(serviceId !== undefined && serviceId.ok ? { serviceId: serviceId.value } : {}),
    ...(insurerId !== undefined && insurerId.ok ? { insurerId: insurerId.value } : {}),
    ...(followUpDate !== undefined && followUpDate.ok ? { followUpDate: followUpDate.value } : {}),
    ...(lastInterventionAt !== undefined && lastInterventionAt.ok
      ? { lastInterventionAt: lastInterventionAt.value }
      : {}),
  }

  return parseSuccess(core)
}
