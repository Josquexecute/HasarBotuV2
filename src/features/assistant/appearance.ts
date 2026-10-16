import type { CSSProperties } from 'react'
import type { AssistantAppearance } from '@hasarbotu/contracts'

export const APPEARANCE_PRESETS = ([
  ['Mor', '#635bff'],
  ['Mavi', '#2563eb'],
  ['Yeşil', '#15803d'],
  ['Turuncu', '#c2410c'],
  ['Pembe', '#be185d'],
  ['Gri', '#475569'],
  ['Kırmızı', '#dc2626'],
  ['Sarı', '#facc15'],
  ['Siyah', '#000000'],
  ['Beyaz', '#ffffff'],
] as const).map(([name, color]) => ({ name, accentColor: color, characterColor: color }))

export function contrastInk(color: string): string {
  const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
  const luminance = channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722
  return luminance > .179 ? '#111111' : '#ffffff'
}
export function appearanceStyle(appearance: AssistantAppearance, systemDark: boolean): CSSProperties {
  const dark = appearance.scheme === 'dark' || appearance.scheme === 'system' && systemDark
  return {
    '--surface': dark ? '#161d29' : '#ffffff', '--surface-muted': dark ? '#202a3a' : '#f1f4f8',
    '--text-primary': dark ? '#f4f7fc' : '#171c26', '--text-secondary': dark ? '#c0cbdb' : '#475569',
    '--border': dark ? '#445168' : '#b9c4d3', '--accent': appearance.accentColor,
    '--accent-soft': `${appearance.accentColor}26`, '--assistant-accent-ink': contrastInk(appearance.accentColor),
    '--assistant-font-size': appearance.textSize === 'large' ? '15px' : '13px',
    '--assistant-focus': dark ? '#dce6f3' : '#334155',
    colorScheme: dark ? 'dark' : 'light',
  } as CSSProperties
}
