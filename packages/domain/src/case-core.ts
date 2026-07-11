import type { InsurerClaimNumber, NotificationFormNumber, OfficeCaseNumber } from './case-identifiers.js'
import type { CaseStage, CaseStatus } from './case-status.js'
import type { CaseType } from './case-type.js'
import type { EntityVersion } from './entity-version.js'
import type { CaseId, InsurerId, ServiceId, UserId } from './ids.js'
import type { PlateNumber } from './plate-number.js'
import type { LocalDate, UtcDateTime } from './temporal.js'

export interface CaseCore {
  readonly id: CaseId
  readonly officeCaseNumber: OfficeCaseNumber
  readonly notificationFormNumber?: NotificationFormNumber
  readonly insurerClaimNumber?: InsurerClaimNumber
  readonly plate: PlateNumber
  readonly caseType: CaseType
  readonly status: CaseStatus
  readonly stage: CaseStage
  readonly responsibleUserId?: UserId
  readonly insurerId?: InsurerId
  readonly serviceId?: ServiceId
  readonly followUpDate?: LocalDate
  readonly lastInterventionAt?: UtcDateTime
  readonly createdAt: UtcDateTime
  readonly updatedAt: UtcDateTime
  readonly version: EntityVersion
}
