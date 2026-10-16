import { useState, type FormEvent } from 'react'
import { Palette } from 'lucide-react'
import { DEFAULT_ASSISTANT_APPEARANCE, type AssistantAppearance } from '@hasarbotu/contracts/assistant-appearance'
import { AssistantAppearanceError } from '../../data/assistantAppearancePort'
import { APPEARANCE_PRESETS, appearanceStyle, softCharacterColor } from './appearance'
import { useAssistantAppearance } from './assistantAppearanceContext'
import './desktop-assistant-panel.css'

export function AssistantAppearanceEditor({ appearance, systemDark, onSave, onReload }: {
  appearance: AssistantAppearance; systemDark: boolean; onSave: (value: AssistantAppearance) => Promise<AssistantAppearance>; onReload: () => void
}) {
  const signature = JSON.stringify(appearance)
  const [draftState, setDraftState] = useState({ signature, value: appearance }), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const draft = draftState.signature === signature ? draftState.value : appearance
  const setDraft = (value: AssistantAppearance) => setDraftState({ signature, value })
  const set = (patch: Partial<AssistantAppearance>) => { setDraft({ ...draft, ...patch }); setNotice('') }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setNotice('')
    try { setDraft(await onSave(draft)); setNotice('Touch görünümünüz hesabınıza kaydedildi.') }
    catch (error) { setNotice(error instanceof AssistantAppearanceError && error.kind === 'conflict' ? 'Ayarlar başka oturumda değişti. Yeniden yükleyin.' : 'Ayarlar kaydedilemedi. Bağlantınızı ve hesabınızı kontrol edin.') }
    finally { setBusy(false) }
  }
  return <form className="assistant-appearance-editor" onSubmit={submit}>
    <div className="assistant-appearance-layout"><div className="assistant-appearance-controls">
    <fieldset disabled={busy}><legend>Hazır renkler</legend><div className="assistant-palette-presets">{APPEARANCE_PRESETS.map(preset => <button type="button" key={preset.name} aria-pressed={draft.accentColor === preset.accentColor && draft.characterColor === preset.characterColor} onClick={() => set({ accentColor: preset.accentColor, characterColor: preset.characterColor })}><i aria-hidden="true" style={{ background: preset.accentColor }} />{preset.name}</button>)}</div></fieldset>
    <fieldset disabled={busy}><legend>Özel görünüm</legend>
      <label>Vurgu rengi <input type="color" value={draft.accentColor} onChange={e => set({ accentColor: e.target.value })} /></label>
      <label>Karakter rengi <input type="color" value={draft.characterColor} onChange={e => set({ characterColor: e.target.value })} /></label>
      <label>Tema <select value={draft.scheme} onChange={e => set({ scheme: e.target.value as AssistantAppearance['scheme'] })}><option value="system">Sisteme göre</option><option value="light">Açık</option><option value="dark">Koyu</option></select></label>
      <label>Yazı boyutu <select value={draft.textSize} onChange={e => set({ textSize: e.target.value as AssistantAppearance['textSize'] })}><option value="normal">Normal</option><option value="large">Büyük</option></select></label>
      <label className="assistant-appearance-motion"><span>Animasyonları azalt</span><input type="checkbox" checked={draft.reduceMotion} onChange={e => set({ reduceMotion: e.target.checked })} /></label>
    </fieldset>
    </div>
    <div className="assistant-appearance-preview" style={appearanceStyle(draft, systemDark)} aria-label="Touch görünümü önizlemesi"><small>Önizleme</small><span className="assistant-character-preview" style={{ background: softCharacterColor(draft.characterColor) }} aria-hidden="true">••</span><strong>HasarBotu Touch</strong><span>Notlarınız ve dosya aramanız</span><span className="assistant-appearance-preview__accent" style={{ background: draft.accentColor, color: 'var(--assistant-accent-ink)' }}>Renk önizlemesi</span></div>
    </div>
    <div className="assistant-native-actions"><button type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Görünümü Kaydet'}</button><button type="button" disabled={busy} onClick={() => setDraft(DEFAULT_ASSISTANT_APPEARANCE)}>Varsayılanlar</button><button type="button" disabled={busy} onClick={onReload}>Yeniden yükle</button></div>
    {notice && <p role="status">{notice}</p>}
  </form>
}

export function AssistantAppearanceSettings() {
  const model = useAssistantAppearance()
  return <section className="settings-section settings-section--appearance"><header><Palette size={19} /><div><h2>Touch görünümüm</h2><span>Hesabınıza özel</span></div></header>{model.status === 'ready'
    ? <AssistantAppearanceEditor appearance={model.appearance} systemDark={model.systemDark} onSave={model.save} onReload={model.reload} />
    : <p role="status">{model.status === 'loading' ? 'Hesabınızın renkleri yükleniyor…' : 'Görünüm ayarları alınamadı.'} <button type="button" onClick={model.reload}>Tekrar dene</button></p>}</section>
}
