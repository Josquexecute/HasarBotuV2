import { useMemo, useRef, useState, type FormEvent } from 'react'
import { CaseCommandError, createHttpCaseCommandAdapter, type CaseCommandPort } from '../../data/commandPort'
import type { CaseRecord } from '../../types/case'
import { commandErrorMessage } from './caseForm'

export function CaseTypeAssignment({ item, canEdit, onUpdated, onUnauthorized, commandPort }: {
  item: CaseRecord
  canEdit: boolean
  onUpdated: (item: CaseRecord) => void
  onUnauthorized: () => void
  commandPort?: CaseCommandPort
}) {
  const commands = useMemo(() => commandPort ?? createHttpCaseCommandAdapter(), [commandPort])
  const currentType = item.type === 'Trafik' ? 'traffic' : item.type === 'Kasko' ? 'casco' : ''
  const [selected, setSelected] = useState<'' | 'traffic' | 'casco'>(currentType)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canEdit || selected === '' || selected === currentType || item.version === undefined || submitting.current) return
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      onUpdated(await commands.updateCase(item.caseId, { expectedVersion: item.version, caseType: selected }))
    } catch (cause) {
      const failure = cause instanceof CaseCommandError ? cause : new CaseCommandError('unavailable', 'classification failed')
      if (failure.kind === 'unauthorized') onUnauthorized()
      setError(commandErrorMessage(failure))
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  return <section className="info-panel">
    <h2>Dosya türü seçimi</h2>
    <p>{currentType ? 'Dosya türünü düzeltebilirsiniz. İşlem geçmişe kaydedilir; kapalı dosya yeniden açılmaz.' : 'Tür seçilene kadar evrak ve işlem kuralları değerlendirilmez. Notlar ve dosya geçmişi kullanılabilir.'}</p>
    <form onSubmit={save}>
      <label>Dosya türü <select aria-label="Dosyanın türünü seçin" value={selected} disabled={!canEdit || saving} onChange={event => setSelected(event.target.value as typeof selected)}>
        <option value="">Seçiniz</option><option value="traffic">Trafik</option><option value="casco">Kasko</option>
      </select></label>
      <button className="button button--primary" type="submit" disabled={!canEdit || saving || selected === '' || selected === currentType || item.version === undefined}>{saving ? 'Kaydediliyor…' : 'Türü Kaydet'}</button>
    </form>
    {!canEdit && <p>Dosya türünü değiştirmek için düzenleme yetkisi gerekir.</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
