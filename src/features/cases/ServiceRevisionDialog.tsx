import { useState } from 'react'
import { X } from 'lucide-react'
import { ModalFrame } from '../../components/ModalFrame'

export function ServiceRevisionDialog({ name, options, onSave, onClose }: {
  name: string
  options: readonly { name: string }[]
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(name)
  return <ModalFrame className="modal--small" labelledBy="service-revision-title" onClose={onClose} nested>
      <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (draft.trim()) onSave(draft.trim()) }}>
        <header className="modal__header"><h2 id="service-revision-title">Servisi revize et</h2><button type="button" className="icon-button" aria-label="Servis revizyonunu kapat" onClick={onClose}><X size={18} /></button></header>
        <div className="modal__body"><label className="form-field"><span>Servis adı</span><input autoFocus value={draft} maxLength={500} onChange={event => setDraft(event.target.value)} list="service-revision-options" /></label><datalist id="service-revision-options">{options.map(option => <option key={option.name} value={option.name} />)}</datalist><p className="form-hint">Orijinal kaynak korunur; değişiklik bu dosyaya kaydedilir.</p></div>
        <footer className="modal__footer"><button type="button" className="button button--secondary" onClick={onClose}>Vazgeç</button><button type="submit" className="button button--primary" disabled={!draft.trim()}>Revizyonu uygula</button></footer>
      </form>
  </ModalFrame>
}
