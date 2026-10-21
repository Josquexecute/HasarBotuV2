import { useId } from 'react'
import { eksistKey } from '@hasarbotu/domain'
import { serviceContactDraft, type ServiceContactDraft } from './service-contact'

export function ServiceContactFields({ value, options, sourceText, onChange, nameReadOnly = false, autoFocus = false }: {
  value: ServiceContactDraft
  options: readonly { name: string; phone?: string | null }[]
  sourceText?: string
  onChange: (value: ServiceContactDraft) => void
  nameReadOnly?: boolean
  autoFocus?: boolean
}) {
  const id = useId()
  return <>
    {!nameReadOnly && <label className="form-field"><span>Servis adı</span><input autoFocus={autoFocus} value={value.name} maxLength={500} list={id} onChange={event => {
      const name = event.target.value
      onChange(eksistKey(name) === eksistKey(value.name) ? { ...value, name } : serviceContactDraft(name, options, sourceText, true))
    }} /></label>}
    <datalist id={id}>{options.map(option => <option key={option.name} value={option.name} />)}</datalist>
    <label className="form-field"><span>Servis telefonu</span><input type="tel" value={value.phone} maxLength={80} onChange={event => onChange({ ...value, phone: event.target.value })} /></label>
    <label className="form-field"><span>Servis adresi</span><textarea value={value.address} maxLength={500} rows={2} onChange={event => onChange({ ...value, address: event.target.value })} /></label>
  </>
}
