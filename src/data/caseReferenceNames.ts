import type { CaseRecord } from '../types/case'
import type { CaseReferenceWorkspace } from './ports'

/** Resolve only explicit current IDs; retain source revisions and historical text. */
export function resolveCaseReferenceNames(item: CaseRecord, references: CaseReferenceWorkspace | null): CaseRecord {
  if (!references) return item
  return {
    ...item,
    company: item.eksist?.insurerName ?? references.insurers.find(entry => entry.id === item.insurerId)?.name ?? item.company,
    assignee: references.users.find(entry => entry.id === item.responsibleUserId)?.displayName ?? item.assignee,
    expert: item.eksist?.expertName ?? references.experts.find(entry => entry.id === item.expertUserId)?.displayName
      ?? references.users.find(entry => entry.id === item.expertUserId)?.displayName ?? item.expert,
    service: item.eksist?.serviceName ?? item.serviceProfile?.name ?? references.services.find(entry => entry.id === item.serviceId)?.name ?? item.service,
  }
}
