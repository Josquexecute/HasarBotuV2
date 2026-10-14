/** Presentation defaults stay independent of runtime schema and insurance rules. */
export interface AssistantAppearance {
  scheme: 'system' | 'light' | 'dark'
  accentColor: string
  characterColor: string
  textSize: 'normal' | 'large'
  reduceMotion: boolean
}
export const DEFAULT_ASSISTANT_APPEARANCE: AssistantAppearance = {
  scheme: 'system', accentColor: '#635bff', characterColor: '#eff2fa', textSize: 'normal', reduceMotion: false,
}
