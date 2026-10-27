import { useEffect, useId, useRef } from 'react'
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
  const selectedName = useRef(eksistKey(value.name))
  const editedName = useRef(value.name)
  useEffect(() => {
    // Selectors and SBM imports can replace the service outside this input.
    if (value.name !== editedName.current) {
      selectedName.current = eksistKey(value.name)
      editedName.current = value.name
    }
  }, [value.name])
  return <>
    {!nameReadOnly && <label className="form-field"><span>Servis adı</span><input autoFocus={autoFocus} value={value.name} maxLength={500} list={id} onChange={event => {
      const name = event.target.value
      editedName.current = name
      const key = eksistKey(name)
      const matches = options.filter(option => eksistKey(option.name) === key)
      // Typing edits the current identity; only a distinct, unambiguous directory
      // selection replaces its contacts. Keep that identity across an empty input.
      if (key !== selectedName.current && matches.length === 1) {
        selectedName.current = key
        onChange(serviceContactDraft(name, options, sourceText, true))
      } else onChange({ ...value, name })
    }} /></label>}
    <datalist id={id}>{options.map(option => <option key={option.name} value={option.name} />)}</datalist>
    <label className="form-field"><span>Servis telefonu</span><input type="tel" value={value.phone} maxLength={80} onChange={event => onChange({ ...value, phone: event.target.value })} /></label>
    <label className="form-field"><span>Servis adresi</span><textarea value={value.address} maxLength={500} rows={2} onChange={event => onChange({ ...value, address: event.target.value })} /></label>
  </>
}
