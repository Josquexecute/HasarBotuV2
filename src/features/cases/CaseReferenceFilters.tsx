import { SearchableSelect } from '../../components/SearchableSelect'
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
  referenceData,
}: {
  readonly responsibleUserId: string
  readonly serviceId: string
  onResponsibleChange: (value: string) => void
  onServiceChange: (value: string) => void
  readonly port?: CaseReferenceDataPort
  readonly referenceData?: ReturnType<typeof useCaseReferences>
}) {
  const loaded = useCaseReferences(port, { includeUnlinkedNames: true }, referenceData === undefined)
  const { references, status, reload } = referenceData ?? loaded
  const users = (references?.users ?? []).filter((user) => user.roles?.includes('case_manager'))
  const services = references?.services ?? []
  const disabled = status !== 'ok'

  return (
    <>
      <SearchableSelect label="Dosya sorumlusu" value={responsibleUserId} disabled={disabled} onChange={onResponsibleChange}
        options={[{ value: 'Tümü', label: 'Tüm sorumlular' }, ...users.map(user => ({ value: user.id, label: user.displayName }))]} />
      <SearchableSelect label="Dosya servisi" value={serviceId} disabled={disabled} onChange={onServiceChange}
        options={[{ value: 'Tümü', label: 'Tüm servisler' }, ...services.map(service => ({ value: service.id, label: service.name })),
          ...(references?.serviceContactNames ?? []).map(name => ({ value: `name:${name}`, label: `${name} (eski kayıtlar)` }))]} />
      {status === 'loading' && <span className="filterbar__status" role="status">Filtreler yükleniyor…</span>}
      {status === 'unavailable' && <span className="filterbar__status" role="status">Filtreler yüklenemedi. <button type="button" className="filterbar__clear" onClick={reload}>Yeniden dene</button></span>}
      {status === 'unauthorized' && <span className="filterbar__status" role="status">Filtreleri kullanmak için yeniden giriş yapın.</span>}
    </>
  )
}
