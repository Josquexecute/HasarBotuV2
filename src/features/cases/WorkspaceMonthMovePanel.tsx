import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileOperation } from '@hasarbotu/contracts'
import { createWorkspaceMovePort, WorkspaceMoveError, type WorkspaceMovePort, type WorkspaceMoveState } from '../../data/workspaceMovePort'

const ACTIVE = new Set(['approved', 'queued', 'applying', 'verifying', 'switching_location', 'cleanup_pending'])
const TERMINAL = new Set(['ready', 'stale', 'cancelled'])
const labels: Record<FileOperation['status'], string> = {
  planned: 'Taşıma onayı bekleniyor', approved: 'Onaylandı', queued: 'Taşıma kuyruğunda', applying: 'Klasör taşınıyor',
  verifying: 'Dosya bütünlüğü doğrulanıyor', switching_location: 'Kayıtlı konum güncelleniyor', cleanup_pending: 'Taşıma tamamlanıyor',
  ready: 'Taşındı ve doğrulandı', failed: 'Taşıma başarısız', stale: 'Plan güncelliğini yitirdi', cancelled: 'İptal edildi',
  manual_recovery_required: 'Taşıma kontrol gerektiriyor',
}

export function WorkspaceMonthMovePanel({ caseId, canWrite, onUnauthorized, onMoved, port }: {
  readonly caseId: string
  readonly canWrite: boolean
  readonly onUnauthorized: () => void
  readonly onMoved: () => void
  readonly port?: WorkspaceMovePort
}) {
  const adapter = useMemo(() => port ?? createWorkspaceMovePort(), [port])
  const [state, setState] = useState<WorkspaceMoveState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const notified = useRef<string | null>(null)
  const observedActive = useRef<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const operation = state?.operation

  function showError(reason: unknown) {
    if (reason instanceof WorkspaceMoveError && reason.status === 401) onUnauthorized()
    setError(reason instanceof WorkspaceMoveError && reason.status === 403 ? 'Bu taşıma işlemi için yetkiniz yok.'
      : reason instanceof WorkspaceMoveError && reason.status === 409 ? 'Konum değişmiş, hedef dolu veya başka bir işlem sürüyor. Konumu yenileyip tekrar kontrol edin.'
        : 'Klasör işlemi doğrulanamadı. Bağlantıyı kontrol edip konumu yenileyin.')
  }

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      try {
        const next = await adapter.read(caseId)
        if (cancelled) return
        setState(next)
        setError('')
        if (next.operation && ACTIVE.has(next.operation.status)) observedActive.current = next.operation.id
        if (next.operation?.status === 'ready' && observedActive.current === next.operation.id && notified.current !== next.operation.id) {
          notified.current = next.operation.id
          onMoved()
        }
        if (next.operation && ACTIVE.has(next.operation.status)) timer = setTimeout(() => void read(), 1000)
      } catch (reason) {
        if (!cancelled) {
          if (reason instanceof WorkspaceMoveError && reason.status === 401) onUnauthorized()
          setError('Güncel klasör konumu alınamadı. Konumu yenileyin.')
        }
      }
    }
    void read()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [adapter, caseId, onUnauthorized, onMoved, refresh])

  async function run(action: () => Promise<FileOperation>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await action()
      if (ACTIVE.has(next.status)) observedActive.current = next.id
      setState(current => current ? { ...current, operation: next } : current)
      setRefresh(value => value + 1)
    } catch (reason) { showError(reason) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const pending = state?.location?.relativePath.split('/')[1] === '_EKSİK DOSYALAR'
  const canPlan = canWrite && pending && state?.location?.verificationStatus === 'verified'
    && (!operation || TERMINAL.has(operation.status))
  return <section className="info-panel overview-grid__wide workspace-provisioning" aria-labelledby="month-move-title">
    <header><h2 id="month-move-title">Dosya Konumu ve Ay Klasörüne Taşıma</h2></header>
    <p>Yeni ihbarlar _EKSİK DOSYALAR altında hazırlanır. Dosyadaki işlemler tamamlandığında onayınızla ihbar tarihinin ay klasörüne taşınır.</p>
    {state?.location && <p>Güncel konum: <strong>{state.location.relativePath}</strong></p>}
    {pending && !canWrite && <p>Taşıma için dosya yöneticisi, eksper veya yönetici yetkisi gerekir.</p>}
    {canPlan && <button type="button" className="button button--primary" disabled={busy || !!error} onClick={() => void run(() => adapter.plan(caseId, state!.location!.version))}>Tamamlandı · Ay klasörüne taşı</button>}
    {operation && <div>
      <p role="status">{labels[operation.status]}</p>
      <p>Kaynak: {operation.source.relativePath}<br />Hedef: {operation.destination.relativePath}</p>
      {operation.status === 'planned' && <p>Dosyanın tamamlandığını kontrol edin. Onaydan sonra evrak ve fotoğraflar birlikte taşınır; hedefteki başka dosyanın üzerine yazılmaz.</p>}
      {operation.canApprove && canWrite && <button type="button" className="button button--primary" disabled={busy || !!error} onClick={() => void run(() => adapter.approve(caseId, operation.id))}>Tamamlandığını onayla ve taşı</button>}
      {operation.canCancel && canWrite && <button type="button" className="button button--secondary" disabled={busy} onClick={() => void run(() => adapter.cancel(caseId, operation.id))}>Taşıma planını iptal et</button>}
      {operation.failureReasonCode && <p role="alert">Taşıma doğrulanamadı: {operation.failureReasonCode}. Güncel konumu ve hedef klasörü kontrol edin.</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="button button--secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Konumu yenile</button>
  </section>
}
