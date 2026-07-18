import { CircleAlert, Inbox, LoaderCircle, RotateCcw } from 'lucide-react'

export function LoadingState({ label = 'Yükleniyor' }: { label?: string }) {
  return (
    <div className="state-view" role="status">
      <LoaderCircle className="state-view__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

/**
 * Gerçek veri kaynağı henüz kurulmamış ekranlar için dürüst boş durum.
 * API modunda örnek/mock kayıt gösterilmez; bu bileşen mock'a düşmenin
 * yerine geçen açık bilgilendirmedir.
 */
export function BackendUnavailableState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="state-view" role="status">
      <CircleAlert aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail ?? 'Gerçek veri kaynağı bağlanana kadar örnek kayıt gösterilmez.'}</span>
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
