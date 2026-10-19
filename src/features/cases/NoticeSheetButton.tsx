import { lazy, Suspense, useState } from 'react'
import { Printer } from 'lucide-react'
import type { DataSourceKind } from '../../data/ports'

const NoticeSheetModal = lazy(async () => ({ default: (await import('./NoticeSheetModal')).NoticeSheetModal }))

export function NoticeSheetButton({ caseId, plate, source, compact = false, onOpenChange }: {
  caseId: string
  plate: string
  source: DataSourceKind
  compact?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  return <span onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button className={compact ? 'icon-button' : 'button button--secondary'} type="button" disabled={source !== 'api'}
      aria-label={`${plate} ihbar föyünü yazdır`} title={source === 'api' ? 'İhbar föyünü aç ve yazdır' : 'İhbar föyü gerçek dosya bağlantısı gerektirir.'}
      onClick={() => { setOpen(true); onOpenChange?.(true) }}><Printer size={15} />{!compact && 'İhbar Föyü'}</button>
    {open && <Suspense fallback={<span role="status">Föy açılıyor…</span>}><NoticeSheetModal key={caseId} caseId={caseId} onClose={() => { setOpen(false); onOpenChange?.(false) }} /></Suspense>}
  </span>
}
