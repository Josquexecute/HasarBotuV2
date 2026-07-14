import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderCog, LoaderCircle, RefreshCw } from 'lucide-react'
import {
  WorkspaceCommandError,
  createHttpWorkspaceCommandAdapter,
  type WorkspaceCommandPort,
  type WorkspaceProvisioningRecord,
  type WorkspaceRootRecord,
} from '../../data'

interface WorkspaceProvisioningPanelProps {
  readonly caseId: string
  readonly notificationDate: string | null
  readonly onUnauthorized: () => void
  readonly port?: WorkspaceCommandPort
}

const ACTIVE = new Set(['approved', 'queued', 'applying', 'verifying'])
const STATUS_LABELS: Record<WorkspaceProvisioningRecord['status'], string> = {
  planned: 'Planlandı',
  approved: 'Onaylandı',
  queued: 'Kuyrukta',
  applying: 'Klasörler oluşturuluyor',
  verifying: 'Fiziksel yapı doğrulanıyor',
  ready: 'Hazır ve doğrulandı',
  failed: 'Başarısız',
  cancelled: 'İptal edildi',
  stale: 'Güncelliğini yitirdi',
}

function safeMessage(error: unknown): string {
  if (!(error instanceof WorkspaceCommandError)) return 'İşlem tamamlanamadı.'
  if (error.kind === 'validation') return 'İhbar tarihi veya depolama kökü çalışma klasörü için uygun değil.'
  if (error.kind === 'not_found') return 'Dosya veya çalışma klasörü planı bulunamadı.'
  if (error.kind === 'conflict') return 'Bu dosya için mevcut konum veya etkin bir çalışma klasörü planı var.'
  if (error.kind === 'unauthorized') return 'Oturum sona erdi. Yeniden giriş yapın.'
  return 'File Agent/API bağlantısı kullanılamıyor; sahte işlem uygulanmadı.'
}

export function WorkspaceProvisioningPanel({ caseId, notificationDate, onUnauthorized, port }: WorkspaceProvisioningPanelProps) {
  const adapter = useMemo(() => port ?? createHttpWorkspaceCommandAdapter(), [port])
  const [roots, setRoots] = useState<readonly WorkspaceRootRecord[]>([])
  const [rootKey, setRootKey] = useState('')
  const [provisioning, setProvisioning] = useState<WorkspaceProvisioningRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    Promise.all([adapter.listActiveRoots(), adapter.readCurrentPlan(caseId)]).then(([items, current]) => {
      if (cancelled) return
      setRoots(items)
      setRootKey(items[0]?.rootKey ?? '')
      setProvisioning(current)
      setError(items.length === 0 ? 'Aktif depolama kökü bulunamadı.' : '')
    }).catch((reason: unknown) => {
      if (cancelled) return
      if (reason instanceof WorkspaceCommandError && reason.kind === 'unauthorized') onUnauthorized()
      setError(safeMessage(reason))
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [adapter, caseId, onUnauthorized])

  useEffect(() => {
    if (provisioning === null || !ACTIVE.has(provisioning.status)) return
    const timer = window.setInterval(() => {
      adapter.readPlan(caseId, provisioning.id).then(setProvisioning).catch((reason: unknown) => {
        if (reason instanceof WorkspaceCommandError && reason.kind === 'unauthorized') onUnauthorized()
        setError(safeMessage(reason))
      })
    }, 750)
    return () => window.clearInterval(timer)
  }, [adapter, caseId, onUnauthorized, provisioning])

  async function run(action: () => Promise<WorkspaceProvisioningRecord>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setProvisioning(await action())
    } catch (reason) {
      if (reason instanceof WorkspaceCommandError && reason.kind === 'unauthorized') onUnauthorized()
      setError(safeMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="info-panel overview-grid__wide workspace-provisioning" aria-labelledby="workspace-title">
      <header>
        <div><h2 id="workspace-title">Çalışma Klasörü</h2><span>File Agent · onaylı kritik işlem</span></div>
        {provisioning !== null && (
          <span className={`status-pill workspace-status workspace-status--${provisioning.status}`}>
            {provisioning.status === 'ready' ? <CheckCircle2 size={13} /> : provisioning.status === 'failed' || provisioning.status === 'stale' ? <AlertTriangle size={13} /> : <LoaderCircle size={13} />}
            {STATUS_LABELS[provisioning.status]}
          </span>
        )}
      </header>

      {provisioning === null ? (
        <div className="workspace-provisioning__start">
          <div>
            <strong>Dosya için güvenli klasör planı oluştur</strong>
            <span>Yol, ihbar tarihi ({notificationDate ?? 'girili değil'}) ve plakadan üretilir. Plan diske yazmaz.</span>
          </div>
          <label>
            <span>Depolama kökü</span>
            <select value={rootKey} onChange={(event) => setRootKey(event.target.value)} disabled={busy || roots.length === 0}>
              {roots.map((root) => <option key={root.rootKey} value={root.rootKey}>{root.label}</option>)}
            </select>
          </label>
          <button className="button button--secondary" type="button" disabled={busy || rootKey.length === 0} onClick={() => void run(() => adapter.createPlan(caseId, rootKey))}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <FolderCog size={15} />} Planı Hazırla
          </button>
        </div>
      ) : (
        <div className="workspace-provisioning__preview">
          <dl>
            <div><dt>Göreli konum</dt><dd>{provisioning.relativePath}</dd></div>
            <div><dt>Mantıksal kök</dt><dd>{provisioning.storageRootKey}</dd></div>
          </dl>
          <div className="workspace-subfolders" aria-label="Oluşturulacak alt klasörler">
            {provisioning.requiredSubdirectories.map((name) => <span key={name}>{name}</span>)}
          </div>
          <div className="workspace-provisioning__actions">
            {provisioning.canApprove && (
              <button className="button button--primary" type="button" disabled={busy} onClick={() => void run(() => adapter.approvePlan(caseId, provisioning.id))}>
                {busy ? <LoaderCircle className="spin" size={15} /> : <FolderCog size={15} />} Onayla ve Oluştur
              </button>
            )}
            {provisioning.canRetry && (
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => void run(() => adapter.approvePlan(caseId, provisioning.id))}>
                <RefreshCw size={15} /> Güvenli Yeniden Dene
              </button>
            )}
            {ACTIVE.has(provisioning.status) && <span role="status">Agent işlemi izleniyor…</span>}
          </div>
        </div>
      )}
      {error && <p className="workspace-provisioning__error" role="alert"><AlertTriangle size={14} />{error}</p>}
    </section>
  )
}
