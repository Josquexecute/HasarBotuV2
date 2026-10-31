import { useState } from 'react'
import { X } from 'lucide-react'
import { ModalFrame } from '../../components/ModalFrame'
import { ServiceContactFields } from './ServiceContactFields'
import type { ServiceContactDraft } from './service-contact'

export function ServiceRevisionDialog({ name, details, sourceText, options, onSave, onClose }: {
  name: string
  details?: ServiceContactDraft
  sourceText?: string
  options: readonly { name: string; phone?: string | null; address?: string | null }[]
  onSave: (name: string, details: ServiceContactDraft) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(details ?? { name, phone: '', address: '' })
  return <ModalFrame className="modal--small" labelledBy="service-revision-title" onClose={onClose} nested>
      <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (draft.name.trim()) onSave(draft.name.trim(), { ...draft, name: draft.name.trim() }) }}>
        <header className="modal__header"><h2 id="service-revision-title">Servisi revize et</h2><button type="button" className="icon-button" aria-label="Servis revizyonunu kapat" onClick={onClose}><X size={18} /></button></header>
        <div className="modal__body"><ServiceContactFields autoFocus value={draft} options={options} sourceText={sourceText} onChange={setDraft} /><p className="form-hint">Orijinal kaynak korunur; değişiklik bu dosyaya kaydedilir.</p></div>
        <footer className="modal__footer"><button type="button" className="button button--secondary" onClick={onClose}>Vazgeç</button><button type="submit" className="button button--primary" disabled={!draft.name.trim()}>Revizyonu uygula</button></footer>
      </form>
  </ModalFrame>
}
