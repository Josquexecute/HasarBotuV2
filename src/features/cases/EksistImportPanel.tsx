import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import type { EksistPort, EksistSource } from '../../data/eksistPort'
import { CaseCommandError } from '../../data/commandPort'

export function EksistImportPanel({ port, onImported, disabled, onUnauthorized, onBusyChange }: { port: EksistPort; onImported: (source: EksistSource) => void; disabled: boolean; onUnauthorized: () => void; onBusyChange: (busy: boolean) => void }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const busyRef = useRef(false)
  async function read(file?: File) {
    if (busyRef.current || disabled) return
    busyRef.current = true; setBusy(true); onBusyChange(true); setError('')
    try {
      if (file && (file.size > 10_000_000 || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type))) throw new Error('format')
      const base64 = file ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = reject; reader.readAsDataURL(file)
      }) : ''
      onImported(await port.readSource(file ? { kind: file.type === 'application/pdf' ? 'pdf' : 'image', name: file.name, base64 } : { kind: 'text', text }))
    } catch (reason) {
      if (reason instanceof CaseCommandError && reason.kind === 'unauthorized') onUnauthorized()
      setError('Kaynak okunamadı. En fazla 10 MB PDF, PNG/JPEG veya kopyalanmış metin kullanın. PDF en fazla 10 sayfa olabilir.')
    } finally { busyRef.current = false; setBusy(false); onBusyChange(false) }
  }
  return <fieldset disabled={disabled || busy} className="eksist-import">
    <legend>Eksist üzerinden hızlı dosya</legend>
    <label className="form-field"><span className="sr-only">Eksist metni veya panodan görsel</span><textarea rows={3} value={text} onChange={event => setText(event.target.value)} placeholder="Eksist metnini veya panodaki görseli yapıştırın…" onPaste={event => {
      const file = [...event.clipboardData.items].find(item => item.type.startsWith('image/'))?.getAsFile()
      if (file) { event.preventDefault(); void read(file) }
    }} /></label>
    <div className="eksist-import__actions"><button type="button" className="button button--secondary" disabled={!text.trim() || busy} onClick={() => void read()}>Metni forma aktar</button>
    <label className="button button--secondary eksist-import__upload" title="PDF, PNG veya JPEG · En fazla 10 MB"><Upload size={15} aria-hidden="true" /><span>PDF veya görsel yükle</span><input className="sr-only" aria-label="PDF veya ekran görüntüsü yükle" type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => { const file = event.target.files?.[0]; if (file) void read(file); event.target.value = '' }} /></label></div>
    {busy && <p role="status">Kaynak okunuyor; gerekirse OCR uygulanıyor…</p>}
    {error && <p role="alert">{error}</p>}
  </fieldset>
}
