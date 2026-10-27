import { contextBridge, ipcRenderer } from 'electron'

// Only the dedicated assistant window receives this surface. No channel name,
// URL, path, cursor coordinates or general Electron API comes from the renderer.
contextBridge.exposeInMainWorld('hasarbotuAssistant', Object.freeze({
  playState: (value: unknown) => ipcRenderer.send('hasarbotu:touch-state', value),
  onPlay: (callback: unknown) => {
    if (typeof callback !== 'function') throw new TypeError('Touch callback must be a function')
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== 'object') return
      const data = value as Record<string, unknown>
      if (data.type === 'play' && typeof data.id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(data.id)) callback({ type: 'play', id: data.id })
      else if (typeof data.type === 'string' && ['calm', 'stop', 'pause', 'resume', 'sleep', 'wake'].includes(data.type)) callback({ type: data.type })
    }
    ipcRenderer.on('hasarbotu:touch-control', listener)
    return () => ipcRenderer.removeListener('hasarbotu:touch-control', listener)
  },
  press: () => ipcRenderer.send('hasarbotu:assistant', 'press'),
  drag: () => ipcRenderer.send('hasarbotu:assistant', 'drag'),
  release: () => ipcRenderer.send('hasarbotu:assistant', 'release'),
  cancel: () => ipcRenderer.send('hasarbotu:assistant', 'cancel'),
  menu: () => ipcRenderer.send('hasarbotu:assistant', 'menu'),
  activate: () => ipcRenderer.send('hasarbotu:assistant', 'activate'),
  move: (direction: unknown) => {
    if (direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down') {
      ipcRenderer.send('hasarbotu:assistant', direction)
    }
  },
  onGaze: (callback: unknown) => {
    if (typeof callback !== 'function') throw new TypeError('Gaze callback must be a function')
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value !== 'object' || value === null) return
      const { x, y } = value as Record<string, unknown>
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
        || Math.abs(x) > 1 || Math.abs(y) > 1) return
      callback({ x, y })
    }
    ipcRenderer.on('hasarbotu:assistant-gaze', listener)
    return () => ipcRenderer.removeListener('hasarbotu:assistant-gaze', listener)
  },
  onAppearance: (callback: unknown) => {
    if (typeof callback !== 'function') throw new TypeError('Appearance callback must be a function')
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value !== 'object' || value === null) return
      const data = value as Record<string, unknown>
      if (typeof data.accentColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(data.accentColor)
        || typeof data.characterColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(data.characterColor)
        || typeof data.reduceMotion !== 'boolean') return
      if (data.customImage != null && (typeof data.customImage !== 'string' || data.customImage.length > 360_000
        || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.customImage))) return
      if (data.eyeColor != null && (typeof data.eyeColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(data.eyeColor))) return
      callback({ accentColor: data.accentColor, characterColor: data.characterColor, eyeColor: data.eyeColor, reduceMotion: data.reduceMotion, customImage: data.customImage })
    }
    ipcRenderer.on('hasarbotu:assistant-appearance', listener)
    return () => ipcRenderer.removeListener('hasarbotu:assistant-appearance', listener)
  },
  onMotion: (callback: unknown) => {
    if (typeof callback !== 'function') throw new TypeError('Motion callback must be a function')
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value !== 'object' || value === null) return
      const { type, x } = value as Record<string, unknown>
      if (type === 'release' || type === 'success' || type === 'notification' || type === 'celebrate') callback({ type })
      else if ((type === 'working' || type === 'error') && typeof (value as Record<string, unknown>).active === 'boolean') callback({ type, active: (value as Record<string, unknown>).active })
      else if ((type === 'drag' || type === 'edge') && typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1) {
        if (type === 'edge') { callback({ type, x }); return }
        const { dx, dy, elapsed } = value as Record<string, unknown>
        if (typeof dx !== 'number' || !Number.isFinite(dx) || typeof dy !== 'number' || !Number.isFinite(dy)
          || typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) return
        callback({ type, x, dx, dy, elapsed })
      }
    }
    ipcRenderer.on('hasarbotu:assistant-motion', listener)
    return () => ipcRenderer.removeListener('hasarbotu:assistant-motion', listener)
  },
}))
