import { Inbox, LoaderCircle, RotateCcw } from 'lucide-react'

export function LoadingState({ label = 'Yükleniyor' }: { label?: string }) {
  return (
    <div className="state-view" role="status">
      <LoaderCircle className="state-view__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ onReset }: { onReset?: () => void }) {
  return (
    <div className="state-view">
      <Inbox aria-hidden="true" />
      <strong>Eşleşen dosya bulunamadı</strong>
      <span>Arama veya filtre ölçütlerini değiştirin.</span>
      {onReset && (
        <button className="button button--secondary" type="button" onClick={onReset}>
          <RotateCcw size={15} aria-hidden="true" />
          Filtreleri temizle
        </button>
      )}
    </div>
  )
}
