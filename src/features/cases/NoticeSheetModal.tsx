import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Printer, RotateCcw, Save, X } from 'lucide-react'
import { applyNoticeSheetOverrides, NOTICE_SHEET_FIELD_LIMITS, type NoticeSheetDocument, type NoticeSheetField, type NoticeSheetOverrides, type NoticeSheetResponse } from '@hasarbotu/contracts'
import { useSession } from '../../app/sessionContext'
import { ModalFrame } from '../../components/ModalFrame'
import { createHttpNoticeSheetAdapter, NoticeSheetClientError, type NoticeSheetDataPort } from '../../data/noticeSheetPort'
import { NoticeSheet } from './NoticeSheet'
import { noticeSheetDocumentLabels, noticeSheetFieldGroups } from './notice-sheet-fields'
import './notice-sheet.css'

const errorMessages = {
  unauthorized: 'Oturumunuz sona erdi. Yeniden giriş yapın.',
  forbidden: 'Bu işlem için yetkiniz yok.',
  not_found: 'Dosya bulunamadı veya erişim alanınızda değil.',
  validation: 'Föy alanları geçersiz. Tarihleri ve metin uzunluklarını kontrol edin.',
  conflict: 'Dosya veya föy değişmiş olabilir. Girdiğiniz bilgiler korunuyor; güncel föyü yeniden yükleyin.',
  unavailable: 'İhbar föyü yüklenemedi veya kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.',
} as const

export function NoticeSheetModal({ caseId, onClose, port: suppliedPort }: {
  caseId: string
  onClose(): void
  port?: NoticeSheetDataPort
}) {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpNoticeSheetAdapter(), [suppliedPort])
  const [sheet, setSheet] = useState<NoticeSheetResponse | null>(null)
  const [draft, setDraft] = useState<NoticeSheetOverrides>({ fields: {}, documents: {} })
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [loadVersion, setLoadVersion] = useState(0)
  const mounted = useRef(false)
  const preview = useRef<HTMLDivElement>(null)
  const originalTitle = useRef<string | null>(null)
  const dirty = sheet !== null && JSON.stringify(draft) !== JSON.stringify(sheet.overrides)
  const canEdit = sheet?.permissions.canEdit === true

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    port.read(caseId).then(result => {
      if (cancelled) return
      setSheet(result)
      setDraft(result.overrides)
      setStatus('ok')
    }).catch((reason: unknown) => {
      if (cancelled) return
      const kind = reason instanceof NoticeSheetClientError ? reason.kind : 'unavailable'
      setError(errorMessages[kind])
      setStatus('error')
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true; mounted.current = false }
  }, [caseId, loadVersion, port, reportUnauthorized])

  useEffect(() => {
    const resetPrint = () => {
      document.body.classList.remove('printing-notice-sheet')
      if (originalTitle.current !== null) document.title = originalTitle.current
      originalTitle.current = null
    }
    window.addEventListener('afterprint', resetPrint)
    return () => { window.removeEventListener('afterprint', resetPrint); resetPrint() }
  }, [])

  const { fields, documents } = sheet
    ? applyNoticeSheetOverrides(sheet.defaults, draft)
    : { fields: null, documents: null }
  const close = () => {
    if (busy) return
    if (dirty) setDiscarding(true)
    else onClose()
  }
  const changeField = (key: NoticeSheetField, value: string) => {
    if (!sheet || !canEdit) return
    setDraft(current => {
      const next = { ...current.fields }
      if (value === sheet.defaults.fields[key]) delete next[key]
      else next[key] = value
      return { ...current, fields: next }
    })
    setNotice('')
  }
  const changeDocument = (key: NoticeSheetDocument, value: boolean) => {
    if (!sheet || !canEdit) return
    setDraft(current => {
      const next = { ...current.documents }
      if (value === sheet.defaults.documents[key]) delete next[key]
      else next[key] = value
      return { ...current, documents: next }
    })
    setNotice('')
  }
  const fitsPage = () => {
    const paper = preview.current?.querySelector<HTMLElement>('.notice-sheet-paper')
    const content = paper?.querySelector<HTMLElement>('.notice-sheet')
    if (!paper || !content) return false
    const overflowing = content.scrollHeight > content.clientHeight + 1
      || content.scrollWidth > content.clientWidth + 1
    if (overflowing) setError('İçerik tek A4 sayfasını aşıyor. Uzun alanları ve çalışma notlarını kısaltın; hiçbir bilgi kesilmeden yeniden yazdırabilirsiniz.')
    return !overflowing
  }
  const save = async (printAfter: boolean) => {
    if (!sheet || sheet.caseType === null || busy || (dirty && !canEdit)) return
    setError('')
    if (printAfter && !fitsPage()) return
    setBusy(true)
    try {
      if (dirty) {
        const saved = await port.save(caseId, { expectedVersion: sheet.version, overrides: draft })
        if (!mounted.current) return
        flushSync(() => { setSheet(saved); setDraft(saved.overrides) })
        setNotice('Föy kaydedildi.')
      }
      if (printAfter && mounted.current && fitsPage()) {
        if (!previewing) {
          setPreviewing(true)
          return
        }
        originalTitle.current = document.title
        document.title = `${fields?.plate ?? sheet.plate} · ${fields?.officeNumber ?? sheet.officeNumber} · İhbar Föyü`
        document.body.classList.add('printing-notice-sheet')
        try { window.print() } catch {
          document.body.classList.remove('printing-notice-sheet')
          if (originalTitle.current !== null) document.title = originalTitle.current
          originalTitle.current = null
          setError('Yazdırma penceresi açılamadı. Föyü yeniden yazdırmayı deneyin.')
        }
      }
    } catch (reason) {
      if (!mounted.current) return
      const kind = reason instanceof NoticeSheetClientError ? reason.kind : 'unavailable'
      setError(errorMessages[kind])
      if (kind === 'unauthorized') reportUnauthorized()
    } finally { if (mounted.current) setBusy(false) }
  }

  return <>
    <ModalFrame className="notice-sheet-modal" labelledBy="notice-sheet-title" onClose={close} busy={busy}>
      <header className="modal__header">
        <div><span className="eyebrow">{sheet ? `${sheet.plate} · ${sheet.officeNumber}` : 'Dosya hazırlanıyor'}</span><h2 id="notice-sheet-title">{previewing ? 'Yazdırma Önizlemesi' : 'İhbar Föyü'}</h2></div>
        <button className="icon-button" type="button" onClick={close} disabled={busy} aria-label="İhbar föyünü kapat"><X size={18} /></button>
      </header>
      {discarding ? <div className="modal__body notice-sheet-discard" role="alert">
        <p>Kaydedilmemiş değişiklikler var. Föyü kaydetmeden kapatmak istiyor musunuz?</p>
        <button className="button button--secondary" type="button" onClick={() => setDiscarding(false)}>Düzenlemeye dön</button>
        <button className="button button--danger-ghost" type="button" onClick={onClose}>Kaydetmeden kapat</button>
      </div> : <>
        {error && <div className="notice-sheet-message" role="alert">{error}</div>}
        {notice && <div className="notice-sheet-message" role="status">{notice}</div>}
        {status === 'loading' && <div className="modal__body" role="status">İhbar föyü hazırlanıyor…</div>}
        {status === 'error' && <div className="modal__body"><button type="button" className="button button--secondary" onClick={() => { setStatus('loading'); setError(''); setLoadVersion(value => value + 1) }}>Yeniden dene</button></div>}
        {status === 'ok' && sheet?.caseType === null && <div className="modal__body" role="status">Föy oluşturmak için dosya içinden Kasko veya Trafik türünü seçin.</div>}
        {status === 'ok' && sheet && sheet.caseType !== null && fields && documents && <div className={`notice-sheet-workspace${previewing ? ' notice-sheet-workspace--print-preview' : ''}`}>
          <aside className="notice-sheet-editor">
            <p>Tüm föy alanlarını düzenleyebilirsiniz. Değişiklikler yalnız bu föye kaydedilir; dosya kaydı değişmez.</p>
            {!canEdit && <p role="status">Bu föy salt okunur; güncel hali yazdırılabilir.</p>}
            <fieldset disabled={!canEdit || busy}>
              {noticeSheetFieldGroups.map((group, index) => <details key={group.title} open={index === 0}>
                <summary>{group.title}</summary>
                <div className="notice-sheet-editor__fields">{group.fields.map(field => {
                  return <label key={field.key}><span>{field.label}{Object.hasOwn(draft.fields, field.key) && <small> · Düzenlendi</small>}</span>
                    {field.multiline ? <textarea aria-label={field.label} value={fields[field.key]} maxLength={NOTICE_SHEET_FIELD_LIMITS[field.key]} rows={field.key === 'inspectionNotes' ? 6 : 3} onChange={event => changeField(field.key, event.target.value)} />
                      : <input aria-label={field.label} value={fields[field.key]} type={field.date ? 'date' : 'text'} maxLength={NOTICE_SHEET_FIELD_LIMITS[field.key]} onChange={event => changeField(field.key, event.target.value)} />}
                    {Object.hasOwn(draft.fields, field.key) && <button type="button" className="notice-sheet-reset" onClick={() => setDraft(current => { const next = { ...current.fields }; delete next[field.key]; return { ...current, fields: next } })}>Otomatik bilgiyi kullan</button>}
                  </label>
                })}</div>
              </details>)}
              <details><summary>Evrak kontrolü</summary><p>Hazır evraklar otomatik işaretlenir. Elle yapılan işaretler yalnız bu föye uygulanır.</p><div className="notice-sheet-editor__checks">{noticeSheetDocumentLabels.map(([code, label]) => <label key={code}><input type="checkbox" checked={documents[code]} onChange={event => changeDocument(code, event.target.checked)} /><span>{label}</span></label>)}</div></details>
            </fieldset>
            <button className="button button--secondary" type="button" disabled={!canEdit || busy || (!dirty && Object.keys(sheet.overrides.fields).length === 0 && Object.keys(sheet.overrides.documents).length === 0)} onClick={() => { setDraft({ fields: {}, documents: {} }); setNotice('Otomatik bilgiler getirildi. Uygulamak için kaydedin.'); setError('') }}><RotateCcw size={14} /> Otomatik bilgilere dön</button>
          </aside>
          <div className="notice-sheet-preview" ref={preview}><NoticeSheet sheet={sheet} fields={fields} documents={documents} /></div>
        </div>}
        <footer className="modal__footer">
          <span className="notice-sheet-save-state">{dirty ? 'Kaydedilmemiş değişiklikler' : sheet?.version ? `Kayıtlı föy · Sürüm ${sheet.version}` : 'Otomatik föy'} · A4 / 1 sayfa</span>
          <button className="button button--secondary" type="button" onClick={close} disabled={busy}>Kapat</button>
          {previewing && <button className="button button--secondary" type="button" disabled={busy} onClick={() => setPreviewing(false)}>Düzenlemeye dön</button>}
          {canEdit && <button className="button button--secondary" type="button" disabled={busy || !dirty} onClick={() => void save(false)}><Save size={15} /> Kaydet</button>}
          <button className="button button--primary" type="button" disabled={busy || status !== 'ok' || !sheet?.caseType} onClick={() => void save(true)}><Printer size={15} />{busy ? 'Hazırlanıyor…' : previewing ? 'Yazıcıya gönder' : dirty ? 'Kaydet ve Yazdır' : 'Yazdır'}</button>
        </footer>
      </>}
    </ModalFrame>
    {sheet && sheet.caseType !== null && fields && documents && createPortal(<div className="notice-sheet-print-root" aria-hidden="true"><NoticeSheet sheet={sheet} fields={fields} documents={documents} /></div>, document.body)}
  </>
}
