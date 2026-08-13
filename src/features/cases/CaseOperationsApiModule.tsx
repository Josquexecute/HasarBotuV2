import { useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  NotebookPen,
  RefreshCw,
  Save,
  XCircle,
} from 'lucide-react'
import { CaseOperationsError, type CaseOperationsPort, type CaseTaskRecord } from '../../data/caseOperationsPort'
import { CaseCommandError, createHttpCaseCommandAdapter, type CaseCommandPort } from '../../data/commandPort'
import type { CaseReferenceDataPort, DataSourceKind } from '../../data/ports'
import { useCaseOperations } from '../../data/useCaseOperations'
import { useCaseReferences } from '../../data/useCaseReferences'
import type { CaseRecord } from '../../types/case'

interface Props {
  readonly item: CaseRecord
  readonly source: DataSourceKind
  readonly onUnauthorized: () => void
  readonly onUpdated: (item: CaseRecord) => void
  readonly onReloadCase: () => void
  readonly operationsPort?: CaseOperationsPort
  readonly commandPort?: CaseCommandPort
  readonly referencePort?: CaseReferenceDataPort
}

const noteTypeLabels = {
  internal: 'İç not',
  contact: 'Görüşme notu',
} as const

const priorityLabels = {
  low: 'Düşük',
  normal: 'Normal',
  high: 'Yüksek',
} as const

const dueLabels = {
  overdue: 'Gecikmiş',
  today: 'Bugün',
  upcoming: 'Yaklaşıyor',
  scheduled: 'Planlı',
} as const

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(value))
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof CaseOperationsError) {
    if (error.kind === 'unauthorized') return 'Oturum süresi doldu. Yeniden giriş yapın.'
    if (error.kind === 'forbidden') return 'Bu işlem için yetkiniz bulunmuyor.'
    if (error.kind === 'not_found') return 'Dosya veya görev bulunamadı.'
    if (error.kind === 'validation') return 'Alanları ve zorunlu açıklamaları kontrol edin.'
    if (error.kind === 'conflict') return 'Kayıt başka bir işlemle değişti. Güncel veriyi yükleyin.'
    return 'Operasyon servisine ulaşılamadı. Sahte veri gösterilmedi.'
  }
  if (error instanceof CaseCommandError) {
    if (error.kind === 'unauthorized') return 'Oturum süresi doldu. Yeniden giriş yapın.'
    if (error.kind === 'version_conflict') return 'Dosya başka bir işlemle değişti. Güncel veriyi yükleyin.'
    if (error.kind === 'validation') return 'Takip tarihi doğrulanamadı.'
    return 'Takip tarihi güncellenemedi.'
  }
  return 'İşlem güvenli biçimde tamamlanamadı.'
}

export function CaseOperationsApiModule({
  item,
  source,
  onUnauthorized,
  onUpdated,
  onReloadCase,
  operationsPort,
  commandPort,
  referencePort,
}: Props) {
  const workspace = useCaseOperations(item.caseId, source, true, operationsPort)
  const commands = useMemo(() => commandPort ?? createHttpCaseCommandAdapter(), [commandPort])
  const references = useCaseReferences(referencePort)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [noteType, setNoteType] = useState<'internal' | 'contact'>('internal')
  const [noteSubject, setNoteSubject] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskPriority, setTaskPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [taskAssignee, setTaskAssignee] = useState(item.responsibleUserId ?? '')
  const [taskDueDate, setTaskDueDate] = useState(item.followUpDate ?? workspace.data?.asOfDate ?? '')
  const [resolution, setResolution] = useState<{
    taskId: string
    action: 'complete' | 'cancel'
    text: string
  } | null>(null)
  const [followUpDate, setFollowUpDate] = useState(item.followUpDate ?? '')

  const run = async (label: string, operation: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label)
    setError('')
    setConflict(false)
    try {
      await operation()
    } catch (caught) {
      setError(safeErrorMessage(caught))
      setConflict(
        (caught instanceof CaseOperationsError && caught.kind === 'conflict') ||
        (caught instanceof CaseCommandError && caught.kind === 'version_conflict'),
      )
      if (
        (caught instanceof CaseOperationsError && caught.kind === 'unauthorized') ||
        (caught instanceof CaseCommandError && caught.kind === 'unauthorized')
      ) onUnauthorized()
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const submitNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (noteBody.trim().length === 0) {
      setError('Not metni zorunludur.')
      return
    }
    void run('note', async () => {
      await workspace.port.createNote(item.caseId, {
        noteType,
        subject: noteSubject.trim() === '' ? null : noteSubject.trim(),
        body: noteBody.trim(),
      })
      setNoteSubject('')
      setNoteBody('')
      workspace.reload()
    })
  }

  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (taskTitle.trim().length === 0 || taskDueDate === '') {
      setError('Görev başlığı ve son tarihi zorunludur.')
      return
    }
    void run('task', async () => {
      await workspace.port.createTask(item.caseId, {
        title: taskTitle.trim(),
        priority: taskPriority,
        assignedUserId: taskAssignee === '' ? null : taskAssignee,
        dueDate: taskDueDate,
      })
      setTaskTitle('')
      workspace.reload()
    })
  }

  const resolveTask = (task: CaseTaskRecord) => {
    if (resolution === null || resolution.text.trim().length === 0) {
      setError(resolution?.action === 'cancel' ? 'İptal gerekçesi zorunludur.' : 'Görev sonucu notu zorunludur.')
      return
    }
    void run(`resolve-${task.id}`, async () => {
      if (resolution.action === 'complete') {
        await workspace.port.completeTask(item.caseId, task.id, task.version, resolution.text.trim())
      } else {
        await workspace.port.cancelTask(item.caseId, task.id, task.version, resolution.text.trim())
      }
      setResolution(null)
      workspace.reload()
    })
  }

  const updateFollowUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (item.version === undefined) {
      setError('Dosya sürümü yüklenemedi. Güncel veriyi alın.')
      return
    }
    void run('follow-up', async () => {
      const updated = await commands.updateCase(item.caseId, {
        expectedVersion: item.version as number,
        followUpDate: followUpDate === '' ? null : followUpDate,
      })
      onUpdated(updated)
      workspace.reload()
    })
  }

  if (workspace.status === 'loading' && workspace.data === null) {
    return <div className="case-operations-state" role="status"><LoaderCircle className="spin" size={20} />Operasyon kayıtları yükleniyor…</div>
  }
  if (workspace.status !== 'ok' || workspace.data === null) {
    const message = workspace.status === 'unauthorized'
      ? 'Gerçek operasyon kayıtları için oturum gerekli.'
      : workspace.status === 'forbidden'
        ? 'Operasyon kayıtlarını görüntüleme yetkiniz yok.'
        : workspace.status === 'not_found'
          ? 'Dosya bulunamadı veya organizasyon kapsamınızda değil.'
          : 'Operasyon API’sine ulaşılamadı; mock kayıt gösterilmedi.'
    return (
      <div className="case-operations-state" role="alert">
        <AlertTriangle size={20} />
        <span>{message}</span>
        <button className="button button--secondary" type="button" onClick={workspace.reload}><RefreshCw size={15} /> Yeniden dene</button>
      </div>
    )
  }

  const canWrite = workspace.data.permissions.canWrite && item.lifecycleStatus !== 'closed'
  const openTasks = workspace.data.tasks.filter((task) => task.status === 'open')
  const resolvedTasks = workspace.data.tasks.filter((task) => task.status !== 'open')

  return (
    <div className="case-operations">
      {error && (
        <div className="case-form-alert case-form-alert--error case-operations__alert" role="alert">
          <AlertTriangle size={17} />
          <span>{error}</span>
          {conflict && <button className="button button--secondary" type="button" onClick={() => {
            workspace.reload()
            onReloadCase()
          }}><RefreshCw size={15} /> Güncel Veriyi Yükle</button>}
        </div>
      )}
      {!canWrite && (
        <div className="case-form-note">
          <span>{item.lifecycleStatus === 'closed' ? 'Kapalı dosya salt okunurdur.' : 'Rolünüz bu alanda yazma izni vermiyor.'}</span>
        </div>
      )}

      <div className="case-operations__grid">
        <section className="info-panel">
          <header><h2>Notlar ve Görüşmeler</h2><NotebookPen size={16} /></header>
          {canWrite && (
            <form className="case-operations__form" onSubmit={submitNote}>
              <div className="case-operations__form-row">
                <label><span>Not türü</span><select value={noteType} onChange={(event) => setNoteType(event.target.value as typeof noteType)}><option value="internal">İç not</option><option value="contact">Görüşme notu</option></select></label>
                <label><span>Konu</span><input value={noteSubject} maxLength={160} onChange={(event) => setNoteSubject(event.target.value)} /></label>
              </div>
              <label><span>Not</span><textarea value={noteBody} maxLength={5000} rows={4} onChange={(event) => setNoteBody(event.target.value)} /></label>
              <button className="button button--primary" type="submit" disabled={busy !== ''}>{busy === 'note' ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Notu Ekle</button>
            </form>
          )}
          <div className="case-operations__notes">
            {workspace.data.notes.length === 0 && <p className="case-operations__empty">Henüz not veya görüşme kaydı yok.</p>}
            {workspace.data.notes.map((note) => (
              <article className="long-note" key={note.id}>
                <div><strong>{note.subject ?? noteTypeLabels[note.noteType]}</strong><span>{formatDateTime(note.legacySource?.occurredAt ?? note.createdAt)} · {note.legacySource?.authorName ?? note.createdByDisplayName}{note.legacySource !== null ? ' · V1 tarihsel kayıt' : ''}</span></div>
                <p>{note.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="info-panel">
          <header><h2>Görevler</h2><ClipboardList size={16} /></header>
          {canWrite && (
            <form className="case-operations__form" onSubmit={submitTask}>
              <label><span>Görev</span><input value={taskTitle} maxLength={300} onChange={(event) => setTaskTitle(event.target.value)} /></label>
              <div className="case-operations__form-row">
                <label><span>Son tarih</span><input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /></label>
                <label><span>Öncelik</span><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as typeof taskPriority)}><option value="low">Düşük</option><option value="normal">Normal</option><option value="high">Yüksek</option></select></label>
              </div>
              <label><span>Sorumlu</span><select value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value)} disabled={references.status !== 'ok'}><option value="">Atanmamış</option>{references.references?.users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label>
              {references.status === 'unavailable' && <small className="text-warning">Gerçek kullanıcı listesi alınamadı; sahte seçenek gösterilmedi.</small>}
              <button className="button button--primary" type="submit" disabled={busy !== '' || references.status !== 'ok'}>{busy === 'task' ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Görev Oluştur</button>
            </form>
          )}
          <div className="case-task-cards">
            {openTasks.length === 0 && <p className="case-operations__empty">Açık görev yok.</p>}
            {openTasks.map((task) => (
              <article className={`case-task-card case-task-card--${task.dueStatus}`} key={task.id}>
                <div className="case-task-card__head"><strong>{task.title}</strong><span>{dueLabels[task.dueStatus]}</span></div>
                <div className="case-task-card__meta"><span>{formatDate(task.dueDate)}</span><span>{priorityLabels[task.priority]} öncelik</span><span>{task.legacySource?.assigneeName ?? task.assignedUserDisplayName ?? 'Atanmamış'}</span><span>Sürüm {task.version}</span>{task.legacySource !== null && <span>V1 tarihsel kayıt</span>}</div>
                {canWrite && resolution?.taskId !== task.id && <div className="case-task-card__actions"><button className="button button--secondary" type="button" onClick={() => setResolution({ taskId: task.id, action: 'complete', text: '' })}><CheckCircle2 size={14} /> Tamamla</button><button className="button button--secondary" type="button" onClick={() => setResolution({ taskId: task.id, action: 'cancel', text: '' })}><XCircle size={14} /> İptal Et</button></div>}
                {resolution?.taskId === task.id && (
                  <div className="case-task-card__resolution">
                    <label><span>{resolution.action === 'complete' ? 'Görev sonucu' : 'İptal gerekçesi'}</span><textarea rows={3} value={resolution.text} maxLength={1000} onChange={(event) => setResolution({ ...resolution, text: event.target.value })} /></label>
                    <div><button className="button button--secondary" type="button" onClick={() => setResolution(null)}>Vazgeç</button><button className="button button--primary" type="button" disabled={busy !== ''} onClick={() => resolveTask(task)}>Onayla</button></div>
                  </div>
                )}
              </article>
            ))}
            {resolvedTasks.map((task) => (
              <article className="case-task-card case-task-card--resolved" key={task.id}>
                <div className="case-task-card__head"><strong>{task.title}</strong><span>{task.status === 'completed' ? 'Tamamlandı' : 'İptal edildi'}</span></div>
                <p>{task.resolutionNote}</p>
                <small>{task.legacySource !== null ? 'V1 tarihsel kayıt' : task.resolvedByDisplayName} · {(task.legacySource?.completedAt ?? task.resolvedAt) === null ? '—' : formatDateTime((task.legacySource?.completedAt ?? task.resolvedAt) as string)}</small>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="info-panel case-operations__follow-up">
        <header><h2>Takip Tarihi Geçmişi</h2><CalendarClock size={16} /></header>
        {canWrite && (
          <form className="case-operations__follow-form" onSubmit={updateFollowUp}>
            <label><span>Yeni takip tarihi</span><input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></label>
            <button className="button button--primary" type="submit" disabled={busy !== '' || followUpDate === (item.followUpDate ?? '')}>{busy === 'follow-up' ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Takibi Kaydet</button>
          </form>
        )}
        <div className="case-follow-up-history">
          {workspace.data.followUpHistory.length === 0 && <p className="case-operations__empty">Takip tarihi değişikliği bulunmuyor.</p>}
          {workspace.data.followUpHistory.map((history) => (
            <article key={history.id}>
              <span>{formatDateTime(history.changedAt)}</span>
              <strong>{history.previousFollowUpDate === null ? 'Takip yok' : formatDate(history.previousFollowUpDate)} → {history.newFollowUpDate === null ? 'Takip temizlendi' : formatDate(history.newFollowUpDate)}</strong>
              <small>{history.source === 'v1_historical_import' ? 'V1 tarihsel aktarım' : history.actorDisplayName} · dosya sürümü {history.caseVersion}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
