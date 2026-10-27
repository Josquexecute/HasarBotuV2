import { useEffect, useState } from 'react'
import { TOUCH_REACTIONS, type TouchPlayCommand, type TouchPlayState } from '../../../public/desktop-assistant-play.js'

export type TouchPlayWindow = Window & { hasarbotuTouch?: {
  control(command: TouchPlayCommand): Promise<boolean>
  getState(): Promise<TouchPlayState | null>
  onState(callback: (state: TouchPlayState) => void): () => void
} }
const groups = [...new Set(TOUCH_REACTIONS.map(reaction => reaction.group))]
const moodLabels = { happy: 'Neşeli', surprised: 'Şaşkın', bothered: 'Rahatsız', angry: 'Sinirli' }

export function TouchPlayControls() {
  const native = (window as TouchPlayWindow).hasarbotuTouch
  const [state, setState] = useState<TouchPlayState | null>(null)
  const [selected, setSelected] = useState('random')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!native) return
    let active = true
    const update = (next: TouchPlayState | null) => {
      if (active && next) setState(current => !current || next.version >= current.version ? next : current)
    }
    const unsubscribe = native.onState(update)
    void native.getState().then(update).catch(() => { if (active) setError('Touch durumu alınamadı.') })
    return () => { active = false; unsubscribe() }
  }, [native])
  async function control(command: TouchPlayCommand) {
    if (!native || busy) return
    setBusy(true); setError('')
    try { if (!await native.control(command)) setError('Touch bu tepkiyi şu anda oynatamıyor.') }
    catch { setError('Touch bağlantısı kullanılamıyor.') }
    finally { setBusy(false) }
  }
  const disabled = !native || !state || busy
  const reaction = TOUCH_REACTIONS.find(item => item.id === state?.reaction)
  return <details className="touch-play-controls">
    <summary>Touch tepkileri <span aria-live="polite">{state ? moodLabels[state.mood] : 'Bağlantı bekleniyor'}</span></summary>
    <div className="touch-play-content">
      <p aria-live="polite">{state?.reducedMotion ? 'Hareket azaltma açık. Touch sabit görünür.' : state?.paused ? 'Tepkiler duraklatıldı.' : state?.sleeping ? 'Touch uyuyor.' : reaction?.name ?? 'Bir tepki seçin veya Touch sizi şaşırtsın.'}</p>
      <label>Touch tepkisi <select value={selected} disabled={disabled} onChange={event => setSelected(event.target.value)}>
        <option value="random">Beni şaşırt</option>
        {groups.map(group => <optgroup key={group} label={TOUCH_REACTIONS.find(item => item.group === group)!.groupName}>
          {TOUCH_REACTIONS.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </optgroup>)}
      </select></label>
      <div className="touch-play-actions">
        <button disabled={disabled || state?.reducedMotion} onClick={() => { void control({ type: 'play', id: selected }) }}>Oynat</button>
        <button disabled={disabled} onClick={() => { void control({ type: 'calm' }) }}>Sakinleştir</button>
        <button disabled={disabled} onClick={() => { void control({ type: 'stop' }) }}>Tepkiyi bitir</button>
        <button disabled={disabled} aria-pressed={state?.paused ?? false} onClick={() => { void control({ type: state?.paused ? 'resume' : 'pause' }) }}>{state?.paused ? 'Devam et' : 'Duraklat'}</button>
        <button disabled={disabled} onClick={() => { void control({ type: state?.sleeping ? 'wake' : 'sleep' }) }}>{state?.sleeping ? 'Uyandır' : 'Uyut'}</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  </details>
}
