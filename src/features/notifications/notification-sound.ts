let context: AudioContext | undefined

export function enableNotificationSound(): void {
  if (typeof AudioContext === 'undefined') return
  try {
    context ??= new AudioContext()
    void context.resume().catch(() => undefined)
  } catch { /* Audio output may be unavailable on this device. */ }
}

export async function playNotificationSound(urgent = false): Promise<void> {
  if (typeof AudioContext === 'undefined') return
  try {
    const audio = context ??= new AudioContext()
    if (audio.state !== 'running') return
    // Chromium may require an earlier user gesture. A blocked sound must not
    // prevent the persistent visual alert from being shown.
    const repeats = urgent ? 3 : 1
    for (let i = 0; i < repeats; i++) {
      const oscillator = audio.createOscillator(), gain = audio.createGain()
      const start = audio.currentTime + i * .35
      oscillator.frequency.value = urgent ? 880 : 660
      gain.gain.setValueAtTime(.001, start)
      gain.gain.exponentialRampToValueAtTime(urgent ? .25 : .1, start + .02)
      gain.gain.exponentialRampToValueAtTime(.001, start + .25)
      oscillator.connect(gain); gain.connect(audio.destination)
      oscillator.start(start); oscillator.stop(start + .27)
    }
  } catch { /* Audio output can be unavailable; the visual notification remains. */ }
}
