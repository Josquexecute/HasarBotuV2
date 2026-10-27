import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Palette } from 'lucide-react'
import { DEFAULT_ASSISTANT_APPEARANCE, type AssistantAppearance } from '@hasarbotu/contracts/assistant-appearance'
import { AssistantAppearanceError } from '../../data/assistantAppearancePort'
import { APPEARANCE_PRESETS, appearanceStyle, contrastInk } from './appearance'
import { useAssistantAppearance } from './assistantAppearanceContext'
import { positionAssistantImage, prepareAssistantImage } from './customImage'
import { TouchAppearancePreview } from './TouchAppearancePreview'
import './desktop-assistant-panel.css'

export function AssistantAppearanceEditor({ appearance, systemDark, onSave, onReload, onPreview }: {
  appearance: AssistantAppearance; systemDark: boolean; onSave: (value: AssistantAppearance) => Promise<AssistantAppearance>; onReload: () => void
  onPreview?: (value: AssistantAppearance | null) => void
}) {
  const signature = JSON.stringify(appearance)
  const [draftState, setDraftState] = useState({ signature, value: appearance }), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [positionState, setPositionState] = useState({ signature, source: appearance.customImage, scale: 1, x: 0, y: 0 })
  const position = positionState.signature === signature ? positionState : { signature, source: appearance.customImage, scale: 1, x: 0, y: 0 }
  const imageGeneration = useRef(0)
  const draft = draftState.signature === signature ? draftState.value : appearance
  useEffect(() => { onPreview?.(draft) }, [draft, onPreview])
  useEffect(() => () => onPreview?.(null), [onPreview])
  const setDraft = (value: AssistantAppearance) => setDraftState({ signature, value })
  const set = (patch: Partial<AssistantAppearance>) => {
    setDraftState(current => ({ signature, value: { ...(current.signature === signature ? current.value : appearance), ...patch } }))
    setNotice('')
  }
  async function chooseImage(file?: File) {
    if (!file) return
    setImageBusy(true); setNotice('')
    try {
      const customImage = await prepareAssistantImage(file)
      setPositionState({ signature, source: customImage, scale: 1, x: 0, y: 0 })
      set({ customImage })
    }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Görsel işlenemedi.') }
    finally { setImageBusy(false) }
  }
  async function moveImage(patch: Partial<{ scale: number; x: number; y: number }>) {
    const next = { ...position, ...patch }
    if (!next.source) return
    const generation = ++imageGeneration.current
    setPositionState(next); setImageBusy(true)
    try {
      const customImage = await positionAssistantImage(next.source, next)
      if (generation === imageGeneration.current) set({ customImage })
    } catch { if (generation === imageGeneration.current) setNotice('Kaplama konumlandırılamadı.') }
    finally { if (generation === imageGeneration.current) setImageBusy(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || imageBusy) return
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
      <label>Karakter rengi <input type="color" disabled={Boolean(draft.customImage)} title={draft.customImage ? 'Karakter rengi varsayılan Touch için geçerlidir.' : undefined} value={draft.characterColor} onChange={e => set({ characterColor: e.target.value })} /></label>
      <label>Göz Rengi <input type="color" value={draft.eyeColor ?? contrastInk(draft.characterColor)} onChange={e => set({ eyeColor: e.target.value })} /></label>
      <button type="button" disabled={!draft.eyeColor} onClick={() => set({ eyeColor: null })}>Otomatik göz rengi</button>
      <label>Tema <select value={draft.scheme} onChange={e => set({ scheme: e.target.value as AssistantAppearance['scheme'] })}><option value="system">Sisteme göre</option><option value="light">Açık</option><option value="dark">Koyu</option></select></label>
      <label>Yazı boyutu <select value={draft.textSize} onChange={e => set({ textSize: e.target.value as AssistantAppearance['textSize'] })}><option value="normal">Normal</option><option value="large">Büyük</option></select></label>
      <label className="assistant-appearance-motion"><span>Animasyonları azalt</span><input type="checkbox" checked={draft.reduceMotion} onChange={e => set({ reduceMotion: e.target.checked })} /></label>
    </fieldset>
    <fieldset disabled={busy || imageBusy}><legend>Karakter görseli</legend>
      <label>Görsel seç / değiştir <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void chooseImage(event.target.files?.[0]); event.target.value = '' }} /></label>
      <small>PNG, JPG veya WebP · en fazla 2 MB. Ana figür otomatik ortalanır ve gövdeye sığdırılır. Boş kenarlar ve uygun siyah/beyaz dış arka plan ayrılır; gözler ve hareketler korunur.</small>
      {draft.customImage && <button type="button" onClick={() => set({ customImage: null })}>Varsayılan Touch'a dön</button>}
    </fieldset>
    {draft.customImage && <fieldset disabled={busy}><legend>İnce ayar (isteğe bağlı)</legend>
      <label>Ölçek <input type="range" min="0.5" max="2.5" step="0.05" value={position.scale} onChange={e => { void moveImage({ scale: Number(e.target.value) }) }} /></label>
      <label>Yatay konum <input type="range" min="-50" max="50" value={position.x} onChange={e => { void moveImage({ x: Number(e.target.value) }) }} /></label>
      <label>Dikey konum <input type="range" min="-50" max="50" value={position.y} onChange={e => { void moveImage({ y: Number(e.target.value) }) }} /></label>
      <small>Önizleme gerçek 120×120 Touch çizimidir. Gövde dışında kalan kısımlar kırpılır; ayarları kaydetmeden önce kontrol edin.</small>
    </fieldset>}
    </div>
    <div className="assistant-appearance-preview" style={appearanceStyle(draft, systemDark)} aria-label="Touch görünümü önizlemesi"><small>Önizleme</small><TouchAppearancePreview appearance={draft} /><strong>HasarBotu Touch</strong><span>Notlarınız ve dosya aramanız</span></div>
    </div>
    <div className="assistant-native-actions"><button type="submit" disabled={busy || imageBusy}>{busy ? 'Kaydediliyor…' : imageBusy ? 'Görsel hazırlanıyor…' : 'Görünümü Kaydet'}</button><button type="button" disabled={busy || imageBusy} onClick={() => setDraft({ ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor: null })}>Varsayılanlar</button><button type="button" disabled={busy || imageBusy} onClick={onReload}>Yeniden yükle</button></div>
    {notice && <p role="status">{notice}</p>}
  </form>
}

export function AssistantAppearanceSettings() {
  const model = useAssistantAppearance()
  return <section className="settings-section settings-section--appearance"><header><Palette size={19} /><div><h2>Touch görünümüm</h2><span>Hesabınıza özel</span></div></header>{model.status === 'ready'
    ? <AssistantAppearanceEditor key={model.userId} appearance={model.appearance} systemDark={model.systemDark} onSave={model.save} onReload={model.reload} onPreview={model.preview} />
    : <p role="status">{model.status === 'loading' ? 'Hesabınızın renkleri yükleniyor…' : 'Görünüm ayarları alınamadı.'} <button type="button" onClick={model.reload}>Tekrar dene</button></p>}</section>
}
