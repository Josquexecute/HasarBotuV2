import { useEffect, useState } from 'react'
interface Source { id: string; request_reference: string; display_name: string; raw_text: string; reviewed_fields?: { vehicleDraft?: { brand: string; model: string; modelYear: string; vehicleClass: string } | null } }
export function EksistSources({ caseId }: { caseId: string }) {
  const [sources, setSources] = useState<Source[]>([]), [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/cases/${encodeURIComponent(caseId)}/eksist-sources`, { credentials: 'include' }).then(async response => {
      if (!response.ok) throw new Error('source_unavailable')
      const data = await response.json() as { items: Source[] }
      if (!cancelled) setSources(data.items)
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [caseId])
  if (error) return <p role="alert">Eksist kaynak bilgileri yüklenemedi.</p>
  if (!sources.length) return null
  return <section className="info-panel"><h2>Eksist kaynakları</h2>{sources.map(source => <details key={source.id}><summary>Eksist · Talep {source.request_reference} · {source.display_name}</summary><a href={`/api/v1/cases/${encodeURIComponent(caseId)}/eksist-sources/${encodeURIComponent(source.id)}/content`}>Orijinal kaynağı indir</a>{source.reviewed_fields?.vehicleDraft && <p>Tamamlanacak araç bilgileri: {[source.reviewed_fields.vehicleDraft.brand, source.reviewed_fields.vehicleDraft.model, source.reviewed_fields.vehicleDraft.modelYear, source.reviewed_fields.vehicleDraft.vehicleClass].filter(Boolean).join(' · ') || 'Belirtilmedi'}</p>}<pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.raw_text}</pre></details>)}</section>
}
