import { ChevronDown } from 'lucide-react'
import type { CaseReferenceDataPort } from '../../data/ports'
import { useCaseReferences } from '../../data/useCaseReferences'
/**
 * API modunda sorumlu ve servis filtreleri (Paket 53).
 *
 * Sunucu bu filtreleri KİMLİKLE uygular, bu yüzden seçenekler gerçek referans
 * uçlarından gelir. Sayfalanmış listeden türetilemez: bir sayfadaki adlar tüm
 * seçenek kümesini temsil etmez. Bileşen yalnız API modunda render edildiği
 * için mock modda referans çağrısı yapılmaz.
 */
export function CaseReferenceFilters({
  responsibleUserId,
  serviceId,
  onResponsibleChange,
  onServiceChange,
  port,
}: {
  readonly responsibleUserId: string
  readonly serviceId: string
  onResponsibleChange: (value: string) => void
  onServiceChange: (value: string) => void
  readonly port?: CaseReferenceDataPort
}) {
  const { references, status } = useCaseReferences(port)
  const users = references?.users ?? []
  const services = references?.services ?? []
  const disabled = status !== 'ok'

  return (
    <>
      <label className="select-field">
        <span className="select-field__label">Sorumlu</span>
        <select
          aria-label="Dosya sorumlusu"
          value={responsibleUserId}
          disabled={disabled}
          onChange={(event) => onResponsibleChange(event.target.value)}
        >
          <option value="Tümü">Tümü</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.displayName}</option>
          ))}
        </select>
        <ChevronDown size={14} />
      </label>
      <label className="select-field">
        <span className="select-field__label">Servis</span>
        <select
          aria-label="Dosya servisi"
          value={serviceId}
          disabled={disabled}
          onChange={(event) => onServiceChange(event.target.value)}
        >
          <option value="Tümü">Tümü</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>{service.name}</option>
          ))}
        </select>
        <ChevronDown size={14} />
      </label>
    </>
  )
}
