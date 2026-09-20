import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function ServiceRevisionDialog({ name, options, onSave, onClose }: {
  name: string
  options: readonly { name: string }[]
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(name)
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector('input')?.focus()
    return () => previous?.focus()
  }, [])
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="modal modal--case-form" role="dialog" aria-modal="true" aria-labelledby="service-revision-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input')]
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (draft.trim()) onSave(draft.trim()) }}>
        <header className="modal__header"><h2 id="service-revision-title">Servisi revize et</h2><button type="button" className="icon-button" aria-label="Servis revizyonunu kapat" onClick={onClose}><X size={18} /></button></header>
        <div className="modal__body"><label className="form-field"><span>Servis adı</span><input value={draft} maxLength={500} onChange={event => setDraft(event.target.value)} list="service-revision-options" /></label><datalist id="service-revision-options">{options.map(option => <option key={option.name} value={option.name} />)}</datalist><p>Kaynak bilgisi korunur. Yeni servis adı dosyaya revizyon olarak kaydedilir.</p></div>
        <footer className="modal__footer"><button type="button" className="button button--secondary" onClick={onClose}>Vazgeç</button><button type="submit" className="button button--primary" disabled={!draft.trim()}>Revizyonu uygula</button></footer>
      </form>
    </section>
  </div>, document.body)
}
