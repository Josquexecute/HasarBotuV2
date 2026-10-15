import { useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'

type FolderWindow = Window & { hasarbotuCaseFolders?: { open(caseId: string): Promise<{ opened: boolean; error?: string }> } }

export function OpenCaseFolderButton({ caseId }: { caseId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const bridge = (window as FolderWindow).hasarbotuCaseFolders
  return <span className="case-folder-action" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button className="button button--secondary" type="button" disabled={!bridge || busy} title={!bridge ? 'Klasörü açmak için masaüstü uygulamasını güncelleyin.' : 'Dosyanın klasörünü Windows Gezgini’nde aç'} onClick={async () => {
      if (!bridge || lock.current) return
      lock.current = true; setBusy(true); setError('')
      try { const result = await bridge.open(caseId); if (result.error) setError(result.error) }
      catch { setError('Klasör açılamadı. Masaüstü uygulamasını yeniden başlatın.') }
      finally { lock.current = false; setBusy(false) }
    }}><FolderOpen size={15} />{busy ? 'Açılıyor…' : 'Klasörü Aç'}</button>
    {error && <span className="text-warning" role="alert">{error}</span>}
  </span>
}
