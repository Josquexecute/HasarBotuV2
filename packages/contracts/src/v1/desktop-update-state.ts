import type { DesktopRelease } from './desktop-release.js'

export interface DesktopUpdateState {
  currentVersion: string
  supported: boolean
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'disabled' | 'error'
  release?: DesktopRelease
  downloadedBytes: number
  message?: string
}

export interface DesktopUpdatesSurface {
  check(): Promise<DesktopUpdateState>
  install(): Promise<DesktopUpdateState>
  onState(callback: (state: DesktopUpdateState) => void): () => void
}
