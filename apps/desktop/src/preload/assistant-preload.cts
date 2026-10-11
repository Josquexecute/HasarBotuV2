import { contextBridge, ipcRenderer } from 'electron'

// Only the dedicated assistant window receives this surface. No channel name,
// URL, path, cursor coordinates or general Electron API comes from the renderer.
contextBridge.exposeInMainWorld('hasarbotuAssistant', Object.freeze({
  press: () => ipcRenderer.send('hasarbotu:assistant', 'press'),
  drag: () => ipcRenderer.send('hasarbotu:assistant', 'drag'),
  release: () => ipcRenderer.send('hasarbotu:assistant', 'release'),
  cancel: () => ipcRenderer.send('hasarbotu:assistant', 'cancel'),
  menu: () => ipcRenderer.send('hasarbotu:assistant', 'menu'),
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
}))
