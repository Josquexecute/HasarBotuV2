import type { CaseReferenceWorkspace } from '../../data/ports'
import { useCaseReferences } from '../../data/useCaseReferences'
import type { CaseRecord } from '../../types/case'

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR').replace(/ı/gu, 'i').normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '').replace(/[^a-z0-9]/gu, '')
}

function ReferenceField({ label, current, legacy }: {
  readonly label: string
  readonly current: string | null
  readonly legacy: readonly string[]
}) {
  const visibleLegacy = legacy.filter((name) => current === null || normalized(name) !== normalized(current))
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {current !== null ? <span>{current}</span> : visibleLegacy.length === 0 ? <span>—</span> : null}
        {visibleLegacy.length > 0 && (
          <small className="legacy-reference">
            {current === null ? 'V1 geçmiş' : 'V1 geçmiş (güncel kayıttan farklı)'}: {visibleLegacy.join(' · ')}
          </small>
        )}
      </dd>
    </div>
  )
}

export function CaseLegacyReferenceFields({ item, references }: {
  readonly item: CaseRecord
  readonly references: CaseReferenceWorkspace | null
}) {
  const legacy = item.legacyReferences ?? { responsibleNames: [], expertNames: [], serviceNames: [] }
  const responsible = item.responsibleUserId === null || item.responsibleUserId === undefined
    ? null
    : references?.users.find((entry) => entry.id === item.responsibleUserId)?.displayName ?? 'V2 ataması mevcut'
  const expert = item.expertUserId === null || item.expertUserId === undefined
    ? null
    : references?.experts.find((entry) => entry.id === item.expertUserId)?.displayName
      ?? references?.users.find((entry) => entry.id === item.expertUserId)?.displayName
      ?? 'V2 ataması mevcut'
  const service = item.serviceProfile?.name
    ?? (item.serviceId === null || item.serviceId === undefined
      ? null
      : references?.services.find((entry) => entry.id === item.serviceId)?.name ?? 'V2 servisi mevcut')
  return (
    <>
      <ReferenceField label="Servis" current={service} legacy={legacy.serviceNames} />
      <ReferenceField label="Sorumlu" current={responsible} legacy={legacy.responsibleNames} />
      <ReferenceField label="Eksper" current={expert} legacy={legacy.expertNames} />
    </>
  )
}

export function CaseApiLegacyReferenceFields({ item }: { readonly item: CaseRecord }) {
  const { references } = useCaseReferences()
  return <CaseLegacyReferenceFields item={item} references={references} />
}
