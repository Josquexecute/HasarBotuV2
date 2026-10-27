/** Presentation defaults stay independent of runtime schema and insurance rules. */
export interface AssistantAppearance {
  scheme: 'system' | 'light' | 'dark'
  accentColor: string
  characterColor: string
  /** Missing/null keeps automatic contrast for preferences saved by older clients. */
  eyeColor?: string | null | undefined
  textSize: 'normal' | 'large'
  reduceMotion: boolean
  /** Sanitized, bounded PNG; absent on preferences created before custom characters. */
  customImage?: string | null | undefined
}
export const DEFAULT_ASSISTANT_APPEARANCE: AssistantAppearance = {
  scheme: 'system', accentColor: '#635bff', characterColor: '#eff2fa', textSize: 'normal', reduceMotion: false,
}
